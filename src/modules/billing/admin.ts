import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { clearAccessCache, loadAccess } from "@/modules/core/entitlements";
import { BusinessRuleError } from "@/modules/core/errors";
import { markInvoicePaid, voidInvoice } from "./invoices";
import { assertPlatformAdmin, nextBillingNumber, platformAudit } from "./platform";

export const ADMIN_PAGE_SIZE = 25;
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Indicateurs de la plateforme : uniquement des métadonnées d'abonnement, aucune donnée métier d'entreprise. */
export async function adminOverview(adminId: string) {
  await assertPlatformAdmin(adminId);
  const [[c], [u], byStatus, mrr, [open], [unmanaged]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(schema.company),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.user),
    db.select({ status: schema.subscription.status, n: sql<number>`count(*)::int` }).from(schema.subscription).groupBy(schema.subscription.status),
    // revenu mensuel récurrent : factures payées couvrant maintenant, ramenées au mois, par devise (aucune conversion de change)
    db.execute<{ currency: string; mrr: number }>(sql`
      select i.currency, coalesce(sum(case when p.interval = 'year' then i.amount_minor / 12.0 else i.amount_minor end), 0)::float8 as mrr
      from billing_invoice i join plan p on p.id = i.plan_id
      where i.status = 'paid' and i.period_start <= now() and now() < i.period_end and i.amount_minor > 0
      group by i.currency`),
    db.select({ n: sql<number>`count(*)::int`, amount: sql<number>`coalesce(sum(${schema.billingInvoice.amountMinor}), 0)::float8` }).from(schema.billingInvoice).where(eq(schema.billingInvoice.status, "open")),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.company).where(sql`not exists (select 1 from subscription s where s.company_id = ${schema.company.id})`),
  ]);
  return {
    companies: c!.n,
    users: u!.n,
    byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s.n])) as Record<string, number>,
    mrr: (mrr as unknown as { currency: string; mrr: number }[]).map((r) => ({ currency: r.currency, minor: Math.round(Number(r.mrr)) })),
    openInvoices: { count: open!.n, amountMinor: Number(open!.amount) },
    withoutSubscription: unmanaged!.n,
  };
}

export async function listCompaniesAdmin(adminId: string, f: { q?: string; status?: string; page?: number } = {}) {
  await assertPlatformAdmin(adminId);
  const q = f.q?.trim();
  const page = Math.max(1, f.page ?? 1);
  const conds = [
    q ? or(ilike(schema.company.name, `%${escapeLike(q)}%`), sql`exists (select 1 from membership m join "user" u on u.id = m.user_id where m.company_id = ${schema.company.id} and m.role = 'owner' and u.email ilike ${`%${escapeLike(q)}%`})`) : undefined,
    f.status === "none" ? sql`not exists (select 1 from subscription s where s.company_id = ${schema.company.id})` : f.status ? sql`exists (select 1 from subscription s where s.company_id = ${schema.company.id} and s.status = ${f.status})` : undefined,
  ];
  const rows = await db
    .select({
      id: schema.company.id,
      name: schema.company.name,
      country: schema.company.country,
      createdAt: schema.company.createdAt,
      status: schema.subscription.status,
      suspendedAt: schema.subscription.suspendedAt,
      planName: schema.plan.name,
      members: sql<number>`(select count(*)::int from membership m where m.company_id = ${schema.company.id})`,
      ownerEmail: sql<string | null>`(select u.email from membership m join "user" u on u.id = m.user_id where m.company_id = ${schema.company.id} and m.role = 'owner' order by m.created_at limit 1)`,
    })
    .from(schema.company)
    .leftJoin(schema.subscription, eq(schema.subscription.companyId, schema.company.id))
    .leftJoin(schema.plan, eq(schema.plan.id, schema.subscription.planId))
    .where(and(...conds))
    .orderBy(desc(schema.company.createdAt))
    .limit(ADMIN_PAGE_SIZE + 1)
    .offset((page - 1) * ADMIN_PAGE_SIZE);
  return { rows: rows.slice(0, ADMIN_PAGE_SIZE), hasMore: rows.length > ADMIN_PAGE_SIZE, page };
}

export async function getCompanyAdmin(adminId: string, companyId: string) {
  await assertPlatformAdmin(adminId);
  const [co] = await db.select().from(schema.company).where(eq(schema.company.id, companyId));
  if (!co) return null;
  const [sub] = await db.select().from(schema.subscription).where(eq(schema.subscription.companyId, companyId));
  const members = await db
    .select({ name: schema.user.name, email: schema.user.email, role: schema.membership.role })
    .from(schema.membership)
    .innerJoin(schema.user, eq(schema.user.id, schema.membership.userId))
    .where(eq(schema.membership.companyId, companyId));
  const invoices = await db
    .select({ inv: schema.billingInvoice, planName: schema.plan.name })
    .from(schema.billingInvoice)
    .innerJoin(schema.plan, eq(schema.plan.id, schema.billingInvoice.planId))
    .where(eq(schema.billingInvoice.companyId, companyId))
    .orderBy(desc(schema.billingInvoice.issuedAt));
  const [plan] = sub ? await db.select().from(schema.plan).where(eq(schema.plan.id, sub.planId)) : [];
  return { company: { id: co.id, name: co.name, country: co.country, currency: co.currency, createdAt: co.createdAt }, subscription: sub ?? null, plan: plan ?? null, members, invoices, access: await loadAccess(companyId, new Date()) };
}

