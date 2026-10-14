import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { validatePattern, type DocType } from "@/modules/sales/numbering";
import { audit, requireMembership, withTenant } from "./tenant";

export async function getCompanyProfile(userId: string, companyId: string) {
  await requireMembership(userId, companyId);
  const [row] = await db.select().from(schema.company).where(eq(schema.company.id, companyId));
  return row!;
}

export async function updateCompanyProfile(
  userId: string,
  companyId: string,
  input: { name: string; address?: string; taxId?: string; email?: string; phone?: string },
) {
  const data = z
    .object({
      name: z.string().trim().min(2).max(120),
      address: z.string().trim().max(400).optional(),
      taxId: z.string().trim().max(60).optional(),
      email: z.union([z.literal(""), z.string().trim().email()]).optional(),
      phone: z.string().trim().max(40).optional(),
    })
    .parse(input);
  const ctx = await requireMembership(userId, companyId, "company:manage");
  await withTenant(ctx, async (tx) => {
    await tx
      .update(schema.company)
      .set({ name: data.name, address: data.address || null, taxId: data.taxId || null, email: data.email || null, phone: data.phone || null })
      .where(eq(schema.company.id, companyId));
    await audit(tx, ctx, "company.updated", "company", companyId);
  });
}

export async function getNumbering(userId: string, companyId: string) {
  const ctx = await requireMembership(userId, companyId, "sales:read");
  const rows = await withTenant(ctx, (tx) => tx.select().from(schema.numbering));
  return Object.fromEntries(rows.map((r) => [r.docType, r.pattern])) as Partial<Record<DocType, string>>;
}

/** Le motif peut changer pour les prochains documents ; les numéros déjà attribués ne bougent jamais. */
export async function setNumbering(userId: string, companyId: string, docType: DocType, pattern: string) {
  const err = validatePattern(pattern);
  if (err) throw new z.ZodError([{ code: "custom", path: ["pattern"], message: err }]);
  const ctx = await requireMembership(userId, companyId, "company:manage");
  await withTenant(ctx, async (tx) => {
    await tx
      .insert(schema.numbering)
      .values({ companyId, docType, pattern })
      .onConflictDoUpdate({ target: [schema.numbering.companyId, schema.numbering.docType], set: { pattern } });
    await audit(tx, ctx, "numbering.updated", "numbering", docType, { pattern });
  });
}
