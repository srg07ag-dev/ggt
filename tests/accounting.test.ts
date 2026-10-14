import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { sql as rawSql, db, schema } from "@/db/client";
import { createCompany } from "@/modules/core/companies";
import { BusinessRuleError } from "@/modules/core/errors";
import { setNumbering } from "@/modules/core/settings";
import { ForbiddenError, withTenant } from "@/modules/core/tenant";
import { createContact } from "@/modules/crm/contacts";
import { createLedgerAccount, importChart, listLedgerAccounts, parseChartCsv, renameLedgerAccount, setLedgerAccountArchived } from "@/modules/accounting/chart";
import { closePeriod, createPeriod, listPeriods, reopenPeriod } from "@/modules/accounting/periods";
import { createDraftEntry, deleteDraftEntry, getEntry, listEntries, postEntry, reverseEntry, updateDraftEntry } from "@/modules/accounting/entries";
import { listJournals } from "@/modules/accounting/journals";
import { getAccountingSettings, saveAccountingSettings, setLedgerMapping } from "@/modules/accounting/posting";
import { exportLedgerCsv, generalLedger, trialBalance } from "@/modules/accounting/reports";
import { createAccount as createTreasury, createCategory, createEntry, voidEntry } from "@/modules/finance/finance";
import { addLine, createCreditNote, createDraft, issueDocument, recordPayment, voidPayment } from "@/modules/sales/documents";
import { createTaxRate } from "@/modules/sales/catalog";

