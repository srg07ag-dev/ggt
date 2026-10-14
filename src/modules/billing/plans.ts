import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { toMinor } from "@/lib/money";
import { clearAccessCache, MODULES } from "@/modules/core/entitlements";
import { BusinessRuleError } from "@/modules/core/errors";
import { assertPlatformAdmin, platformAudit } from "./platform";

const optInt = z.union([z.literal(""), z.coerce.number().int().min(0).max(1_000_000)]).optional().transform((v) => (v === "" || v === undefined ? null : v));

const planInput = z.object({
  code: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,39}$/, "Code : minuscules, chiffres et tirets (2 à 40)"),
  name: z.string().trim().min(1, "Nom requis").max(80),
  description: z.string().trim().max(500).optional().transform((v) => v || null),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Devise ISO sur 3 lettres"),
  price: z.string().trim().default("0"),
  interval: z.enum(["month", "year"]),
  trialDays: z.coerce.number().int().min(0).max(365).default(0),
  members: optInt,
  invoicesPerMonth: optInt,
  storageMb: optInt,
  modules: z.array(z.enum(MODULES)).min(1, "Choisissez au moins un module"),
  isPublic: z.boolean().default(true),
  isDefault: z.boolean().default(false),
});
export type PlanInput = z.input<typeof planInput>;

function normalize(input: PlanInput) {
  const d = planInput.parse(input);
  const priceMinor = toMinor(d.price || "0", d.currency);
  if (priceMinor === null) throw new z.ZodError([{ code: "custom", path: ["price"], message: "Prix invalide." }]);
  return {
    code: d.code, name: d.name, description: d.description, currency: d.currency, priceMinor, interval: d.interval, trialDays: d.trialDays,
    limits: { members: d.members, invoicesPerMonth: d.invoicesPerMonth, storageMb: d.storageMb }, modules: d.modules, isPublic: d.isPublic, isDefault: d.isDefault,
  };
}

export async function createPlan(adminId: string, input: PlanInput) {
  await assertPlatformAdmin(adminId);
  const v = normalize(input);
  const row = await db.transaction(async (tx) => {
    if (v.isDefault) await tx.update(schema.plan).set({ isDefault: false }).where(eq(schema.plan.isDefault, true));
    const [r] = await tx.insert(schema.plan).values(v).onConflictDoNothing().returning();
    if (!r) throw new BusinessRuleError(`Le code « ${v.code} » existe déjà.`);
    await platformAudit(tx, adminId, "plan.created", "plan", r.id, { code: v.code, priceMinor: v.priceMinor });
    return r;
  });
  clearAccessCache();
  return row;
}

/**
 * Modifie une offre. Le prix ne s'applique qu'aux **prochaines** factures (celles déjà émises sont figées) ;
 * les modules et limites s'appliquent immédiatement à tous les abonnés.
 */
export async function updatePlan(adminId: string, id: string, input: PlanInput) {
  await assertPlatformAdmin(adminId);
  const v = normalize(input);
  const row = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(schema.plan).where(eq(schema.plan.id, id)).for("update");
    if (!before) throw new BusinessRuleError("Offre introuvable.");
    if (v.currency !== before.currency || v.interval !== before.interval) {
      const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.subscription).where(eq(schema.subscription.planId, id));
      if (n > 0) throw new BusinessRuleError("La devise et la périodicité d'une offre ayant des abonnés ne peuvent pas changer : créez une nouvelle offre.");
    }
    if (v.isDefault) await tx.update(schema.plan).set({ isDefault: false }).where(and(eq(schema.plan.isDefault, true), ne(schema.plan.id, id)));
    const [r] = await tx.update(schema.plan).set(v).where(eq(schema.plan.id, id)).returning();
    await platformAudit(tx, adminId, "plan.updated", "plan", id, { before: { priceMinor: before.priceMinor, modules: before.modules, limits: before.limits }, after: { priceMinor: v.priceMinor, modules: v.modules, limits: v.limits } });
    return r!;
  });
  clearAccessCache();
  return row;
}

export async function archivePlan(adminId: string, id: string, archived: boolean) {
  await assertPlatformAdmin(adminId);
  await db.transaction(async (tx) => {
    const [p] = await tx.select().from(schema.plan).where(eq(schema.plan.id, id));
    if (!p) throw new BusinessRuleError("Offre introuvable.");
    if (archived && p.isDefault) throw new BusinessRuleError("L'offre par défaut ne peut pas être archivée : désignez-en une autre d'abord.");
    await tx.update(schema.plan).set({ archivedAt: archived ? new Date() : null }).where(eq(schema.plan.id, id));
    await platformAudit(tx, adminId, archived ? "plan.archived" : "plan.restored", "plan", id);
  });
  clearAccessCache();
}

export async function listPlansAdmin(adminId: string) {
  await assertPlatformAdmin(adminId);
  return db
    .select({ plan: schema.plan, subscribers: sql<number>`(select count(*)::int from subscription s where s.plan_id = ${schema.plan.id})` })
    .from(schema.plan)
    .orderBy(asc(schema.plan.priceMinor), asc(schema.plan.name));
}

/** Offres proposées aux entreprises (publiques, non archivées). */
export async function listPublicPlans() {
  return db.select().from(schema.plan).where(and(eq(schema.plan.isPublic, true), isNull(schema.plan.archivedAt))).orderBy(asc(schema.plan.priceMinor));
}
