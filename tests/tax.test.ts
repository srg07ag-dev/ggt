import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { sql as rawSql, db, schema } from "@/db/client";
import { createCompany } from "@/modules/core/companies";
import { BusinessRuleError } from "@/modules/core/errors";
import { ForbiddenError, withTenant } from "@/modules/core/tenant";
import {
  createObligation,
  deleteObligation,
  getObligation,
  getTaxProfile,
  listObligations,
  obligationState,
  recordTaxEvent,
  saveTaxProfile,
  setObligationNotApplicable,
  upcomingObligations,
} from "@/modules/tax/obligations";
import { estimateTax, listValidatedRulesets, proposeRuleset, resolveRuleset, retireRuleset, validateRuleset } from "@/modules/tax/rules";

let a: { id: string }, b: { id: string };
const ctxA = () => ({ userId: "owner", companyId: a.id, role: "owner" as const });
const dbError = async (p: Promise<unknown>) => {
  const e = await p.then(() => null, (x: { cause?: { message?: string }; message: string }) => x);
  expect(e, "une erreur de la base était attendue").not.toBeNull();
  return String(e!.cause?.message ?? e!.message);
};
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  await rawSql`truncate "user", company, app_rate_limit cascade`;
  await rawSql`truncate ruleset cascade`;
  for (const id of ["owner", "bob", "viewer", "mgr", "acct"]) await db.insert(schema.user).values({ id, name: id, email: `${id}@t.dev` });
  a = await createCompany("owner", { name: "Alice SARL", country: "TG", currency: "XOF" });
  b = await createCompany("bob", { name: "Bob SAS", country: "TG", currency: "XOF" });
  await db.insert(schema.membership).values([
    { companyId: a.id, userId: "viewer", role: "viewer" },
    { companyId: a.id, userId: "mgr", role: "manager" },
    { companyId: a.id, userId: "acct", role: "accountant" },
  ]);
});
afterAll(async () => {
  await rawSql.end();
});