const YEAR = new Date().getUTCFullYear();
const D = (m: number, d: number) => `${YEAR}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
let a: { id: string }, b: { id: string };
let J: Record<string, string>; // journaux par code
let A: Record<string, string>; // comptes par code
/** Les erreurs SQL sont enveloppées par Drizzle : le message utile est dans `cause`. */
const dbError = async (p: Promise<unknown>) => {
  const e = await p.then(() => null, (x: { cause?: { message?: string }; message: string }) => x);
  expect(e, "une erreur de la base était attendue").not.toBeNull();
  return String(e!.cause?.message ?? e!.message);
};
const ctxA = () => ({ userId: "owner", companyId: a.id, role: "owner" as const });

async function acct(userId: string, companyId: string, code: string, name: string, type: "asset" | "liability" | "equity" | "revenue" | "expense") {
  return (await createLedgerAccount(userId, companyId, { code, name, type })).id;
}

beforeAll(async () => {
  await rawSql`truncate "user", company, app_rate_limit cascade`;
  for (const id of ["owner", "bob", "viewer", "mgr", "acct", "admin"]) await db.insert(schema.user).values({ id, name: id, email: `${id}@t.dev` });
  a = await createCompany("owner", { name: "Alice SARL", country: "TG", currency: "EUR" });
  b = await createCompany("bob", { name: "Bob SAS", country: "TG", currency: "EUR" });
  await db.insert(schema.membership).values([
    { companyId: a.id, userId: "viewer", role: "viewer" },
    { companyId: a.id, userId: "mgr", role: "manager" },
    { companyId: a.id, userId: "acct", role: "accountant" },
    { companyId: a.id, userId: "admin", role: "admin" },
  ]);
  J = Object.fromEntries((await listJournals("owner", a.id)).map((j) => [j.code, j.id]));
  // Comptes de TEST (codes arbitraires, sans valeur réglementaire)
  A = {
    BANK: await acct("owner", a.id, "BANK", "Banque", "asset"),
    CASH: await acct("owner", a.id, "CASH", "Caisse", "asset"),
    AR: await acct("owner", a.id, "AR", "Clients", "asset"),
    TAXD: await acct("owner", a.id, "TAXD", "Taxe déductible", "asset"),
    TAXC: await acct("owner", a.id, "TAXC", "Taxe collectée", "liability"),
    CAP: await acct("owner", a.id, "CAP", "Capital", "equity"),
    REV: await acct("owner", a.id, "REV", "Ventes", "revenue"),
    OREV: await acct("owner", a.id, "OREV", "Autres produits", "revenue"),
    EXP: await acct("owner", a.id, "EXP", "Charges", "expense"),
  };
  await createPeriod("owner", a.id, { name: `Exercice ${YEAR}`, startDate: D(1, 1), endDate: D(12, 31) });
});
afterAll(async () => {
  await rawSql.end();
});

const sumBy = (lines: { code: string; l: { debitMinor: number; creditMinor: number } }[], code: string, side: "debitMinor" | "creditMinor") =>
  lines.filter((x) => x.code === code).reduce((n, x) => n + x.l[side], 0);
const entry = (lines: { a: string; d?: string; c?: string }[], over: Partial<{ date: string; journal: string; description: string }> = {}) =>
  createDraftEntry("owner", a.id, { journalId: over.journal ?? J.OD!, entryDate: over.date ?? D(3, 1), description: over.description ?? "Test", lines: lines.map((l) => ({ accountId: A[l.a]!, debit: l.d, credit: l.c })) });

describe("plan de comptes", () => {
  it("lit un CSV (en-tête facultatif, ; ou ,), signale doublons et lignes invalides sans rien corriger en silence", () => {
    const ok = parseChartCsv("code;libellé;type\n101;Capital;capitaux\n512;Banque;actif\n\"7,1\";x;produit\n");
    expect(ok.rows.map((r) => r.code)).toEqual(["101", "512"]);
    expect(ok.errors).toHaveLength(1); // « 7,1 » : code invalide
    const bad = parseChartCsv("1;A;actif\n1;B;actif\n2;;actif\n3;C;inconnu\n=cmd|' /C calc'!A0;D;actif\n");
    expect(bad.rows).toHaveLength(1);
    expect(bad.errors.map((e) => e.line)).toEqual([2, 3, 4, 5]);
    expect(parseChartCsv("a,b,c\n").rows).toHaveLength(0);
  });

  it("l'import est tout ou rien et n'écrase jamais un compte existant", async () => {
    await expect(importChart("owner", a.id, "X1;ok;actif\nBAD CODE;oups;actif")).rejects.toBeInstanceOf(BusinessRuleError);
    expect((await listLedgerAccounts("owner", a.id)).some((x) => x.code === "X1")).toBe(false);
    await expect(importChart("owner", a.id, "Y1;ok;actif\nBANK;doublon;actif")).rejects.toThrow(/déjà existants/);
    expect((await listLedgerAccounts("owner", a.id)).some((x) => x.code === "Y1")).toBe(false);
    expect((await importChart("owner", a.id, "Z1;Importé;passif\nZ2;Importé 2;charge")).imported).toBe(2);
  });

  it("code et type sont figés (service et base) ; le libellé se renomme ; un doublon est refusé", async () => {
    await expect(createLedgerAccount("owner", a.id, { code: "BANK", name: "x", type: "asset" })).rejects.toBeInstanceOf(BusinessRuleError);
    await renameLedgerAccount("owner", a.id, A.CASH!, "Caisse principale");
    await expect(withTenant(ctxA(), (tx) => tx.update(schema.ledgerAccount).set({ code: "NEW" }).where(eq(schema.ledgerAccount.id, A.CASH!)))).rejects.toThrow();
    await expect(withTenant(ctxA(), (tx) => tx.update(schema.ledgerAccount).set({ type: "expense" }).where(eq(schema.ledgerAccount.id, A.CASH!)))).rejects.toThrow();
  });
});

describe("écritures en partie double", () => {
  it("valide une écriture équilibrée et lui attribue un numéro", async () => {
    const e = await entry([{ a: "BANK", d: "100" }, { a: "CAP", c: "100" }]);
    const n = await postEntry("owner", a.id, e.id);
    expect(n).toBe(`OD-${YEAR}-000001`);
    const got = await getEntry("owner", a.id, e.id);
    expect(got!.e.status).toBe("posted");
    expect(got!.lines).toHaveLength(2);
  });

  it("refuse une écriture déséquilibrée, à une ligne, vide ou avec un montant négatif", async () => {
    const e1 = await entry([{ a: "BANK", d: "100" }, { a: "CAP", c: "99,99" }]);
    await expect(postEntry("owner", a.id, e1.id)).rejects.toThrow(/déséquilibrée/);
    const e2 = await entry([{ a: "BANK", d: "100" }]);
    await expect(postEntry("owner", a.id, e2.id)).rejects.toThrow(/deux lignes/);
    const e3 = await entry([]);
    await expect(postEntry("owner", a.id, e3.id)).rejects.toThrow(/deux lignes/);
    await expect(entry([{ a: "BANK", d: "-5" }, { a: "CAP", c: "5" }])).rejects.toThrow();
    await expect(entry([{ a: "BANK", d: "5", c: "5" }])).rejects.toThrow(/débit ou au crédit/);
    // l'écriture brouillon déséquilibrée n'a consommé aucun numéro
    const ok = await entry([{ a: "BANK", d: "1" }, { a: "CAP", c: "1" }]);
    expect(await postEntry("owner", a.id, ok.id)).toBe(`OD-${YEAR}-000002`);
  });

  it("modifie et supprime un brouillon, jamais une écriture validée", async () => {
    const e = await entry([{ a: "BANK", d: "10" }]);
    await updateDraftEntry("owner", a.id, e.id, { journalId: J.OD!, entryDate: D(3, 2), description: "Corrigé", lines: [{ accountId: A.BANK!, debit: "10" }, { accountId: A.CAP!, credit: "10" }] });
    const n = await postEntry("owner", a.id, e.id);
    await expect(updateDraftEntry("owner", a.id, e.id, { journalId: J.OD!, entryDate: D(3, 2), description: "x", lines: [] })).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(deleteDraftEntry("owner", a.id, e.id)).rejects.toBeInstanceOf(BusinessRuleError);
    expect(n).toMatch(/^OD-/);
    const d = await entry([{ a: "BANK", d: "1" }]);
    await deleteDraftEntry("owner", a.id, d.id);
    expect(await getEntry("owner", a.id, d.id)).toBeNull();
  });

  it("la base refuse toute modification d'une écriture validée, même en SQL direct", async () => {
    const e = await entry([{ a: "BANK", d: "7" }, { a: "CAP", c: "7" }]);
    await postEntry("owner", a.id, e.id);
    await expect(withTenant(ctxA(), (tx) => tx.update(schema.journalEntry).set({ description: "falsifié" }).where(eq(schema.journalEntry.id, e.id)))).rejects.toThrow();
    await expect(withTenant(ctxA(), (tx) => tx.delete(schema.journalEntry).where(eq(schema.journalEntry.id, e.id)))).rejects.toThrow();
    await expect(withTenant(ctxA(), (tx) => tx.update(schema.journalLine).set({ debitMinor: 1 }).where(eq(schema.journalLine.entryId, e.id)))).rejects.toThrow();
    await expect(withTenant(ctxA(), (tx) => tx.delete(schema.journalLine).where(eq(schema.journalLine.entryId, e.id)))).rejects.toThrow();
    await expect(withTenant(ctxA(), (tx) => tx.insert(schema.journalLine).values({ companyId: a.id, entryId: e.id, position: 9, accountId: A.BANK!, debitMinor: 1 }))).rejects.toThrow();
  });

  it("la base refuse de créer une écriture directement validée, ou de la valider sans équilibre", async () => {
    expect(
      await dbError(withTenant(ctxA(), (tx) => tx.insert(schema.journalEntry).values({ companyId: a.id, journalId: J.OD!, entryDate: D(3, 3), description: "triche", status: "posted", number: "OD-X" }))),
    ).toMatch(/créée en brouillon/);
    const e = await entry([{ a: "BANK", d: "5" }, { a: "CAP", c: "4" }]);
    const [p] = await withTenant(ctxA(), (tx) => tx.select().from(schema.fiscalPeriod));
    expect(
      await dbError(withTenant(ctxA(), (tx) => tx.update(schema.journalEntry).set({ status: "posted", number: "OD-ZZ", periodId: p!.id, postedAt: new Date() }).where(eq(schema.journalEntry.id, e.id)))),
    ).toMatch(/déséquilibrée/);
  });

  it("attribue des numéros sans trou même avec 10 validations simultanées", async () => {
    const drafts = await Promise.all(Array.from({ length: 10 }, () => entry([{ a: "CASH", d: "1" }, { a: "CAP", c: "1" }], { journal: J.TR! })));
    const nums = await Promise.all(drafts.map((d) => postEntry("owner", a.id, d.id)));
    expect(nums.map((n) => Number(n.split("-")[2])).sort((x, y) => x - y)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
  });

  it("contre-passe : écriture inverse, une seule fois, jamais une contre-passation", async () => {
    const e = await entry([{ a: "EXP", d: "40" }, { a: "BANK", c: "40" }]);
    await postEntry("owner", a.id, e.id);
    const r = await reverseEntry("owner", a.id, e.id, { date: D(3, 5) });
    const rev = await getEntry("owner", a.id, r.id);
    expect(rev!.e.reversalOfId).toBe(e.id);
    expect(rev!.lines.find((l) => l.code === "EXP")!.l.creditMinor).toBe(4000);
    expect(rev!.lines.find((l) => l.code === "BANK")!.l.debitMinor).toBe(4000);
    await expect(reverseEntry("owner", a.id, e.id, { date: D(3, 6) })).rejects.toThrow(/déjà été contre-passée/);
    await expect(reverseEntry("owner", a.id, r.id, { date: D(3, 6) })).rejects.toThrow(/ne se contre-passe pas/);
    const draft = await entry([{ a: "BANK", d: "1" }, { a: "CAP", c: "1" }]);
    await expect(reverseEntry("owner", a.id, draft.id)).rejects.toThrow(/validée/);
  });

  it("refuse un compte archivé et un compte d'une autre entreprise", async () => {
    const tmp = await acct("owner", a.id, "TMP", "Temporaire", "asset");
    const e = await createDraftEntry("owner", a.id, { journalId: J.OD!, entryDate: D(3, 7), description: "Archivé", lines: [{ accountId: tmp, debit: "3" }, { accountId: A.CAP!, credit: "3" }] });
    await setLedgerAccountArchived("owner", a.id, tmp, true);
    await expect(postEntry("owner", a.id, e.id)).rejects.toThrow(/compte archivé/);
    const other = await acct("bob", b.id, "OTHER", "Autre entreprise", "asset");
    await expect(createDraftEntry("owner", a.id, { journalId: J.OD!, entryDate: D(3, 7), description: "x", lines: [{ accountId: other, debit: "1" }, { accountId: A.CAP!, credit: "1" }] })).rejects.toThrow();
  });
});

describe("périodes", () => {
  it("refuse le chevauchement, l'absence de période et la validation dans une période clôturée", async () => {
    await expect(createPeriod("owner", a.id, { name: "Chevauche", startDate: D(6, 1), endDate: D(6, 30) })).rejects.toThrow(/chevauche/);
    await expect(createPeriod("owner", a.id, { name: "Inversée", startDate: D(5, 1), endDate: D(4, 1) })).rejects.toThrow();
    const e = await entry([{ a: "BANK", d: "1" }, { a: "CAP", c: "1" }], { date: `${YEAR + 1}-02-01` });
    await expect(postEntry("owner", a.id, e.id)).rejects.toThrow(/Aucune période/);
    await deleteDraftEntry("owner", a.id, e.id);
  });

  it("clôture : refusée avec des brouillons, puis verrouille ; réouverture réservée au propriétaire avec motif", async () => {
    await createPeriod("owner", a.id, { name: "Exercice suivant", startDate: `${YEAR + 1}-01-01`, endDate: `${YEAR + 1}-12-31` });
    const next = (await listPeriods("owner", a.id)).find((p) => p.name === "Exercice suivant")!;
    const draft = await entry([{ a: "BANK", d: "1" }, { a: "CAP", c: "1" }], { date: `${YEAR + 1}-03-01` });
    await expect(closePeriod("owner", a.id, next.id)).rejects.toThrow(/brouillon/);
    await postEntry("owner", a.id, draft.id);
    await closePeriod("owner", a.id, next.id);
    const late = await entry([{ a: "BANK", d: "1" }, { a: "CAP", c: "1" }], { date: `${YEAR + 1}-04-01` });
    await expect(postEntry("owner", a.id, late.id)).rejects.toThrow(/clôturée/);
    await expect(reverseEntry("owner", a.id, draft.id, { date: `${YEAR + 1}-05-01` })).rejects.toThrow(/clôturée/);
    // la base verrouille aussi
    await expect(withTenant(ctxA(), (tx) => tx.update(schema.fiscalPeriod).set({ endDate: `${YEAR + 1}-06-30` }).where(eq(schema.fiscalPeriod.id, next.id)))).rejects.toThrow();
    await expect(reopenPeriod("acct", a.id, next.id, "Correction nécessaire")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(reopenPeriod("owner", a.id, next.id, "ok")).rejects.toThrow();
    await reopenPeriod("owner", a.id, next.id, "Écriture oubliée à corriger");
    expect(await postEntry("owner", a.id, late.id)).toMatch(/^OD-/);
    const logs = await withTenant(ctxA(), (tx) => tx.select().from(schema.auditLog).where(eq(schema.auditLog.action, "period.reopened")));
    expect(JSON.stringify(logs[0]!.meta)).toContain("Écriture oubliée");
  });
});

describe("permissions et isolation", () => {
  it("accès réservé aux rôles comptables ; l'autre entreprise ne voit rien", async () => {
    for (const u of ["viewer", "mgr"]) await expect(listLedgerAccounts(u, a.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listLedgerAccounts("acct", a.id)).resolves.toBeDefined();
    await expect(listLedgerAccounts("admin", a.id)).resolves.toBeDefined();
    await expect(createLedgerAccount("viewer", a.id, { code: "V1", name: "x", type: "asset" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(trialBalance("bob", a.id, {})).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listEntries("bob", b.id)).length).toBe(0);
    expect((await listLedgerAccounts("bob", b.id)).map((x) => x.code)).toEqual(["OTHER"]);
    const mine = (await listEntries("owner", a.id, { status: "posted" }))[0]!;
    expect(await getEntry("bob", b.id, mine.id)).toBeNull();
  });
});

describe("balance, grand livre, export", () => {
  it("la balance est équilibrée : débits = crédits et soldes de clôture nuls en somme", async () => {
    const tb = await trialBalance("owner", a.id, {});
    expect(tb.balanced).toBe(true);
    expect(tb.totals.debitMinor).toBe(tb.totals.creditMinor);
    expect(tb.rows.length).toBeGreaterThan(2);
  });

  it("propriété : 40 écritures aléatoires équilibrées gardent la balance équilibrée", async () => {
    const codes = ["BANK", "CASH", "AR", "TAXD", "TAXC", "CAP", "REV", "OREV", "EXP"];
    for (let i = 0; i < 40; i++) {
      const n = 2 + Math.floor(Math.random() * 3);
      const amounts = Array.from({ length: n }, () => 1 + Math.floor(Math.random() * 99999));
      const total = amounts.reduce((x, y) => x + y, 0);
      const debitLines = amounts.map((v, k) => ({ accountId: A[codes[(k + i) % 9]!]!, debit: (v / 100).toFixed(2) }));
      const e = await createDraftEntry("owner", a.id, {
        journalId: J.OD!, entryDate: D(1 + (i % 12), 1 + (i % 27)), description: `aléa ${i}`,
        lines: [...debitLines, { accountId: A[codes[(i * 7) % 9]!]!, credit: (total / 100).toFixed(2) }],
      });
      await postEntry("owner", a.id, e.id);
    }
    expect((await trialBalance("owner", a.id, {})).balanced).toBe(true);
    expect((await trialBalance("owner", a.id, { from: D(4, 1), to: D(9, 30) })).balanced).toBe(true);
  });

  it("le grand livre cumule les soldes à partir du report d'ouverture", async () => {
    const gl = await generalLedger("owner", a.id, A.BANK!, { from: D(3, 2) });
    const sum = gl!.lines.reduce((n, l) => n + l.debitMinor - l.creditMinor, gl!.openingMinor);
    expect(gl!.closingMinor).toBe(sum);
    expect(gl!.lines[gl!.lines.length - 1]!.runningMinor).toBe(gl!.closingMinor);
    const all = await generalLedger("owner", a.id, A.BANK!, {});
    const tb = (await trialBalance("owner", a.id, {})).rows.find((r) => r.code === "BANK")!;
    expect(all!.closingMinor).toBe(tb.closingMinor);
  });

  it("exporte le CSV des écritures validées, sans les brouillons, et neutralise les formules", async () => {
    const e = await entry([{ a: "BANK", d: "12,5" }, { a: "CAP", c: "12,5" }], { description: "=SOMME(A1)" });
    await postEntry("owner", a.id, e.id);
    await entry([{ a: "BANK", d: "99" }, { a: "CAP", c: "99" }], { description: "Brouillon invisible" });
    const out = await exportLedgerCsv("owner", a.id, {});
    expect(out.csv.startsWith("﻿Journal;Date")).toBe(true);
    expect(out.csv).toContain("'=SOMME(A1)");
    expect(out.csv).not.toContain("Brouillon invisible");
    expect(out.csv).toContain("12,5");
    expect((await exportLedgerCsv("bob", b.id, {})).csv.trim().split("\r\n")).toHaveLength(1);
    await expect(exportLedgerCsv("viewer", a.id, {})).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("comptabilisation automatique", () => {
  let treasury: { id: string };
  let tax: { id: string };
  let client: { id: string };
  const setup = (over: Partial<Parameters<typeof saveAccountingSettings>[2]> = {}) =>
    saveAccountingSettings("owner", a.id, {
      enabled: true, enabledFrom: D(1, 1), receivableAccountId: A.AR, revenueAccountId: A.REV, taxCollectedAccountId: A.TAXC, taxDeductibleAccountId: A.TAXD,
      expenseAccountId: A.EXP, otherIncomeAccountId: A.OREV, salesJournalId: J.VT, purchasesJournalId: J.AC, treasuryJournalId: J.TR, ...over,
    });

  beforeAll(async () => {
    treasury = await createTreasury("owner", a.id, { name: "Compte bancaire", kind: "bank", openingBalance: "0" });
    client = await createContact("owner", a.id, { name: "Client" });
    tax = await createTaxRate("owner", a.id, { name: "Taxe test", ratePercent: "10" });
    await setNumbering("owner", a.id, "invoice", "FA-{YYYY}-{NNNN}");
    await setNumbering("owner", a.id, "credit_note", "AV-{NNNN}");
  });

  it("refuse l'activation incomplète ou incohérente (type de compte, type de journal, période absente)", async () => {
    await expect(saveAccountingSettings("owner", a.id, { enabled: true, enabledFrom: D(1, 1) })).rejects.toThrow(/Configuration incomplète/);
    await expect(setup({ revenueAccountId: A.EXP })).rejects.toThrow(/bon type/);
    await expect(setup({ salesJournalId: J.AC })).rejects.toThrow(/type « sales »/);
    await expect(setup({ enabledFrom: "2001-01-01" })).rejects.toThrow(/Aucune période ouverte/);
    await expect(saveAccountingSettings("viewer", a.id, { enabled: false })).rejects.toBeInstanceOf(ForbiddenError);
    await setup();
    expect((await getAccountingSettings("owner", a.id))!.enabled).toBe(true);
  });

  it("une facture émise génère son écriture équilibrée dans la même transaction", async () => {
    await setLedgerMapping("owner", a.id, { kind: "tax_rate", id: tax.id }, A.TAXC!);
    const d = await createDraft("owner", a.id, { type: "invoice", contactId: client.id, issueDate: D(5, 10) });
    await addLine("owner", a.id, d.id, { description: "Prestation", quantity: "1", unitPrice: "100", taxRateId: tax.id });
    await addLine("owner", a.id, d.id, { description: "Sans taxe", quantity: "1", unitPrice: "50" });
    await issueDocument("owner", a.id, d.id);
    const es = (await listEntries("owner", a.id, { status: "posted" })).filter((e) => e.sourceType === "invoice");
    expect(es).toHaveLength(1);
    const got = await getEntry("owner", a.id, es[0]!.id);
    expect(sumBy(got!.lines, "AR", "debitMinor")).toBe(16000); // 100 + 10 + 50
    expect(sumBy(got!.lines, "REV", "creditMinor")).toBe(15000);
    expect(sumBy(got!.lines, "TAXC", "creditMinor")).toBe(1000);
    expect(got!.lines.find((l) => l.code === "AR")!.l.contactId).toBe(client.id);
    expect(got!.e.entryDate).toBe(D(5, 10));
    expect(got!.e.number).toMatch(new RegExp(`^VT-${YEAR}-`));
  });

  it("un paiement exige un compte de trésorerie comptable, sinon tout est annulé ; puis il débite la banque", async () => {
    const d = await createDraft("owner", a.id, { type: "invoice", contactId: client.id, issueDate: D(6, 1) });
    await addLine("owner", a.id, d.id, { description: "Service", quantity: "1", unitPrice: "200" });
    await issueDocument("owner", a.id, d.id);
    await expect(recordPayment("owner", a.id, d.id, { amount: "50", paidOn: D(6, 2), method: "cash" })).rejects.toThrow(/compte de trésorerie/);
    await expect(recordPayment("owner", a.id, d.id, { amount: "50", paidOn: D(6, 2), method: "cash", accountId: treasury.id })).rejects.toThrow(/Associez un compte comptable/);
    const pays = await withTenant(ctxA(), (tx) => tx.select().from(schema.payment).where(eq(schema.payment.invoiceId, d.id)));
    expect(pays).toHaveLength(0); // le paiement n'a pas été enregistré sans son écriture
    await setLedgerMapping("owner", a.id, { kind: "finance_account", id: treasury.id }, A.BANK!);
    const p = await recordPayment("owner", a.id, d.id, { amount: "50", paidOn: D(6, 2), method: "cash", accountId: treasury.id });
    const es = (await listEntries("owner", a.id, { status: "posted" })).filter((e) => e.sourceType === "payment");
    expect(es).toHaveLength(1);
    const got = await getEntry("owner", a.id, es[0]!.id);
    expect(got!.lines.find((l) => l.code === "BANK")!.l.debitMinor).toBe(5000);
    expect(got!.lines.find((l) => l.code === "AR")!.l.creditMinor).toBe(5000);
    await voidPayment("owner", a.id, p.id);
    const after = (await listEntries("owner", a.id, { status: "posted" })).filter((e) => e.sourceType === "reversal" && e.description.startsWith("Annulation"));
    expect(after.length).toBeGreaterThan(0);
    const ar = (await trialBalance("owner", a.id, {})).rows.find((r) => r.code === "AR")!;
    expect(ar.closingMinor).toBeGreaterThan(0);
  });

  it("un avoir émis inverse les écritures de vente", async () => {
    const d = await createDraft("owner", a.id, { type: "invoice", contactId: client.id, issueDate: D(7, 1) });
    await addLine("owner", a.id, d.id, { description: "À rembourser", quantity: "1", unitPrice: "100", taxRateId: tax.id });
    await issueDocument("owner", a.id, d.id);
    const cn = await createCreditNote("owner", a.id, d.id);
    await issueDocument("owner", a.id, cn.id);
    const es = (await listEntries("owner", a.id, { status: "posted" })).filter((e) => e.sourceType === "credit_note");
    const got = await getEntry("owner", a.id, es[0]!.id);
    expect(got!.lines.find((l) => l.code === "AR")!.l.creditMinor).toBe(11000);
    expect(got!.lines.find((l) => l.code === "REV")!.l.debitMinor).toBe(10000);
    expect(got!.lines.find((l) => l.code === "TAXC")!.l.debitMinor).toBe(1000);
  });

  it("une dépense avec taxe : charge nette + taxe déductible au débit, trésorerie au crédit ; l'annuler la contre-passe", async () => {
    const cat = (await createCategory("owner", a.id, { kind: "expense", name: "Cat test" }));
    await setLedgerMapping("owner", a.id, { kind: "finance_category", id: cat.id }, A.EXP!);
    const e = await createEntry("owner", a.id, { kind: "expense", accountId: treasury.id, amount: "120", tax: "20", occurredOn: D(8, 1), description: "Fournitures", categoryId: cat.id });
    const es = (await listEntries("owner", a.id, { status: "posted" })).filter((x) => x.sourceType === "finance_entry" && x.description === "Fournitures");
    const got = await getEntry("owner", a.id, es[0]!.id);
    expect(got!.lines.find((l) => l.code === "EXP")!.l.debitMinor).toBe(10000);
    expect(got!.lines.find((l) => l.code === "TAXD")!.l.debitMinor).toBe(2000);
    expect(got!.lines.find((l) => l.code === "BANK")!.l.creditMinor).toBe(12000);
    await voidEntry("owner", a.id, e.id);
    expect((await getEntry("owner", a.id, es[0]!.id))!.reversedBy).not.toBeNull();
    const inc = await createEntry("owner", a.id, { kind: "income", accountId: treasury.id, amount: "30", occurredOn: D(8, 2), description: "Remboursement" });
    expect(inc).toBeDefined();
  });

  it("les opérations antérieures à la date de départ ne sont pas comptabilisées", async () => {
    await setup({ enabledFrom: D(9, 1) });
    const before = (await listEntries("owner", a.id, { status: "posted" })).length;
    const d = await createDraft("owner", a.id, { type: "invoice", contactId: client.id, issueDate: D(8, 20) });
    await addLine("owner", a.id, d.id, { description: "Ancien", quantity: "1", unitPrice: "10" });
    await issueDocument("owner", a.id, d.id);
    expect((await listEntries("owner", a.id, { status: "posted" })).length).toBe(before);
    const d2 = await createDraft("owner", a.id, { type: "invoice", contactId: client.id, issueDate: D(9, 5) });
    await addLine("owner", a.id, d2.id, { description: "Nouveau", quantity: "1", unitPrice: "10" });
    await issueDocument("owner", a.id, d2.id);
    expect((await listEntries("owner", a.id, { status: "posted" })).length).toBe(before + 1);
  });

  it("émettre une facture dans une période clôturée est refusé et la facture reste brouillon (atomicité)", async () => {
    await createPeriod("owner", a.id, { name: "Exercice verrouillé", startDate: `${YEAR + 2}-01-01`, endDate: `${YEAR + 2}-12-31` });
    const p = (await listPeriods("owner", a.id)).find((x) => x.name === "Exercice verrouillé")!;
    await closePeriod("owner", a.id, p.id);
    // une date de départ située dans une période clôturée ne peut pas être activée
    await expect(setup({ enabledFrom: `${YEAR + 2}-02-01` })).rejects.toThrow(/Aucune période ouverte/);
    const d = await createDraft("owner", a.id, { type: "invoice", contactId: client.id, issueDate: `${YEAR + 2}-03-01` });
    await addLine("owner", a.id, d.id, { description: "Dans période clôturée", quantity: "1", unitPrice: "10" });
    await expect(issueDocument("owner", a.id, d.id)).rejects.toThrow(/clôturée/);
    const [still] = await withTenant(ctxA(), (tx) => tx.select().from(schema.salesDocument).where(eq(schema.salesDocument.id, d.id)));
    expect(still!.status).toBe("draft");
    expect(still!.number).toBeNull(); // le numéro n'a pas été consommé
    await reopenPeriod("owner", a.id, p.id, "Test : rouvrir pour émettre");
    await expect(issueDocument("owner", a.id, d.id)).resolves.toMatch(/^FA-/);
  });

  it("après toutes ces opérations, la balance reste équilibrée et le grand livre des clients se recoupe avec les créances", async () => {
    const tb = await trialBalance("owner", a.id, {});
    expect(tb.balanced).toBe(true);
    const gl = await generalLedger("owner", a.id, A.AR!, {});
    expect(gl!.closingMinor).toBe(tb.rows.find((r) => r.code === "AR")!.closingMinor);
  });
});
