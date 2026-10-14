import { asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@/db/client";
import { BusinessRuleError } from "@/modules/core/errors";
import { audit, requireMembership, withTenant, type TenantContext, type TenantTx } from "@/modules/core/tenant";

export const JOURNAL_KINDS = ["sales", "purchases", "treasury", "misc"] as const;
export const KIND_LABELS = { sales: "Ventes", purchases: "Achats et dépenses", treasury: "Trésorerie", misc: "Opérations diverses" } as const;

/** Journaux de départ (codes usuels, modifiables). Ils n'ont aucune portée réglementaire. */
const DEFAULT_JOURNALS = [
  ["VT", "Journal des ventes", "sales"],
  ["AC", "Journal des achats et dépenses", "purchases"],
  ["TR", "Journal de trésorerie", "treasury"],
  ["OD", "Opérations diverses", "misc"],
] as const;

export async function seedDefaultJournals(tx: TenantTx, ctx: TenantContext) {
  await tx.insert(schema.journal).values(DEFAULT_JOURNALS.map(([code, name, kind]) => ({ companyId: ctx.companyId, code, name, kind })));
}

export async function listJournals(userId: string, companyId: string) {
  const ctx = await requireMembership(userId, companyId, "accounting:read");
  return withTenant(ctx, (tx) => tx.select().from(schema.journal).where(isNull(schema.journal.archivedAt)).orderBy(asc(schema.journal.code)));
}

export async function createJournal(userId: string, companyId: string, input: { code: string; name: string; kind: string }) {
  const data = z
    .object({ code: z.string().trim().regex(/^[A-Za-z0-9]{1,8}$/, "Code : 1 à 8 lettres ou chiffres"), name: z.string().trim().min(1).max(80), kind: z.enum(JOURNAL_KINDS) })
    .parse(input);
  const ctx = await requireMembership(userId, companyId, "accounting:write");
  return withTenant(ctx, async (tx) => {
    const [row] = await tx.insert(schema.journal).values({ ...data, companyId }).onConflictDoNothing().returning();
    if (!row) throw new BusinessRuleError(`Le journal ${data.code} existe déjà.`);
    await audit(tx, ctx, "journal.created", "journal", row.id);
    return row;
  });
}

export async function archiveJournal(userId: string, companyId: string, id: string) {
  const ctx = await requireMembership(userId, companyId, "accounting:write");
  await withTenant(ctx, async (tx) => {
    await tx.update(schema.journal).set({ archivedAt: new Date() }).where(eq(schema.journal.id, id));
    await audit(tx, ctx, "journal.archived", "journal", id);
  });
}
