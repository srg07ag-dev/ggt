import { existsSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { sql as rawSql, db, schema } from "@/db/client";
import { toCsv } from "@/lib/csv";
import { sniffContentType } from "@/lib/storage";
import { createCompany } from "@/modules/core/companies";
import { setNumbering } from "@/modules/core/settings";
import { ForbiddenError, withTenant } from "@/modules/core/tenant";
import { createContact } from "@/modules/crm/contacts";
import {
  addAttachment,
  archiveAccount,
  createAccount,
  createCategory,
  createEntry,
  createSupplier,
  deleteAttachment,
  listAccounts,
  listCategories,
  listEntries,
  listReceipts,
  readAttachment,
  voidEntry,
} from "@/modules/finance/finance";
import { buildExport, financialReport, parsePeriod } from "@/modules/finance/reports";
import { addLine, BusinessRuleError, createDraft, issueDocument, recordPayment, voidPayment } from "@/modules/sales/documents";

const PDF = Buffer.from("%PDF-1.4\n%test\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
const TODAY = new Date().toISOString().slice(0, 10);
let a: { id: string }, b: { id: string };
let accA: { id: string }, accB: { id: string };
const ctxA = () => ({ userId: "alice", companyId: a.id, role: "owner" as const });
const cat = async (kind: "income" | "expense", name: string) => (await listCategories("alice", a.id)).find((c) => c.kind === kind && c.name === name)!;

beforeAll(async () => {
  await rawSql`truncate "user", company, app_rate_limit cascade`;
  for (const id of ["alice", "bob", "viewer", "member", "acct"]) await db.insert(schema.user).values({ id, name: id, email: `${id}@t.dev` });
  a = await createCompany("alice", { name: "Alice SARL", country: "TG", currency: "EUR" });
  b = await createCompany("bob", { name: "Bob SAS", country: "TG", currency: "EUR" });
  await db.insert(schema.membership).values([
    { companyId: a.id, userId: "viewer", role: "viewer" },
    { companyId: a.id, userId: "member", role: "member" },
    { companyId: a.id, userId: "acct", role: "accountant" },
  ]);
  accA = await createAccount("alice", a.id, { name: "Banque", kind: "bank", openingBalance: "1000" });
  accB = await createAccount("bob", b.id, { name: "Caisse B", kind: "cash", openingBalance: "0" });
});
afterAll(async () => {
  await rawSql.end();
});

describe("trésorerie", () => {
  it("solde = solde initial + encaissements + recettes − dépenses, hors opérations annulées", async () => {
    const e1 = await createEntry("alice", a.id, { kind: "expense", accountId: accA.id, amount: "120", tax: "20", occurredOn: TODAY, description: "Loyer", categoryId: (await cat("expense", "Loyer")).id });
    await createEntry("alice", a.id, { kind: "income", accountId: accA.id, amount: "50", occurredOn: TODAY, description: "Remboursement", categoryId: (await cat("income", "Autres recettes")).id });
    expect((await listAccounts("alice", a.id))[0]!.balanceMinor).toBe(100000 - 12000 + 5000);
    await voidEntry("alice", a.id, e1.id);
    expect((await listAccounts("alice", a.id))[0]!.balanceMinor).toBe(100000 + 5000);
    await expect(voidEntry("alice", a.id, e1.id)).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it("un paiement de facture affecté à un compte crédite ce compte ; l'annuler le débite", async () => {
    await setNumbering("alice", a.id, "invoice", "FA-{NNNN}");
    const c = await createContact("alice", a.id, { name: "Client" });
    const d = await createDraft("alice", a.id, { type: "invoice", contactId: c.id });
    await addLine("alice", a.id, d.id, { description: "x", quantity: "1", unitPrice: "200" });
    await issueDocument("alice", a.id, d.id);
    const p = await recordPayment("alice", a.id, d.id, { amount: "200", paidOn: TODAY, method: "bank_transfer", accountId: accA.id });
    expect((await listAccounts("alice", a.id))[0]!.balanceMinor).toBe(105000 + 20000);
    expect((await listReceipts("alice", a.id)).map((r) => r.source).sort()).toEqual(["entry", "payment"]);
    await voidPayment("alice", a.id, p.id);
    expect((await listAccounts("alice", a.id))[0]!.balanceMinor).toBe(105000);
  });

  it("refuse un compte d'une autre entreprise ou archivé", async () => {
    await expect(createEntry("alice", a.id, { kind: "expense", accountId: accB.id, amount: "1", occurredOn: TODAY, description: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    const tmp = await createAccount("alice", a.id, { name: "Ancien", kind: "cash", openingBalance: "0" });
    await archiveAccount("alice", a.id, tmp.id);
    await expect(createEntry("alice", a.id, { kind: "expense", accountId: tmp.id, amount: "1", occurredOn: TODAY, description: "x" })).rejects.toBeInstanceOf(BusinessRuleError);
  });
});

describe("règles des opérations", () => {
  it("valide montants, taxe, parties et catégories", async () => {
    const base = { kind: "expense" as const, accountId: accA.id, occurredOn: TODAY, description: "Test" };
    await expect(createEntry("alice", a.id, { ...base, amount: "0" })).rejects.toThrow();
    await expect(createEntry("alice", a.id, { ...base, amount: "-5" })).rejects.toThrow();
    await expect(createEntry("alice", a.id, { ...base, amount: "10", tax: "11" })).rejects.toThrow();
    await expect(createEntry("alice", a.id, { ...base, amount: "10", occurredOn: "demain" })).rejects.toThrow();
    // catégorie de recette sur une dépense : refusé par la base
    await expect(createEntry("alice", a.id, { ...base, amount: "10", categoryId: (await cat("income", "Autres recettes")).id })).rejects.toThrow();
    const client = await createContact("alice", a.id, { name: "C" });
    await expect(createEntry("alice", a.id, { ...base, amount: "10", contactId: client.id })).rejects.toThrow();
  });

  it("refuse un fournisseur d'une autre entreprise", async () => {
    const sb = await createSupplier("bob", b.id, { name: "Fournisseur B" });
    await expect(createEntry("alice", a.id, { kind: "expense", accountId: accA.id, amount: "5", occurredOn: TODAY, description: "x", supplierId: sb.id })).rejects.toThrow();
  });

  it("les opérations sont en ajout seul dans la base", async () => {
    const e = await createEntry("alice", a.id, { kind: "expense", accountId: accA.id, amount: "7", occurredOn: TODAY, description: "Figé" });
    await expect(withTenant(ctxA(), (tx) => tx.update(schema.financeEntry).set({ amountMinor: 1 }).where(eq(schema.financeEntry.id, e.id)))).rejects.toThrow();
    await expect(withTenant(ctxA(), (tx) => tx.delete(schema.financeEntry).where(eq(schema.financeEntry.id, e.id)))).rejects.toThrow();
  });

  it("catégories : création, doublon refusé", async () => {
    await createCategory("alice", a.id, { kind: "expense", name: "Assurance" });
    await expect(createCategory("alice", a.id, { kind: "expense", name: "Assurance" })).rejects.toBeInstanceOf(BusinessRuleError);
  });
});

describe("permissions et isolation", () => {
  it("un membre simple n'accède pas aux finances ; un lecteur lit sans écrire ; un comptable écrit", async () => {
    await expect(listAccounts("member", a.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listEntries("viewer", a.id, { kind: "expense" })).resolves.toBeDefined();
    await expect(createEntry("viewer", a.id, { kind: "expense", accountId: accA.id, amount: "1", occurredOn: TODAY, description: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createEntry("acct", a.id, { kind: "expense", accountId: accA.id, amount: "1", occurredOn: TODAY, description: "Saisie comptable" })).resolves.toBeDefined();
  });

  it("l'autre entreprise ne voit rien", async () => {
    await expect(listAccounts("bob", a.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listEntries("bob", b.id, { kind: "expense" })).length).toBe(0);
    expect((await listAccounts("bob", b.id)).map((x) => x.name)).toEqual(["Caisse B"]);
  });
});

describe("justificatifs", () => {
  let entry: { id: string };
  beforeAll(async () => {
    entry = await createEntry("alice", a.id, { kind: "expense", accountId: accA.id, amount: "30", occurredOn: TODAY, description: "Avec justificatif" });
  });

  it("détecte le vrai type d'après le contenu", () => {
    expect(sniffContentType(PDF)?.type).toBe("application/pdf");
    expect(sniffContentType(Buffer.from("<script>alert(1)</script>"))).toBeNull();
    expect(sniffContentType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))?.type).toBe("image/png");
  });

  it("enregistre un PDF, l'empreinte, et le relit", async () => {
    const att = await addAttachment("alice", a.id, entry.id, { name: "../../etc/Facture Loyer.exe", data: PDF });
    expect(att.filename).toBe("Facture Loyer.pdf"); // chemin et extension annoncée ignorés
    expect(att.contentType).toBe("application/pdf");
    expect(att.sha256).toHaveLength(64);
    const r = await readAttachment("alice", a.id, att.id);
    expect(r!.data.equals(PDF)).toBe(true);
    expect(existsSync(path.resolve(".storage-test", att.storageKey))).toBe(true);
  });

  it("refuse un faux PDF, un fichier vide et un fichier trop gros", async () => {
    await expect(addAttachment("alice", a.id, entry.id, { name: "a.pdf", data: Buffer.from("MZ exécutable déguisé") })).rejects.toThrow(/Format/);
    await expect(addAttachment("alice", a.id, entry.id, { name: "a.pdf", data: Buffer.alloc(0) })).rejects.toThrow(/vide/);
    await expect(addAttachment("alice", a.id, entry.id, { name: "a.pdf", data: Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]) })).rejects.toThrow(/volumineux/);
  });

  it("l'autre entreprise ne peut ni lire ni attacher, et aucun fichier orphelin ne reste", async () => {
    const att = await addAttachment("alice", a.id, entry.id, { name: "b.pdf", data: PDF });
    await expect(readAttachment("bob", a.id, att.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await readAttachment("bob", b.id, att.id)).toBeNull();
    const before = (await db.select().from(schema.attachment)).length;
    await expect(addAttachment("bob", b.id, entry.id, { name: "c.pdf", data: PDF })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await db.select().from(schema.attachment)).length).toBe(before);
    await expect(addAttachment("viewer", a.id, entry.id, { name: "d.pdf", data: PDF })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("supprime le justificatif et son fichier ; la suppression est tracée", async () => {
    const att = await addAttachment("alice", a.id, entry.id, { name: "e.pdf", data: PDF });
    expect(await deleteAttachment("alice", a.id, att.id)).toBe(true);
    expect(existsSync(path.resolve(".storage-test", att.storageKey))).toBe(false);
    const logs = await withTenant(ctxA(), (tx) => tx.select().from(schema.auditLog).where(eq(schema.auditLog.action, "attachment.deleted")));
    expect(logs.length).toBeGreaterThan(0);
  });

  it("la base refuse la modification d'un justificatif", async () => {
    await expect(withTenant(ctxA(), (tx) => tx.update(schema.attachment).set({ filename: "x.pdf" }))).rejects.toThrow();
  });
});

describe("rapport et exports", () => {
  it("parsePeriod normalise et ordonne les dates", () => {
    expect(parsePeriod("2026-03-01", "2026-01-01")).toEqual({ from: "2026-01-01", to: "2026-03-01" });
    expect(parsePeriod("n'importe quoi", undefined, "2026-10-14")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  it("le rapport sépare CA, encaissements, dépenses et résultat indicatif", async () => {
    const r = await financialReport("alice", a.id, { from: TODAY.slice(0, 4) + "-01-01", to: TODAY.slice(0, 4) + "-12-31" });
    expect(r.invoiced.netMinor).toBe(20000);
    expect(r.cashIn.paymentsMinor).toBe(0); // paiement annulé
    expect(r.cashIn.otherIncomeMinor).toBe(5000);
    // dépenses valides : 7 + 1 + 30 = 38 € ; la dépense de 120 € est annulée
    expect(r.expenses.totalMinor).toBe(3800);
    expect(r.indicativeResultMinor).toBe(20000 + 5000 - 3800);
    expect(r.treasuryMinor).toBe(105000 - 3800);
  });

  it("l'export CSV est cloisonné, daté et protégé contre l'injection de formules", async () => {
    await createEntry("alice", a.id, { kind: "expense", accountId: accA.id, amount: "9,5", occurredOn: TODAY, description: '=HYPERLINK("http://evil")' });
    const out = await buildExport("alice", a.id, "expenses", parsePeriod());
    expect(out.csv.startsWith("﻿")).toBe(true);
    expect(out.csv).toContain("'=HYPERLINK");
    expect(out.csv).not.toMatch(/;=HYPERLINK/);
    expect(out.csv).toContain("9,5");
    expect(out.csv).not.toContain("Caisse B");
    const none = await buildExport("bob", b.id, "expenses", parsePeriod());
    expect(none.csv.trim().split("\r\n")).toHaveLength(1);
    await expect(buildExport("viewer", a.id, "invoices", parsePeriod())).resolves.toBeDefined();
    await expect(buildExport("member", a.id, "invoices", parsePeriod())).rejects.toBeInstanceOf(ForbiddenError);
    const inv = await buildExport("alice", a.id, "invoices", parsePeriod());
    expect(inv.csv).toContain("FA-0001");
  });

  it("toCsv échappe séparateurs, guillemets et sauts de ligne", () => {
    expect(toCsv(["a"], [['x;y'], ['il dit "ok"'], ["l1\nl2"], [-5], [null]])).toBe('﻿a\r\n"x;y"\r\n"il dit ""ok"""\r\n"l1\nl2"\r\n-5\r\n\r\n');
  });
});
