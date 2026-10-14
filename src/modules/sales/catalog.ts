import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@/db/client";
import { toMinor } from "@/lib/money";
import { audit, requireMembership, withTenant } from "@/modules/core/tenant";
import { parseRatePercent } from "./calc";

const fail = (path: string, message: string) => new z.ZodError([{ code: "custom", path: [path], message }]);

export async function listTaxRates(userId: string, companyId: string) {
  const ctx = await requireMembership(userId, companyId, "sales:read");
  return withTenant(ctx, (tx) =>
    tx.select().from(schema.taxRate).where(isNull(schema.taxRate.archivedAt)).orderBy(asc(schema.taxRate.name)),
  );
}

export async function createTaxRate(userId: string, companyId: string, input: { name: string; ratePercent: string }) {
  const name = z.string().trim().min(1).max(60).parse(input.name);
  const rateBp = parseRatePercent(input.ratePercent);
  if (rateBp === null) throw fail("ratePercent", "Taux invalide (0 à 100, 2 décimales maximum).");
  const ctx = await requireMembership(userId, companyId, "company:manage");
  return withTenant(ctx, async (tx) => {
    const [row] = await tx.insert(schema.taxRate).values({ companyId, name, rateBp }).returning();
    await audit(tx, ctx, "tax_rate.created", "tax_rate", row!.id, { name, rateBp });
    return row!;
  });
}

export async function archiveTaxRate(userId: string, companyId: string, id: string) {
  const ctx = await requireMembership(userId, companyId, "company:manage");
  await withTenant(ctx, async (tx) => {
    await tx.update(schema.taxRate).set({ archivedAt: new Date() }).where(eq(schema.taxRate.id, id));
    await audit(tx, ctx, "tax_rate.archived", "tax_rate", id);
  });
}

export async function listProducts(userId: string, companyId: string, includeArchived = false) {
  const ctx = await requireMembership(userId, companyId, "sales:read");
  return withTenant(ctx, (tx) =>
    tx
      .select({
        id: schema.product.id,
        kind: schema.product.kind,
        name: schema.product.name,
        description: schema.product.description,
        unitPriceMinor: schema.product.unitPriceMinor,
        taxRateId: schema.product.taxRateId,
        taxName: schema.taxRate.name,
        taxRateBp: schema.taxRate.rateBp,
        archivedAt: schema.product.archivedAt,
      })
      .from(schema.product)
      .leftJoin(
        schema.taxRate,
        and(eq(schema.taxRate.id, schema.product.taxRateId), eq(schema.taxRate.companyId, schema.product.companyId)),
      )
      .where(includeArchived ? undefined : isNull(schema.product.archivedAt))
      .orderBy(asc(schema.product.name)),
  );
}

export async function createProduct(
  userId: string,
  companyId: string,
  input: { kind: string; name: string; description?: string; price: string; taxRateId?: string },
) {
  const data = z
    .object({
      kind: z.enum(["product", "service"]),
      name: z.string().trim().min(1).max(160),
      description: z.string().trim().max(1000).optional(),
      taxRateId: z.string().uuid().optional(),
    })
    .parse(input);
  const ctx = await requireMembership(userId, companyId, "sales:write");
  return withTenant(ctx, async (tx) => {
    const [co] = await tx.select({ currency: schema.company.currency }).from(schema.company).where(eq(schema.company.id, companyId));
    const unitPriceMinor = toMinor(input.price || "0", co!.currency);
    if (unitPriceMinor === null) throw fail("price", "Prix invalide.");
    const [row] = await tx
      .insert(schema.product)
      .values({ ...data, companyId, unitPriceMinor, description: data.description || null })
      .returning();
    await audit(tx, ctx, "product.created", "product", row!.id);
    return row!;
  });
}

export async function archiveProduct(userId: string, companyId: string, id: string) {
  const ctx = await requireMembership(userId, companyId, "sales:write");
  await withTenant(ctx, async (tx) => {
    await tx.update(schema.product).set({ archivedAt: new Date() }).where(eq(schema.product.id, id));
    await audit(tx, ctx, "product.archived", "product", id);
  });
}