const reasonSchema = z.string().trim().min(5, "Indiquez un motif (5 caractères minimum)").max(300);

/** Offre gracieuse (geste commercial, support) : période payée à 0, sans facturation, tracée avec son motif. */
export async function grantComplimentary(adminId: string, companyId: string, planId: string, days: number, reason: string) {
  await assertPlatformAdmin(adminId);
  const why = reasonSchema.parse(reason);
  const d = z.coerce.number().int().min(1).max(3650).parse(days);
  await db.transaction(async (tx) => {
    const [plan] = await tx.select().from(schema.plan).where(eq(schema.plan.id, planId));
    if (!plan) throw new BusinessRuleError("Offre introuvable.");
    const [co] = await tx.select({ id: schema.company.id }).from(schema.company).where(eq(schema.company.id, companyId));
    if (!co) throw new BusinessRuleError("Entreprise introuvable.");
    const now = new Date();
    const end = new Date(now.getTime() + d * 86_400_000);
    const existing = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.subscription).where(eq(schema.subscription.companyId, companyId));
    if (!existing[0]!.n) await tx.insert(schema.subscription).values({ companyId, planId, status: "active" });
    else await tx.update(schema.subscription).set({ planId, status: "active", updatedAt: now }).where(eq(schema.subscription.companyId, companyId));
    await tx.insert(schema.billingInvoice).values({ companyId, planId, number: await nextBillingNumber(tx, now.getUTCFullYear()), periodStart: now, periodEnd: end, amountMinor: 0, currency: plan.currency, status: "paid", paidAt: now, dueAt: now, paymentMethod: "complimentary", paymentReference: why });
    await platformAudit(tx, adminId, "subscription.complimentary", "company", companyId, { planCode: plan.code, days: d, reason: why });
  });
  clearAccessCache(companyId);
}

export async function extendTrial(adminId: string, companyId: string, days: number, reason: string) {
  await assertPlatformAdmin(adminId);
  const why = reasonSchema.parse(reason);
  const d = z.coerce.number().int().min(1).max(365).parse(days);
  await db.transaction(async (tx) => {
    const [sub] = await tx.select().from(schema.subscription).where(eq(schema.subscription.companyId, companyId)).for("update");
    if (!sub) throw new BusinessRuleError("Cette entreprise n'a pas d'abonnement.");
    const base = sub.trialEndsAt && sub.trialEndsAt > new Date() ? sub.trialEndsAt : new Date();
    await tx.update(schema.subscription).set({ trialEndsAt: new Date(base.getTime() + d * 86_400_000), status: "trialing", updatedAt: new Date() }).where(eq(schema.subscription.companyId, companyId));
    await platformAudit(tx, adminId, "subscription.trial_extended", "company", companyId, { days: d, reason: why });
  });
  clearAccessCache(companyId);
}

export async function setSuspended(adminId: string, companyId: string, suspended: boolean, reason: string) {
  await assertPlatformAdmin(adminId);
  const why = reasonSchema.parse(reason);
  await db.transaction(async (tx) => {
    const res = await tx
      .update(schema.subscription)
      .set(suspended ? { suspendedAt: new Date(), suspendedReason: why, updatedAt: new Date() } : { suspendedAt: null, suspendedReason: null, updatedAt: new Date() })
      .where(eq(schema.subscription.companyId, companyId))
      .returning({ id: schema.subscription.companyId });
    if (!res.length) throw new BusinessRuleError("Cette entreprise n'a pas d'abonnement à suspendre (elle n'est pas soumise à la facturation).");
    await platformAudit(tx, adminId, suspended ? "company.suspended" : "company.unsuspended", "company", companyId, { reason: why });
  });
  clearAccessCache(companyId);
}

export async function adminMarkInvoicePaid(adminId: string, invoiceId: string, input: { method: string; reference: string; paidAt?: string }) {
  await assertPlatformAdmin(adminId);
  const d = z.object({ method: z.enum(["bank_transfer", "mobile_money", "cash", "other"]), reference: z.string().trim().min(2, "Référence du paiement requise").max(200), paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(input);
  return markInvoicePaid(invoiceId, { method: d.method, reference: d.reference, paidAt: d.paidAt ? new Date(`${d.paidAt}T12:00:00Z`) : undefined, provider: "manual" }, adminId);
}

export async function adminVoidInvoice(adminId: string, invoiceId: string) {
  await assertPlatformAdmin(adminId);
  await voidInvoice(invoiceId, adminId);
}

export async function listPlatformAudit(adminId: string, before?: string) {
  await assertPlatformAdmin(adminId);
  const ts = before && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?$/.test(before) ? before : null;
  const rows = await db
    .select({ id: schema.platformAuditLog.id, action: schema.platformAuditLog.action, targetType: schema.platformAuditLog.targetType, targetId: schema.platformAuditLog.targetId, meta: schema.platformAuditLog.meta, createdAt: schema.platformAuditLog.createdAt, cursor: sql<string>`${schema.platformAuditLog.createdAt}::text`, actor: schema.user.email })
    .from(schema.platformAuditLog)
    .leftJoin(schema.user, eq(schema.user.id, schema.platformAuditLog.actorId))
    .where(ts ? sql`${schema.platformAuditLog.createdAt} < ${ts}::timestamp` : undefined)
    .orderBy(desc(schema.platformAuditLog.createdAt))
    .limit(51);
  return { rows: rows.slice(0, 50), next: rows.length > 50 ? rows[49]!.cursor : null };
}

