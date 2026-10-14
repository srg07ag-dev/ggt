import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { seedDefaultStages } from "@/modules/crm/pipeline";
import { audit, withTenant } from "./tenant";

export const createCompanySchema = z.object({
  name: z.string().trim().min(2).max(120),
  country: z.string().length(2).toUpperCase(),
  currency: z.string().length(3).toUpperCase(),
  locale: z.string().min(2).max(10).default("fr-FR"),
  timezone: z.string().min(1).max(64).default("UTC"),
});
export type CreateCompanyInput = z.input<typeof createCompanySchema>;

/** Crée une entreprise et fait de l'utilisateur son propriétaire, en une transaction. */
export async function createCompany(userId: string, input: CreateCompanyInput) {
  const data = createCompanySchema.parse(input);
  const [created] = await db.transaction(async (tx) => {
    const rows = await tx.insert(schema.company).values(data).returning();
    const c = rows[0]!;
    await tx.insert(schema.membership).values({ companyId: c.id, userId, role: "owner" });
    return rows;
  });
  const company = created!;
  const ctx = { userId, companyId: company.id, role: "owner" as const };
  await withTenant(ctx, async (tx) => {
    await seedDefaultStages(tx, ctx);
    await audit(tx, ctx, "company.created", "company", company.id);
  });
  return company;
}

export async function listCompaniesForUser(userId: string) {
  return db
    .select({
      id: schema.company.id,
      name: schema.company.name,
      country: schema.company.country,
      currency: schema.company.currency,
      role: schema.membership.role,
    })
    .from(schema.membership)
    .innerJoin(schema.company, eq(schema.company.id, schema.membership.companyId))
    .where(eq(schema.membership.userId, userId));
}