describe("règles réglementaires versionnées", () => {
  it("aucune règle n'est livrée : sans règle validée, aucune estimation n'est produite", async () => {
    expect(await db.select().from(schema.ruleset)).toHaveLength(0);
    const est = await estimateTax("TG", iso(0));
    expect(est.status).toBe("unavailable");
    expect(est.status === "unavailable" && est.reason).toMatch(/Aucune règle fiscale validée/);
  });

  it("un brouillon n'est jamais appliqué ; une règle validée l'est dans sa période de validité", async () => {
    const draft = await proposeRuleset({ jurisdiction: "TG", kind: "tax", code: "income", name: "Règle de TEST v1", validFrom: "2025-01-01", validTo: "2025-12-31", payload: { exemple: true } });
    expect(draft.status).toBe("draft");
    expect(await resolveRuleset("TG", "tax", "income", "2025-06-01")).toBeNull();
    await validateRuleset(draft.id, { sourceReference: "Texte de test, article 1 (fictif)", validatedBy: "Expert de test" });
    expect((await resolveRuleset("TG", "tax", "income", "2025-06-01"))!.version).toBe(1);
    expect(await resolveRuleset("TG", "tax", "income", "2024-12-31")).toBeNull(); // avant
    expect(await resolveRuleset("TG", "tax", "income", "2026-01-01")).toBeNull(); // après
    expect(await resolveRuleset("FR", "tax", "income", "2025-06-01")).toBeNull(); // autre juridiction
  });

  it("la validation exige une source citée et une personne nommée", async () => {
    const d = await proposeRuleset({ jurisdiction: "TG", kind: "tax", code: "vat", name: "Brouillon", validFrom: "2025-01-01" });
    await expect(validateRuleset(d.id, { sourceReference: "court", validatedBy: "X Y" })).rejects.toThrow();
    // et la base l'impose aussi
    expect(await dbError(db.update(schema.ruleset).set({ status: "validated" }).where(eq(schema.ruleset.id, d.id)))).toMatch(/ruleset_validated_has_source/);
  });

  it("une règle validée est immuable ; une évolution passe par une nouvelle version, sans réécrire l'historique", async () => {
    const [v1] = await db.select().from(schema.ruleset).where(eq(schema.ruleset.code, "income"));
    expect(await dbError(db.update(schema.ruleset).set({ payload: { exemple: false } }).where(eq(schema.ruleset.id, v1!.id)))).toMatch(/immuable/);
    expect(await dbError(db.update(schema.ruleset).set({ validFrom: "2024-01-01" }).where(eq(schema.ruleset.id, v1!.id)))).toMatch(/immuable/);
    expect(await dbError(db.update(schema.ruleset).set({ status: "draft" }).where(eq(schema.ruleset.id, v1!.id)))).toMatch(/brouillon/);
    expect(await dbError(db.delete(schema.ruleset).where(eq(schema.ruleset.id, v1!.id)))).toMatch(/supprimée/);

    const v2 = await proposeRuleset({ jurisdiction: "TG", kind: "tax", code: "income", name: "Règle de TEST v2", validFrom: "2026-01-01", payload: { exemple: "v2" } });
    expect(v2.version).toBe(2);
    await validateRuleset(v2.id, { sourceReference: "Texte de test modifié, article 2 (fictif)", validatedBy: "Expert de test" });
    expect((await resolveRuleset("TG", "tax", "income", "2025-06-01"))!.version).toBe(1); // le passé garde sa règle
    expect((await resolveRuleset("TG", "tax", "income", "2026-06-01"))!.version).toBe(2);
  });

  it("deux règles validées ne peuvent pas se chevaucher dans le temps", async () => {
    const overlap = await proposeRuleset({ jurisdiction: "TG", kind: "tax", code: "income", name: "Chevauche v1", validFrom: "2025-06-01", validTo: "2025-08-01" });
    await expect(validateRuleset(overlap.id, { sourceReference: "Texte de test, article 3 (fictif)", validatedBy: "Expert de test" })).rejects.toThrow();
  });

  it("retirer une règle borne sa validité et elle reste consultable pour le passé", async () => {
    const [v2] = await db.select().from(schema.ruleset).where(eq(schema.ruleset.version, 2));
    await retireRuleset(v2!.id, "2026-12-31");
    expect(await resolveRuleset("TG", "tax", "income", "2026-12-31")).not.toBeNull();
    expect(await resolveRuleset("TG", "tax", "income", "2027-01-01")).toBeNull();
    expect(await dbError(db.update(schema.ruleset).set({ validTo: "2030-01-01" }).where(eq(schema.ruleset.id, v2!.id)))).toMatch(/définitive/);
    expect((await listValidatedRulesets("tg")).length).toBe(2);
  });

  it("changer le pays d'une entreprise ne change rien aux règles déjà appliquées à ses données", async () => {
    const before = await resolveRuleset("TG", "tax", "income", "2025-06-01");
    await db.update(schema.company).set({ country: "FR" }).where(eq(schema.company.id, a.id));
    expect((await resolveRuleset("TG", "tax", "income", "2025-06-01"))!.id).toBe(before!.id);
    await db.update(schema.company).set({ country: "TG" }).where(eq(schema.company.id, a.id));
  });
});

