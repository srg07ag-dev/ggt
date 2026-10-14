import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@/db/client";
import { audit, requireMembership, withTenant } from "@/modules/core/tenant";

export const activityInput = z.object({
  type: z.enum(["call", "meeting", "note", "follow_up", "deadline"]),
  title: z.string().trim().min(1).max(200),
  body: z.string().max(5000).optional(),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  dueAt: z.union([z.literal(""), z.string().min(8)]).optional().transform((v) => (v ? new Date(v) : undefined)),
  contactId: z.string().uuid().optional(),
  opportunityId: z.string().uuid().optional(),
  assigneeId: z.string().min(1).optional(),
});

export async function createActivity(userId: string, companyId: string, input: z.input<typeof activityInput>) {
  const data = activityInput.parse(input);
  if (data.dueAt && Number.isNaN(data.dueAt.getTime())) throw new z.ZodError([{ code: "custom", path: ["dueAt"], message: "Date invalide" }]);
  const ctx = await requireMembership(userId, companyId, "crm:write");
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .insert(schema.activity)
      .values({ ...data, companyId, createdBy: userId, status: data.type === "note" ? "done" : "todo" })
      .returning();
    await audit(tx, ctx, "activity.created", "activity", row!.id);
    return row!;
  });
}

export interface ActivityFilter {
  status?: "todo" | "done" | "cancelled";
  contactId?: string;
  assigneeId?: string;
}

export async function listActivities(userId: string, companyId: string, f: ActivityFilter = {}) {
  const ctx = await requireMembership(userId, companyId, "crm:read");
  const conds: (SQL | undefined)[] = [
    eq(schema.activity.companyId, companyId),
    f.status ? eq(schema.activity.status, f.status) : undefined,
    f.contactId ? eq(schema.activity.contactId, f.contactId) : undefined,
    f.assigneeId ? eq(schema.activity.assigneeId, f.assigneeId) : undefined,
  ];
  return withTenant(ctx, (tx) =>
    tx
      .select({
        id: schema.activity.id,
        type: schema.activity.type,
        title: schema.activity.title,
        priority: schema.activity.priority,
        status: schema.activity.status,
        dueAt: schema.activity.dueAt,
        contactId: schema.activity.contactId,
        contactName: schema.contact.name,
        createdAt: schema.activity.createdAt,
      })
      .from(schema.activity)
      .leftJoin(
        schema.contact,
        and(eq(schema.contact.id, schema.activity.contactId), eq(schema.contact.companyId, schema.activity.companyId)),
      )
      .where(and(...conds))
      // à faire d'abord, échéance la plus proche en tête, sans échéance en dernier
      .orderBy(sql`${schema.activity.status} = 'todo' desc`, sql`${schema.activity.dueAt} asc nulls last`, desc(schema.activity.createdAt)),
  );
}

export async function setActivityStatus(userId: string, companyId: string, id: string, status: "todo" | "done" | "cancelled") {
  const ctx = await requireMembership(userId, companyId, "crm:write");
  return withTenant(ctx, async (tx) => {
    const res = await tx
      .update(schema.activity)
      .set({ status, completedAt: status === "done" ? new Date() : null })
      .where(and(eq(schema.activity.id, id), eq(schema.activity.companyId, companyId)))
      .returning({ id: schema.activity.id });
    if (res.length) await audit(tx, ctx, "activity.status", "activity", id, { status });
    return res.length > 0;
  });
}

export async function countOpenActivities(userId: string, companyId: string) {
  const ctx = await requireMembership(userId, companyId, "crm:read");
  const [r] = await withTenant(ctx, (tx) =>
    tx
      .select({
        open: sql<number>`count(*) filter (where ${schema.activity.status} = 'todo')::int`,
        overdue: sql<number>`count(*) filter (where ${schema.activity.status} = 'todo' and ${schema.activity.dueAt} < now())::int`,
      })
      .from(schema.activity),
  );
  return r ?? { open: 0, overdue: 0 };
}

