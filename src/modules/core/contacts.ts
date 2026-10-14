import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@/db/client";
import { audit, requireMembership, withTenant } from "./tenant";

export const contactInput = z.object({
  kind: z.enum(["person", "organization"]).default("person"),
  name: z.string().trim().min(1).max(160),
  email: z.string().trim().email().optional().or(z.literal("").transform(() => undefined)),
  phone: z.string().trim().max(40).optional(),
  notes: z.string().max(5000).optional(),
});

export async function createContact(userId: string, companyId: string, input: z.input<typeof contactInput>) {
  const data = contactInput.parse(input);
  const ctx = await requireMembership(userId, companyId, "crm:write");
  return withTenant(ctx, async (tx) => {
    const [row] = await tx.insert(schema.contact).values({ ...data, companyId }).returning();
    await audit(tx, ctx, "contact.created", "contact", row!.id);
    return row!;
  });
}

export async function listContacts(userId: string, companyId: string) {
  const ctx = await requireMembership(userId, companyId, "crm:read");
  return withTenant(ctx, (tx) =>
    tx
      .select()
      .from(schema.contact)
      .where(and(eq(schema.contact.companyId, companyId), isNull(schema.contact.archivedAt)))
      .orderBy(desc(schema.contact.createdAt)),
  );
}
