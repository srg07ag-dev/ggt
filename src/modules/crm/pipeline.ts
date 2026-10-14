import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@/db/client";
import { audit, ForbiddenError, requireMembership, withTenant, type TenantContext, type TenantTx } from "@/modules/core/tenant";
import { toMinor } from "@/lib/money";

export const DEFAULT_STAGES = [
  { name: "Nouveau prospect", kind: "open", probability: 10 },
  { name: "Contacté", kind: "open", probability: 20 },
  { name: "Qualification", kind: "open", probability: 40 },
  { name: "Proposition envoyée", kind: "open", probability: 60 },
  { name: "Négociation", kind: "open", probability: 80 },
  { name: "Gagné", kind: "won", probability: 100 },
  { name: "Perdu", kind: "lost", probability: 0 },
] as const;

/** À appeler dans un withTenant lors de la création de l'entreprise. */
export async function seedDefaultStages(tx: TenantTx, ctx: TenantContext) {
  await tx.insert(schema.pipelineStage).values(
    DEFAULT_STAGES.map((s, i) => ({ companyId: ctx.companyId, name: s.name, kind: s.kind, position: i })),
  );
}

const DEFAULT_PROBABILITY: Record<string, number> = Object.fromEntries(DEFAULT_STAGES.map((s) => [s.name, s.probability]));

export async function listStages(userId: string, companyId: string) {
  const ctx = await requireMembership(userId, companyId, "crm:read");
  return withTenant(ctx, (tx) => tx.select().from(schema.pipelineStage).orderBy(asc(schema.pipelineStage.position)));
}

export async function listOpportunities(userId: string, companyId: string) {
  const ctx = await requireMembership(userId, companyId, "crm:read");
  return withTenant(ctx, (tx) =>
    tx
      .select({
        id: schema.opportunity.id,
        title: schema.opportunity.title,
        stageId: schema.opportunity.stageId,
        amountMinor: schema.opportunity.amountMinor,
        currency: schema.opportunity.currency,
        probability: schema.opportunity.probability,
        expectedClose: schema.opportunity.expectedClose,
        contactId: schema.opportunity.contactId,
        contactName: schema.contact.name,
      })
      .from(schema.opportunity)
      .innerJoin(
        schema.contact,
        and(eq(schema.contact.id, schema.opportunity.contactId), eq(schema.contact.companyId, schema.opportunity.companyId)),
      )
      .orderBy(desc(schema.opportunity.createdAt)),
  );
}

export const opportunityInput = z.object({
  contactId: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  /** Montant saisi en unités majeures (« 1 250,50 »). */
  amount: z.string().trim().default("0"),
  probability: z.coerce.number().int().min(0).max(100).optional(),
  expectedClose: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional().transform((v) => v || undefined),
});

export async function createOpportunity(userId: string, companyId: string, input: z.input<typeof opportunityInput>) {
  const data = opportunityInput.parse(input);
  const ctx = await requireMembership(userId, companyId, "crm:write");
  return withTenant(ctx, async (tx) => {
    const [co] = await tx.select({ currency: schema.company.currency }).from(schema.company).where(eq(schema.company.id, companyId));
    const amountMinor = toMinor(data.amount || "0", co!.currency);
    if (amountMinor === null) throw new z.ZodError([{ code: "custom", path: ["amount"], message: "Montant invalide" }]);
    const [first] = await tx
      .select()
      .from(schema.pipelineStage)
      .where(eq(schema.pipelineStage.kind, "open"))
      .orderBy(asc(schema.pipelineStage.position))
      .limit(1);
    if (!first) throw new Error("Aucune étape de pipeline");
    const [row] = await tx
      .insert(schema.opportunity)
      .values({
        companyId,
        contactId: data.contactId,
        stageId: first.id,
        title: data.title,
        amountMinor,
        currency: co!.currency,
        probability: data.probability ?? DEFAULT_PROBABILITY[first.name] ?? 10,
        expectedClose: data.expectedClose,
      })
      .returning();
    await audit(tx, ctx, "opportunity.created", "opportunity", row!.id);
    return row!;
  });
}

/** Déplace une opportunité ; « Gagné » et « Perdu » fixent la probabilité et la date de clôture. */
export async function moveOpportunity(userId: string, companyId: string, id: string, stageId: string) {
  const ctx = await requireMembership(userId, companyId, "crm:write");
  return withTenant(ctx, async (tx) => {
    const [stage] = await tx.select().from(schema.pipelineStage).where(eq(schema.pipelineStage.id, stageId));
    if (!stage) throw new ForbiddenError();
    const closed = stage.kind !== "open";
    const patch = {
      stageId,
      closedAt: closed ? new Date() : null,
      ...(stage.kind === "won" ? { probability: 100 } : stage.kind === "lost" ? { probability: 0 } : {}),
    };
    const res = await tx
      .update(schema.opportunity)
      .set(patch)
      .where(and(eq(schema.opportunity.id, id), eq(schema.opportunity.companyId, companyId)))
      .returning({ id: schema.opportunity.id });
    if (!res.length) return false;
    await audit(tx, ctx, "opportunity.moved", "opportunity", id, { stage: stage.name });
    return true;
  });
}
