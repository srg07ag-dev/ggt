import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { clearAccessCache } from "@/modules/core/entitlements";
import { BusinessRuleError } from "@/modules/core/errors";
import { ForbiddenError } from "@/modules/core/tenant";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Accès à l'administration de la plateforme : droit d'opérateur ET double authentification activée.
 * Les opérateurs voient des métadonnées (entreprises, abonnements, factures d'abonnement), jamais les données métier des entreprises.
 */
export async function assertPlatformAdmin(userId: string) {
  const [u] = await db.select({ admin: schema.user.isPlatformAdmin, twoFactor: schema.user.twoFactorEnabled, name: schema.user.name }).from(schema.user).where(eq(schema.user.id, userId));
  if (!u?.admin) throw new ForbiddenError();
  if (!u.twoFactor) throw new ForbiddenError("La double authentification est obligatoire pour l'administration.");
  return { id: userId, name: u.name };
}

export async function platformAudit(tx: Tx | typeof db, actorId: string | null, action: string, targetType: string, targetId?: string, meta?: unknown) {
  await tx.insert(schema.platformAuditLog).values({ actorId, action, targetType, targetId, meta: meta ?? null });
}

export async function getPlatformSettings() {
  const [s] = await db.select().from(schema.platformSettings).where(eq(schema.platformSettings.id, 1));
  return s!;
}

export async function savePlatformSettings(adminId: string, input: { billingEnabled: boolean; paymentInstructions?: string; graceDays: number }) {
  await assertPlatformAdmin(adminId);
  const data = z.object({ billingEnabled: z.boolean(), paymentInstructions: z.string().trim().max(2000).optional().transform((v) => v || null), graceDays: z.coerce.number().int().min(0).max(60) }).parse(input);
  await db.transaction(async (tx) => {
    if (data.billingEnabled) {
      const [def] = await tx.select({ id: schema.plan.id }).from(schema.plan).where(sql`${schema.plan.isDefault} and ${schema.plan.archivedAt} is null`);
      if (!def) throw new BusinessRuleError("Définissez d'abord une offre par défaut : elle est attribuée aux nouvelles entreprises.");
    }
    await tx.update(schema.platformSettings).set({ ...data, updatedAt: new Date() }).where(eq(schema.platformSettings.id, 1));
    await platformAudit(tx, adminId, "settings.saved", "platform_settings", "1", data);
  });
  clearAccessCache();
}

/** Numéro de facture d'abonnement sans trou, par année : GGT-2026-000001. */
export async function nextBillingNumber(tx: Tx, year: number) {
  const rows = await tx.execute<{ last: number }>(sql`
    insert into platform_counter (key, last) values (${`billing-${year}`}, 1)
    on conflict (key) do update set last = platform_counter.last + 1
    returning last`);
  return `GGT-${year}-${String(rows[0]!.last).padStart(6, "0")}`;
}

/** Ajoute un mois ou un an en UTC, en conservant le jour quand c'est possible (31 janvier + 1 mois = 28/29 février). */
export function addInterval(date: Date, interval: "month" | "year"): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  if (interval === "year") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

export type { Tx };
