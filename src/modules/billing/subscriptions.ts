import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { clearAccessCache, loadAccess, usageOf, type Limits } from "@/modules/core/entitlements";
import { BusinessRuleError } from "@/modules/core/errors";
import { requireMembership, withTenant } from "@/modules/core/tenant";
import { coverageEnd, issueInvoiceTx, listInvoicesForCompany, voidOpenInvoicesTx } from "./invoices";
import { getPlatformSettings, platformAudit, type Tx } from "./platform";

type Plan = typeof schema.plan.$inferSelect;
const DAY = 86_400_000;

/** Appelé à la création d'une entreprise : si la facturation est active, l'offre par défaut s'applique (essai, gratuite, ou à régler). */
export async function startDefaultSubscription(tx: Tx, companyId: string, now = new Date()) {
  const [settings] = await tx.select().from(schema.platformSettings).where(eq(schema.platformSettings.id, 1));
  if (!settings?.billingEnabled) return null;
  const [plan] = await tx.select().from(schema.plan).where(and(eq(schema.plan.isDefault, true), sql`${schema.plan.archivedAt} is null`));
  if (!plan) return null;
  const free = plan.priceMinor === 0;
  const trial = plan.trialDays > 0 && !free;
  await tx.insert(schema.subscription).values({
    companyId,
    planId: plan.id,
    status: free ? "active" : trial ? "trialing" : "expired",
    trialEndsAt: trial ? new Date(now.getTime() + plan.trialDays * DAY) : null,
  });
  // offre payante sans essai : la facture du premier mois est émise tout de suite
  if (!free && !trial) await issueInvoiceTx(tx, companyId, plan, now, now);
  return plan;
}

async function assertFits(companyId: string, plan: Plan, ctx: Parameters<typeof withTenant>[0]) {
  const limits = plan.limits as Limits;
  const problems: string[] = [];
  const u = await usageOf(companyId);
  if (limits.members != null && u.members > limits.members) problems.push(`${u.members} membres (maximum ${limits.members})`);
  if (limits.storageMb != null) {
    const bytes = await withTenant(ctx, async (tx) => {
      const [r] = await tx.select({ t: sql<number>`coalesce(sum(${schema.attachment.sizeBytes}), 0)::float8` }).from(schema.attachment);
      return Number(r?.t ?? 0);
    });
    if (bytes > limits.storageMb * 1024 * 1024) problems.push(`${Math.ceil(bytes / 1048576)} Mo de justificatifs (maximum ${limits.storageMb})`);
  }
  if (problems.length) throw new BusinessRuleError(`Cette offre est trop petite pour votre usage actuel : ${problems.join(", ")}. Réduisez-le d'abord.`);
}

/** Vue d'abonnement pour le propriétaire : état, usage, offres, factures. */
export async function getBillingView(userId: string, companyId: string) {
  const ctx = await requireMembership(userId, companyId, "company:manage");
  const now = new Date();
  const [access, settings, [sub], plans, invoices, u, storage] = await Promise.all([
    loadAccess(companyId, now),
    getPlatformSettings(),
    db.select().from(schema.subscription).where(eq(schema.subscription.companyId, companyId)),
    db.select().from(schema.plan).where(and(eq(schema.plan.isPublic, true), sql`${schema.plan.archivedAt} is null`)).orderBy(schema.plan.priceMinor),
    listInvoicesForCompany(companyId),
    usageOf(companyId),
    withTenant(ctx, async (tx) => Number((await tx.select({ t: sql<number>`coalesce(sum(${schema.attachment.sizeBytes}), 0)::float8` }).from(schema.attachment))[0]?.t ?? 0)),
  ]);
  return { access, billingEnabled: settings.billingEnabled, paymentInstructions: settings.paymentInstructions, subscription: sub ?? null, plans, invoices, usage: { members: u.members, pendingInvitations: u.pendingInvitations, storageBytes: storage } };
}

/**
 * Change d'offre. Règles :
 *  - offre gratuite : immédiat ;
 *  - offre payante : une facture est émise, l'offre s'applique **au paiement** ; pendant l'essai la facture démarre à la fin de l'essai ;
 *    un passage à une offre plus chère démarre tout de suite (pas de prorata : le reliquat de la période en cours n'est pas remboursé) ;
 *    tout autre changement démarre à la fin de la période payée ;
 *  - refusé si l'usage actuel dépasse les limites de la nouvelle offre.
 */
