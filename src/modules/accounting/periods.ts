import { and, asc, eq, lte, gte } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@/db/client";
import { BusinessRuleError } from "@/modules/core/errors";
import { audit, requireMembership, withTenant, type TenantTx } from "@/modules/core/tenant";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const fail = (path: string, message: string) => new z.ZodError([{ code: "custom", path: [path], message }]);

export async function listPeriods(userId: string, companyId: string) {
  const ctx = await requireMembership(userId, companyId, "accounting:read");
  return withTenant(ctx, (tx) => tx.select().from(schema.fiscalPeriod).orderBy(asc(schema.fiscalPeriod.startDate)));
}

export async function createPeriod(userId: string, companyId: string, input: { name: string; startDate: string; endDate: string }) {
  const data = z
    .object({ name: z.string().trim().min(1, "Nom requis").max(60), startDate: z.string().regex(DATE, "Date de début invalide"), endDate: z.string().regex(DATE, "Date de fin invalide") })
    .parse(input);
  if (data.endDate < data.startDate) throw fail("endDate", "La fin précède le début.");
  const ctx = await requireMembership(userId, companyId, "accounting:write");
  return withTenant(ctx, async (tx) => {
    try {
      const [row] = await tx.insert(schema.fiscalPeriod).values({ ...data, companyId }).returning();
      await audit(tx, ctx, "period.created", "fiscal_period", row!.id, data);
      return row!;
    } catch (e) {
      if (/fiscal_period_no_overlap|chevauch|exclusion/i.test(String((e as { cause?: { message?: string } }).cause?.message ?? e))) {
        throw new BusinessRuleError("Cette période en chevauche une autre.");
      }
      throw e;
    }
  });
}

/** Période contenant la date (ouverte ou non). */
export async function periodForDate(tx: TenantTx, date: string) {
  const [p] = await tx.select().from(schema.fiscalPeriod).where(and(lte(schema.fiscalPeriod.startDate, date), gte(schema.fiscalPeriod.endDate, date)));
  return p ?? null;
}

export async function closePeriod(userId: string, companyId: string, id: string) {
  const ctx = await requireMembership(userId, companyId, "accounting:write");
  await withTenant(ctx, async (tx) => {
    const [p] = await tx.select().from(schema.fiscalPeriod).where(eq(schema.fiscalPeriod.id, id));
    if (!p) throw new BusinessRuleError("Période introuvable.");
    if (p.status === "closed") throw new BusinessRuleError("Cette période est déjà clôturée.");
    try {
      await tx.update(schema.fiscalPeriod).set({ status: "closed", closedAt: new Date(), closedBy: userId }).where(eq(schema.fiscalPeriod.id, id));
    } catch (e) {
      const m = String((e as { cause?: { message?: string } }).cause?.message ?? "");
      if (/brouillon/.test(m)) throw new BusinessRuleError(m.replace(/^.*?(Validez)/, "$1"));
      throw e;
    }
    await audit(tx, ctx, "period.closed", "fiscal_period", id);
  });
}

/** Rouvrir une période clôturée est exceptionnel : réservé au propriétaire, avec un motif conservé dans l'audit. */
export async function reopenPeriod(userId: string, companyId: string, id: string, reason: string) {
  const why = z.string().trim().min(5, "Indiquez un motif (5 caractères minimum)").max(300).parse(reason);
  const ctx = await requireMembership(userId, companyId, "company:manage");
  await withTenant(ctx, async (tx) => {
    const res = await tx.update(schema.fiscalPeriod).set({ status: "open", closedAt: null, closedBy: null }).where(and(eq(schema.fiscalPeriod.id, id), eq(schema.fiscalPeriod.status, "closed"))).returning({ id: schema.fiscalPeriod.id });
    if (!res.length) throw new BusinessRuleError("Période introuvable ou déjà ouverte.");
    await audit(tx, ctx, "period.reopened", "fiscal_period", id, { reason: why });
  });
}
