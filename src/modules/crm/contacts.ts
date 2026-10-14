import { and, desc, eq, ilike, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@/db/client";
import { audit, requireMembership, withTenant } from "@/modules/core/tenant";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const contactInput = z.object({
  kind: z.enum(["person", "organization"]).default("person"),
  name: z.string().trim().min(1).max(160),
  email: z.union([z.literal(""), z.string().trim().email()]).optional().transform((v) => v || undefined),
  phone: optionalText(40),
  organization: optionalText(160),
  address: optionalText(400),
  notes: optionalText(5000),
  tags: z
    .array(z.string().trim().min(1).max(40))
    .max(20)
    .default([])
    .transform((t) => [...new Set(t)]),
  parentId: z.string().uuid().optional(),
});
export type ContactInput = z.input<typeof contactInput>;

export function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export async function createContact(userId: string, companyId: string, input: ContactInput) {
  const data = contactInput.parse(input);
  const ctx = await requireMembership(userId, companyId, "crm:write");
  return withTenant(ctx, async (tx) => {
    const [row] = await tx.insert(schema.contact).values({ ...data, companyId }).returning();
    await audit(tx, ctx, "contact.created", "contact", row!.id);
    return row!;
  });
}

export async function updateContact(userId: string, companyId: string, id: string, input: ContactInput) {
  const data = contactInput.parse(input);
  const ctx = await requireMembership(userId, companyId, "crm:write");
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .update(schema.contact)
      .set(data)
      .where(and(eq(schema.contact.id, id), eq(schema.contact.companyId, companyId)))
      .returning();
    if (!row) return null;
    await audit(tx, ctx, "contact.updated", "contact", id);
    return row;
  });
}

export async function setContactArchived(userId: string, companyId: string, id: string, archived: boolean) {
  const ctx = await requireMembership(userId, companyId, "crm:write");
  return withTenant(ctx, async (tx) => {
    const res = await tx
      .update(schema.contact)
      .set({ archivedAt: archived ? new Date() : null })
      .where(and(eq(schema.contact.id, id), eq(schema.contact.companyId, companyId)))
      .returning({ id: schema.contact.id });
    if (res.length) await audit(tx, ctx, archived ? "contact.archived" : "contact.restored", "contact", id);
    return res.length > 0;
  });
}

export interface ContactFilter {
  q?: string;
  kind?: "person" | "organization";
  archived?: boolean;
  tag?: string;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function listContacts(userId: string, companyId: string, filter: ContactFilter = {}) {
  const ctx = await requireMembership(userId, companyId, "crm:read");
  const conds: (SQL | undefined)[] = [
    eq(schema.contact.companyId, companyId),
    filter.archived ? isNotNull(schema.contact.archivedAt) : isNull(schema.contact.archivedAt),
    filter.kind ? eq(schema.contact.kind, filter.kind) : undefined,
    filter.tag ? sql`${filter.tag} = any(${schema.contact.tags})` : undefined,
  ];
  const q = filter.q?.trim();
  if (q) {
    const like = `%${escapeLike(q)}%`;
    conds.push(
      or(
        ilike(schema.contact.name, like),
        ilike(schema.contact.email, like),
        ilike(schema.contact.phone, like),
        ilike(schema.contact.organization, like),
      ),
    );
  }
  return withTenant(ctx, (tx) =>
    tx
      .select()
      .from(schema.contact)
      .where(and(...conds))
      .orderBy(desc(schema.contact.createdAt)),
  );
}

export async function countContactsByState(userId: string, companyId: string) {
  const ctx = await requireMembership(userId, companyId, "crm:read");
  const rows = await withTenant(ctx, (tx) =>
    tx
      .select({ archived: sql<boolean>`${schema.contact.archivedAt} is not null`, n: sql<number>`count(*)::int` })
      .from(schema.contact)
      .groupBy(sql`${schema.contact.archivedAt} is not null`),
  );
  return { active: rows.find((r) => !r.archived)?.n ?? 0, archived: rows.find((r) => r.archived)?.n ?? 0 };
}

export async function getContact(userId: string, companyId: string, id: string) {
  const ctx = await requireMembership(userId, companyId, "crm:read");
  return withTenant(ctx, async (tx) => {
    const [contact] = await tx
      .select()
      .from(schema.contact)
      .where(and(eq(schema.contact.id, id), eq(schema.contact.companyId, companyId)));
    if (!contact) return null;
    const people = await tx
      .select()
      .from(schema.contact)
      .where(and(eq(schema.contact.parentId, id), isNull(schema.contact.archivedAt)));
    return { contact, people };
  });
}

/** Contacts possibles comme client d'une opportunité ou parent d'un interlocuteur. */
export async function listContactOptions(userId: string, companyId: string, kind?: "organization") {
  const ctx = await requireMembership(userId, companyId, "crm:read");
  return withTenant(ctx, (tx) =>
    tx
      .select({ id: schema.contact.id, name: schema.contact.name })
      .from(schema.contact)
      .where(and(isNull(schema.contact.archivedAt), kind ? eq(schema.contact.kind, kind) : undefined))
      .orderBy(schema.contact.name),
  );
}