export async function requestPlan(userId: string, companyId: string, planId: string) {
  const ctx = await requireMembership(userId, companyId, "company:manage");
  const settings = await getPlatformSettings();
  if (!settings.billingEnabled) throw new BusinessRuleError("La facturation n'est pas activée.");
  const now = new Date();
  const [plan] = await db.select().from(schema.plan).where(eq(schema.plan.id, planId));
  if (!plan || plan.archivedAt || !plan.isPublic) throw new BusinessRuleError("Cette offre n'est pas disponible.");
  await assertFits(companyId, plan, ctx);

  const result = await db.transaction(async (tx) => {
    let [sub] = await tx.select().from(schema.subscription).where(eq(schema.subscription.companyId, companyId)).for("update");
    const access = await loadAccess(companyId, now);
    if (!sub) {
      [sub] = await tx.insert(schema.subscription).values({ companyId, planId: plan.id, status: "expired" }).returning();
    } else if (access.planId === plan.id && access.state === "active" && !sub.cancelAtPeriodEnd) {
      // déjà couvert par cette offre : rien à changer (l'essai, lui, peut être transformé en abonnement payant)
      throw new BusinessRuleError("Vous êtes déjà sur cette offre.");
    }
    // une période déjà réglée mais pas encore commencée ne se remplace pas en silence : on éviterait une double facturation
    const [future] = await tx
      .select({ start: schema.billingInvoice.periodStart })
      .from(schema.billingInvoice)
      .where(and(eq(schema.billingInvoice.companyId, companyId), eq(schema.billingInvoice.status, "paid"), sql`${schema.billingInvoice.periodStart} > ${now.toISOString()}::timestamptz`))
      .limit(1);
    if (future) throw new BusinessRuleError(`Une période est déjà réglée à partir du ${future.start.toISOString().slice(0, 10)}. Vous pourrez changer d'offre quand elle aura commencé, ou contactez le support.`);
    await voidOpenInvoicesTx(tx, companyId);

    if (plan.priceMinor === 0) {
      await tx.update(schema.subscription).set({ planId: plan.id, status: "active", cancelAtPeriodEnd: false, updatedAt: now }).where(eq(schema.subscription.companyId, companyId));
      await platformAudit(tx, userId, "subscription.plan_changed", "company", companyId, { planCode: plan.code, mode: "immediate" });
      return { mode: "immediate" as const, invoice: null };
    }

    const [cur] = access.planId ? await tx.select().from(schema.plan).where(eq(schema.plan.id, access.planId)) : [];
    const end = await coverageEnd(tx, companyId);
    let start = now;
    if (access.state === "trialing" && sub!.trialEndsAt) start = sub!.trialEndsAt;
    else if ((access.state === "active" || access.state === "past_due") && end && end > now) {
      const upgrade = cur && cur.currency === plan.currency && cur.interval === plan.interval && plan.priceMinor > cur.priceMinor;
      start = upgrade ? now : end;
    }
    // l'offre visée ne devient « courante » qu'au paiement ; seul l'essai, qui n'a pas de facture, suit immédiatement le choix
    await tx.update(schema.subscription).set({ ...(access.state === "trialing" ? { planId: plan.id } : {}), cancelAtPeriodEnd: false, updatedAt: now }).where(eq(schema.subscription.companyId, companyId));
    const invoice = await issueInvoiceTx(tx, companyId, plan, start, now);
    await platformAudit(tx, userId, "subscription.plan_requested", "company", companyId, { planCode: plan.code, invoice: invoice.number, start });
    return { mode: "invoice" as const, invoice };
  });
  clearAccessCache(companyId);
  return result;
}

/** Résiliation : l'accès continue jusqu'à la fin de la période payée ; aucune facture de renouvellement n'est émise. */
export async function cancelSubscription(userId: string, companyId: string) {
  await requireMembership(userId, companyId, "company:manage");
  await db.transaction(async (tx) => {
    const res = await tx.update(schema.subscription).set({ cancelAtPeriodEnd: true, updatedAt: new Date() }).where(eq(schema.subscription.companyId, companyId)).returning();
    if (!res.length) throw new BusinessRuleError("Aucun abonnement à résilier.");
    // une facture de renouvellement encore ouverte n'a plus lieu d'être
    await tx.update(schema.billingInvoice).set({ status: "void" }).where(and(eq(schema.billingInvoice.companyId, companyId), eq(schema.billingInvoice.status, "open"), sql`${schema.billingInvoice.periodStart} > now()`));
    await platformAudit(tx, userId, "subscription.canceled", "company", companyId);
  });
  clearAccessCache(companyId);
}

export async function resumeSubscription(userId: string, companyId: string) {
  await requireMembership(userId, companyId, "company:manage");
  const res = await db.update(schema.subscription).set({ cancelAtPeriodEnd: false, updatedAt: new Date() }).where(eq(schema.subscription.companyId, companyId)).returning();
  if (!res.length) throw new BusinessRuleError("Aucun abonnement.");
  await platformAudit(db, userId, "subscription.resumed", "company", companyId);
  clearAccessCache(companyId);
}


/** Le propriétaire abandonne sa demande de changement d'offre : les factures encore ouvertes sont annulées, rien n'a été payé. */
export async function cancelPendingRequest(userId: string, companyId: string) {
  await requireMembership(userId, companyId, "company:manage");
  await db.transaction(async (tx) => {
    await voidOpenInvoicesTx(tx, companyId);
    await platformAudit(tx, userId, "subscription.request_canceled", "company", companyId);
  });
  clearAccessCache(companyId);
}