describe("profil fiscal et échéances", () => {
  it("enregistre un profil déclaré, sans l'interpréter", async () => {
    await saveTaxProfile("acct", a.id, { regimeLabel: "Régime déclaré par l'entreprise", vatRegistered: "yes", filingFrequency: "Mensuelle", notes: "n" });
    const { profile, country } = await getTaxProfile("owner", a.id);
    expect(profile!.regimeLabel).toBe("Régime déclaré par l'entreprise");
    expect(profile!.vatRegistered).toBe(true);
    expect(country).toBe("TG");
    await saveTaxProfile("owner", a.id, { vatRegistered: "" });
    expect((await getTaxProfile("owner", a.id)).profile!.vatRegistered).toBeNull();
  });

  it("calcule l'état d'une échéance : en retard, bientôt, à venir, soldée", () => {
    const today = "2026-10-14";
    expect(obligationState({ status: "todo", dueDate: "2026-10-13" }, today)).toBe("overdue");
    expect(obligationState({ status: "todo", dueDate: "2026-10-14" }, today)).toBe("due_soon");
    expect(obligationState({ status: "todo", dueDate: "2026-10-28" }, today)).toBe("due_soon");
    expect(obligationState({ status: "todo", dueDate: "2026-10-29" }, today)).toBe("todo");
    expect(obligationState({ status: "paid", dueDate: "2020-01-01" }, today)).toBe("paid");
  });

  it("suivi complet : déclaration, paiement, notes ; l'historique est en ajout seul", async () => {
    const o = await createObligation("acct", a.id, { title: "Déclaration de test", authority: "Administration de test", periodLabel: "T1", dueDate: iso(5) });
    expect((await upcomingObligations("owner", a.id)).map((x) => x.id)).toContain(o.id);
    await expect(recordTaxEvent("acct", a.id, o.id, { kind: "paid", occurredOn: iso(0) })).rejects.toThrow(/montant/i);
    await recordTaxEvent("acct", a.id, o.id, { kind: "note", occurredOn: iso(0), notes: "À préparer" });
    expect((await getObligation("owner", a.id, o.id))!.obligation.status).toBe("todo");
    await recordTaxEvent("acct", a.id, o.id, { kind: "filed", occurredOn: iso(0), reference: "REF-1" });
    expect((await getObligation("owner", a.id, o.id))!.obligation.status).toBe("filed");
    await recordTaxEvent("acct", a.id, o.id, { kind: "paid", occurredOn: iso(1), amount: "15000", reference: "QUITTANCE-9" });
    await recordTaxEvent("acct", a.id, o.id, { kind: "filed", occurredOn: iso(1), reference: "REF-2" }); // une déclaration tardive ne fait pas reculer le statut
    const got = await getObligation("owner", a.id, o.id);
    expect(got!.obligation.status).toBe("paid");
    expect(got!.events).toHaveLength(4);
    expect(got!.events.find((e) => e.kind === "paid")!.amountMinor).toBe(15000);
    expect((await upcomingObligations("owner", a.id)).map((x) => x.id)).not.toContain(o.id);
    expect(await dbError(withTenant(ctxA(), (tx) => tx.update(schema.taxEvent).set({ amountMinor: 1 })))).toMatch(/ajout seul/);
    expect(await dbError(withTenant(ctxA(), (tx) => tx.delete(schema.taxEvent)))).toMatch(/ajout seul/);
    await expect(deleteObligation("acct", a.id, o.id)).rejects.toThrow(/historique/);
    await expect(setObligationNotApplicable("acct", a.id, o.id, true)).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it("une échéance saisie par erreur se supprime ; une échéance peut être marquée non applicable puis rétablie", async () => {
    const o = await createObligation("owner", a.id, { title: "Erreur de saisie", dueDate: iso(30) });
    await deleteObligation("owner", a.id, o.id);
    const n = await createObligation("owner", a.id, { title: "Non concernée", dueDate: iso(30) });
    await setObligationNotApplicable("owner", a.id, n.id, true);
    await expect(recordTaxEvent("owner", a.id, n.id, { kind: "filed", occurredOn: iso(0) })).rejects.toThrow(/non applicable/);
    await setObligationNotApplicable("owner", a.id, n.id, false);
    const late = await createObligation("owner", a.id, { title: "En retard", dueDate: iso(-3) });
    expect((await listObligations("owner", a.id)).find((x) => x.id === late.id)!.state).toBe("overdue");
  });

  it("réservé aux rôles autorisés et cloisonné par entreprise", async () => {
    for (const u of ["viewer", "mgr"]) await expect(listObligations(u, a.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createObligation("viewer", a.id, { title: "x", dueDate: iso(1) })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listObligations("bob", a.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await listObligations("bob", b.id)).toHaveLength(0);
    const [any] = await listObligations("owner", a.id);
    expect(await getObligation("bob", b.id, any!.id)).toBeNull();
    await expect(recordTaxEvent("bob", b.id, any!.id, { kind: "note", occurredOn: iso(0) })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createObligation("owner", a.id, { title: "x", dueDate: "demain" })).rejects.toThrow();
  });
});
