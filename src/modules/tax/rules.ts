import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { BusinessRuleError } from "@/modules/core/errors";

export type Ruleset = typeof schema.ruleset.$inferSelect;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Règle réglementaire applicable à une date : uniquement une règle **validée** dont la période de validité couvre cette date.
 * Un brouillon n'est jamais appliqué, une règle retirée ne s'applique plus au-delà de sa fin, et les règles anciennes restent
 * résolvables pour les dates passées : changer de règle ne réécrit jamais l'historique.
 */
export async function resolveRuleset(jurisdiction: string, kind: string, code: string, date: string): Promise<Ruleset | null> {
  if (!DATE.test(date)) throw new BusinessRuleError("Date invalide.");
  const [row] = await db
    .select()
    .from(schema.ruleset)
    .where(
      and(
        eq(schema.ruleset.jurisdiction, jurisdiction.toUpperCase()),
        eq(schema.ruleset.kind, kind),
        eq(schema.ruleset.code, code),
        or(eq(schema.ruleset.status, "validated"), eq(schema.ruleset.status, "retired")),
        lte(schema.ruleset.validFrom, date),
        or(isNull(schema.ruleset.validTo), gte(schema.ruleset.validTo, date)),
      ),
    )
    .orderBy(desc(schema.ruleset.version))
    .limit(1);
  return row ?? null;
}

/** Règles validées d'un pays (toutes versions), pour l'affichage. */
export async function listValidatedRulesets(jurisdiction: string) {
  return db
    .select()
    .from(schema.ruleset)
    .where(and(eq(schema.ruleset.jurisdiction, jurisdiction.toUpperCase()), or(eq(schema.ruleset.status, "validated"), eq(schema.ruleset.status, "retired"))))
    .orderBy(schema.ruleset.kind, schema.ruleset.code, desc(schema.ruleset.version));
}

/* ---------- Administration de la plateforme (scripts d'exploitation, jamais exposée aux entreprises) ---------- */

const draftInput = z.object({
  jurisdiction: z.string().regex(/^[A-Z]{2}$/),
  kind: z.string().min(1).max(40),
  code: z.string().min(1).max(60),
  name: z.string().min(1).max(160),
  validFrom: z.string().regex(DATE),
  validTo: z.string().regex(DATE).optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export async function proposeRuleset(input: z.input<typeof draftInput>) {
  const data = draftInput.parse(input);
  const [last] = await db
    .select({ v: schema.ruleset.version })
    .from(schema.ruleset)
    .where(and(eq(schema.ruleset.jurisdiction, data.jurisdiction), eq(schema.ruleset.kind, data.kind), eq(schema.ruleset.code, data.code)))
    .orderBy(desc(schema.ruleset.version))
    .limit(1);
  const [row] = await db.insert(schema.ruleset).values({ ...data, version: (last?.v ?? 0) + 1, status: "draft" }).returning();
  return row!;
}

/** Validation par une personne nommée, avec la source officielle citée. Irréversible : la règle devient immuable. */
export async function validateRuleset(id: string, v: { sourceReference: string; validatedBy: string }) {
  const data = z.object({ sourceReference: z.string().trim().min(10, "Citez la source officielle (texte, article, date)"), validatedBy: z.string().trim().min(2) }).parse(v);
  const [row] = await db
    .update(schema.ruleset)
    .set({ status: "validated", sourceReference: data.sourceReference, validatedBy: data.validatedBy, validatedAt: new Date() })
    .where(and(eq(schema.ruleset.id, id), eq(schema.ruleset.status, "draft")))
    .returning();
  if (!row) throw new BusinessRuleError("Règle introuvable ou déjà validée.");
  return row;
}

export async function retireRuleset(id: string, validTo: string) {
  const [row] = await db
    .update(schema.ruleset)
    .set({ status: "retired", validTo })
    .where(and(eq(schema.ruleset.id, id), eq(schema.ruleset.status, "validated")))
    .returning();
  if (!row) throw new BusinessRuleError("Seule une règle validée peut être retirée.");
  return row;
}

/**
 * Estimation fiscale explicable. Tant qu'aucune règle validée n'existe pour le pays, ou que son format n'est pas interprétable,
 * le produit refuse d'estimer : mieux vaut aucun chiffre qu'un chiffre inventé.
 */
export type TaxEstimate = { status: "unavailable"; reason: string } | { status: "available"; amountMinor: number; explanation: string[]; rulesetId: string };

export async function estimateTax(country: string, date: string): Promise<TaxEstimate> {
  const rs = await resolveRuleset(country, "tax", "income", date);
  if (!rs) return { status: "unavailable", reason: `Aucune règle fiscale validée n'est disponible pour ${country.toUpperCase()} à la date du ${date}. Les estimations restent désactivées tant qu'un expert n'a pas validé les règles applicables.` };
  return { status: "unavailable", reason: `Une règle validée existe (${rs.name}, version ${rs.version}), mais le moteur de calcul ne sait pas encore l'interpréter.` };
}
