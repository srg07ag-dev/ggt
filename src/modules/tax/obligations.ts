import { asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@/db/client";
import { todayIn } from "@/lib/dates";
import { toMinor } from "@/lib/money";
import { BusinessRuleError } from "@/modules/core/errors";
import { audit, ForbiddenError, requireMembership, withTenant } from "@/modules/core/tenant";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const fail = (path: string, message: string) => new z.ZodError([{ code: "custom", path: [path], message }]);

/* ---------- Profil fiscal déclaré ---------- */

export async function getTaxProfile(userId: string, companyId: string) {
  const ctx = await requireMembership(userId, companyId, "tax:read");
  return withTenant(ctx, async (tx) => {
    const [co] = await tx.select({ country: schema.company.country, taxId: schema.company.taxId }).from(schema.company).where(eq(schema.company.id, companyId));
    const [p] = await tx.select().from(schema.companyTaxProfile).where(eq(schema.companyTaxProfile.companyId, companyId));
    return { country: co!.country, taxId: co!.taxId, profile: p ?? null };
  });
}

export async function saveTaxProfile(userId: string, companyId: string, input: { regimeLabel?: string; vatRegistered?: "yes" | "no" | ""; filingFrequency?: string; notes?: string }) {
  const data = z
    .object({
      regimeLabel: z.string().trim().max(120).optional().transform((v) => v || null),
      filingFrequency: z.string().trim().max(60).optional().transform((v) => v || null),
      notes: z.string().trim().max(2000).optional().transform((v) => v || null),
    })
    .parse(input);
  const vat = input.vatRegistered === "yes" ? true : input.vatRegistered === "no" ? false : null;
  const ctx = await requireMembership(userId, companyId, "tax:write");
  await withTenant(ctx, async (tx) => {
    await tx
      .insert(schema.companyTaxProfile)
      .values({ companyId, ...data, vatRegistered: vat, updatedAt: new Date() })
      .onConflictDoUpdate({ target: schema.companyTaxProfile.companyId, set: { ...data, vatRegistered: vat, updatedAt: new Date() } });
    await audit(tx, ctx, "tax_profile.saved", "company_tax_profile", companyId);
  });
}

/* ---------- Échéances ---------- */

export type ObligationState = "todo" | "overdue" | "due_soon" | "filed" | "paid" | "not_applicable";

export function obligationState(o: { status: "todo" | "filed" | "paid" | "not_applicable"; dueDate: string }, today: string): ObligationState {
  if (o.status !== "todo") return o.status;
  if (o.dueDate < today) return "overdue";
  const days = (Date.parse(o.dueDate) - Date.parse(today)) / 86_400_000;
  return days <= 14 ? "due_soon" : "todo";
}

export async function listObligations(userId: string, companyId: string) {
  const ctx = await requireMembership(userId, companyId, "tax:read");
  return withTenant(ctx, async (tx) => {
    const [co] = await tx.select({ tz: schema.company.timezone }).from(schema.company).where(eq(schema.company.id, companyId));
    const today = todayIn(co!.tz);
    const rows = await tx.select().from(schema.taxObligation).orderBy(asc(schema.taxObligation.dueDate));
    return rows.map((o) => ({ ...o, state: obligationState(o, today) }));
  });
}

/** Prochaines échéances non soldées (tableau de bord). */
export async function upcomingObligations(userId: string, companyId: string, limit = 5) {
  const ctx = await requireMembership(userId, companyId, "tax:read");
  return withTenant(ctx, async (tx) => {
    const [co] = await tx.select({ tz: schema.company.timezone }).from(schema.company).where(eq(schema.company.id, companyId));
    const today = todayIn(co!.tz);
    const rows = await tx.select().from(schema.taxObligation).where(eq(schema.taxObligation.status, "todo")).orderBy(asc(schema.taxObligation.dueDate)).limit(limit);
    return rows.map((o) => ({ ...o, state: obligationState(o, today) }));
  });
}

export async function createObligation(userId: string, companyId: string, input: { title: string; authority?: string; periodLabel?: string; dueDate: string; notes?: string }) {
  const data = z
    .object({
      title: z.string().trim().min(1, "Intitulé requis").max(160),
      authority: z.string().trim().max(120).optional().transform((v) => v || null),
      periodLabel: z.string().trim().max(60).optional().transform((v) => v || null),
      dueDate: z.string().regex(DATE, "Date d'échéance invalide"),
      notes: z.string().trim().max(2000).optional().transform((v) => v || null),
    })
    .parse(input);
  const ctx = await requireMembership(userId, companyId, "tax:write");
  return withTenant(ctx, async (tx) => {
    const [row] = await tx.insert(schema.taxObligation).values({ ...data, companyId, createdBy: userId }).returning();
    await audit(tx, ctx, "tax_obligation.created", "tax_obligation", row!.id);
    return row!;
  });
}

export async function getObligation(userId: string, companyId: string, id: string) {
  const ctx = await requireMembership(userId, companyId, "tax:read");
  return withTenant(ctx, async (tx) => {
    const [o] = await tx.select().from(schema.taxObligation).where(eq(schema.taxObligation.id, id));
    if (!o) return null;
    const events = await tx.select().from(schema.taxEvent).where(eq(schema.taxEvent.obligationId, id)).orderBy(desc(schema.taxEvent.occurredOn), desc(schema.taxEvent.createdAt));
    return { obligation: o, events };
  });
}

/** Enregistre une déclaration, un paiement ou une note : l'historique est en ajout seul ; le statut suit le dernier jalon. */
export async function recordTaxEvent(userId: string, companyId: string, obligationId: string, input: { kind: string; occurredOn: string; amount?: string; reference?: string; notes?: string }) {
  const data = z
    .object({
      kind: z.enum(["filed", "paid", "note"]),
      occurredOn: z.string().regex(DATE, "Date invalide"),
      reference: z.string().trim().max(120).optional().transform((v) => v || null),
      notes: z.string().trim().max(2000).optional().transform((v) => v || null),
    })
    .parse(input);
  const ctx = await requireMembership(userId, companyId, "tax:write");
  return withTenant(ctx, async (tx) => {
    const [o] = await tx.select().from(schema.taxObligation).where(eq(schema.taxObligation.id, obligationId)).for("update");
    if (!o) throw new ForbiddenError();
    if (o.status === "not_applicable") throw new BusinessRuleError("Cette échéance est marquée « non applicable ».");
    const [co] = await tx.select({ currency: schema.company.currency }).from(schema.company).where(eq(schema.company.id, companyId));
    let amountMinor: number | null = null;
    if (input.amount?.trim()) {
      amountMinor = toMinor(input.amount, co!.currency);
      if (amountMinor === null) throw fail("amount", "Montant invalide.");
    }
    if (data.kind === "paid" && amountMinor === null) throw fail("amount", "Indiquez le montant payé.");
    const [ev] = await tx.insert(schema.taxEvent).values({ ...data, companyId, obligationId, amountMinor, createdBy: userId }).returning();
    if (data.kind !== "note") {
      // « payé » prime sur « déclaré » ; une déclaration enregistrée après un paiement ne fait pas reculer le statut
      const next = data.kind === "paid" ? "paid" : o.status === "paid" ? "paid" : "filed";
      await tx.update(schema.taxObligation).set({ status: next }).where(eq(schema.taxObligation.id, obligationId));
    }
    await audit(tx, ctx, `tax_event.${data.kind}`, "tax_obligation", obligationId, { amountMinor });
    return ev!;
  });
}

export async function setObligationNotApplicable(userId: string, companyId: string, id: string, notApplicable: boolean) {
  const ctx = await requireMembership(userId, companyId, "tax:write");
  await withTenant(ctx, async (tx) => {
    const [o] = await tx.select().from(schema.taxObligation).where(eq(schema.taxObligation.id, id)).for("update");
    if (!o) throw new ForbiddenError();
    if (notApplicable && o.status !== "todo") throw new BusinessRuleError("Une échéance déjà déclarée ou payée ne peut pas devenir « non applicable ».");
    if (!notApplicable && o.status !== "not_applicable") return;
    await tx.update(schema.taxObligation).set({ status: notApplicable ? "not_applicable" : "todo" }).where(eq(schema.taxObligation.id, id));
    await audit(tx, ctx, "tax_obligation.status", "tax_obligation", id, { notApplicable });
  });
}

/** Une échéance sans historique peut être supprimée (erreur de saisie) ; sinon elle reste, car l'historique est probatoire. */
export async function deleteObligation(userId: string, companyId: string, id: string) {
  const ctx = await requireMembership(userId, companyId, "tax:write");
  await withTenant(ctx, async (tx) => {
    const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.taxEvent).where(eq(schema.taxEvent.obligationId, id));
    if (n > 0) throw new BusinessRuleError("Cette échéance a un historique : elle ne peut pas être supprimée.");
    const res = await tx.delete(schema.taxObligation).where(eq(schema.taxObligation.id, id)).returning({ id: schema.taxObligation.id });
    if (!res.length) throw new ForbiddenError();
    await audit(tx, ctx, "tax_obligation.deleted", "tax_obligation", id);
  });
}

