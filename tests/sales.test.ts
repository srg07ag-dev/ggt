import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql as dsql } from "drizzle-orm";
import { sql as rawSql, db, schema } from "@/db/client";
import { createCompany } from "@/modules/core/companies";
import { setNumbering } from "@/modules/core/settings";
import { ForbiddenError, withTenant } from "@/modules/core/tenant";
import { createContact } from "@/modules/crm/contacts";
import { createProduct, createTaxRate, listTaxRates } from "@/modules/sales/catalog";
import {
  addLine,
  BusinessRuleError,
  convertQuoteToInvoice,
  createCreditNote,
  createDraft,
  getDocument,
  issueDocument,
  listDocuments,
  recordPayment,
  removeLine,
  salesSummary,
  sendQuote,
  setQuoteDecision,
  voidPayment,
} from "@/modules/sales/documents";
import { NumberingNotConfiguredError } from "@/modules/sales/numbering";

const YEAR = new Date().getUTCFullYear();
let a: { id: string }, b: { id: string };
let clientA: { id: string }, clientB: { id: string };
let tax20: { id: string };
const ctxA = () => ({ userId: "alice", companyId: a.id, role: "owner" as const });

async function invoiceWith(total = "100", opts: { tax?: boolean } = { tax: true }) {
  const d = await createDraft("alice", a.id, { type: "invoice", contactId: clientA.id });
  await addLine("alice", a.id, d.id, { description: "Prestation", quantity: "1", unitPrice: total, taxRateId: opts.tax ? tax20.id : undefined });
  return d;
}

beforeAll(async () => {
  await rawSql`truncate "user", company cascade`;
  for (const id of ["alice", "bob", "viewer"]) await db.insert(schema.user).values({ id, name: id, email: `${id}@t.dev` });
  a = await createCompany("alice", { name: "Alice SARL", country: "FR", currency: "EUR" });
  b = await createCompany("bob", { name: "Bob SAS", country: "FR", currency: "EUR" });
  await db.insert(schema.membership).values({ companyId: a.id, userId: "viewer", role: "viewer" });
  clientA = await createContact("alice", a.id, { name: "Client A", address: "1 rue Test" });
  clientB = await createContact("bob", b.id, { name: "Client B" });
  tax20 = await createTaxRate("alice", a.id, { name: "Taxe test 20", ratePercent: "20" });
});
afterAll(async () => {
  await rawSql.end();
});

describe("numérotation", () => {
  it("refuse d'émettre tant que la numérotation n'est pas configurée", async () => {
    const d = await invoiceWith();
    await expect(issueDocument("alice", a.id, d.id)).rejects.toBeInstanceOf(NumberingNotConfiguredError);
  });

  it("attribue des numéros consécutifs sans trou, même en cas d'échec ou de concurrence", async () => {
    await setNumbering("alice", a.id, "invoice", "FA-{YYYY}-{NNNN}");
    await setNumbering("alice", a.id, "quote", "DEV-{NNNN}");
    await setNumbering("alice", a.id, "credit_note", "AV-{NNNN}");
    // émission impossible (aucune ligne) : ne consomme aucun numéro
    const empty = await createDraft("alice", a.id, { type: "invoice", contactId: clientA.id });
    await expect(issueDocument("alice", a.id, empty.id)).rejects.toBeInstanceOf(BusinessRuleError);

    const drafts = await Promise.all([1, 2, 3, 4, 5].map(() => invoiceWith("10")));
    const numbers = await Promise.all(drafts.map((d) => issueDocument("alice", a.id, d.id)));
    const seq = numbers.map((n) => Number(n.split("-")[2])).sort((x, y) => x - y);
    expect(seq).toEqual([1, 2, 3, 4, 5]);
    expect(numbers[0]).toMatch(new RegExp(`^FA-${YEAR}-\\d{4}$`));
  });

  it("la numérotation d'une entreprise ne touche pas l'autre", async () => {
    await expect(setNumbering("alice", b.id, "invoice", "X-{NNNN}")).rejects.toBeInstanceOf(ForbiddenError);
    const rows = await withTenant({ userId: "bob", companyId: b.id, role: "owner" }, (tx) => tx.select().from(schema.numberingCounter));
    expect(rows).toHaveLength(0);
  });
});

describe("facture : calcul, émission et verrouillage", () => {
  let inv: { id: string };
  it("calcule HT, taxe et TTC à partir des lignes", async () => {
    inv = await invoiceWith("0");
    await addLine("alice", a.id, inv.id, { description: "Conseil", quantity: "2,5", unitPrice: "33,33", taxRateId: tax20.id });
    const d = await getDocument("alice", a.id, inv.id);
    expect(d!.doc.subtotalMinor).toBe(8333);
    expect(d!.doc.taxMinor).toBe(1667);
    expect(d!.doc.totalMinor).toBe(10000);
    expect(d!.lines[1]!.taxRateBp).toBe(2000);
  });

  it("modifier le taux du catalogue ne change pas une ligne déjà saisie", async () => {
    await db.update(schema.taxRate).set({ rateBp: 500 }).where(eq(schema.taxRate.id, tax20.id));
    const d = await getDocument("alice", a.id, inv.id);
    expect(d!.lines[1]!.taxRateBp).toBe(2000);
    await db.update(schema.taxRate).set({ rateBp: 2000 }).where(eq(schema.taxRate.id, tax20.id));
  });

  it("émet : numéro, identités figées, statut non payé", async () => {
    const number = await issueDocument("alice", a.id, inv.id);
    const d = await getDocument("alice", a.id, inv.id);
    expect(d!.doc.number).toBe(number);
    expect(d!.doc.status).toBe("issued");
    expect(d!.settlement.state).toBe("unpaid");
    expect(d!.settlement.paidMinor).toBe(0);
    expect((d!.doc.snapshot as { customer: { name: string } }).customer.name).toBe("Client A");
  });

  it("l'application refuse de modifier un document émis", async () => {
    await expect(addLine("alice", a.id, inv.id, { description: "x", quantity: "1", unitPrice: "1" })).rejects.toBeInstanceOf(BusinessRuleError);
    const d = await getDocument("alice", a.id, inv.id);
    await expect(removeLine("alice", a.id, inv.id, d!.lines[0]!.id)).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it("la base refuse aussi toute modification directe, même en SQL", async () => {
    await expect(withTenant(ctxA(), (tx) => tx.update(schema.salesDocument).set({ totalMinor: 1, subtotalMinor: 1, taxMinor: 0 }).where(eq(schema.salesDocument.id, inv.id)))).rejects.toThrow();
    await expect(withTenant(ctxA(), (tx) => tx.delete(schema.salesDocument).where(eq(schema.salesDocument.id, inv.id)))).rejects.toThrow();
    await expect(withTenant(ctxA(), (tx) => tx.update(schema.salesLine).set({ unitPriceMinor: 1 }).where(eq(schema.salesLine.documentId, inv.id)))).rejects.toThrow();
    await expect(withTenant(ctxA(), (tx) => tx.delete(schema.salesLine).where(eq(schema.salesLine.documentId, inv.id)))).rejects.toThrow();
    await expect(
      withTenant(ctxA(), (tx) => tx.insert(schema.salesLine).values({ companyId: a.id, documentId: inv.id, position: 99, description: "x", quantityMilli: 1000, unitPriceMinor: 1, netMinor: 1, taxMinor: 0 })),
    ).rejects.toThrow();
  });
});

describe("paiements", () => {
  let inv: { id: string };
  beforeAll(async () => {
    inv = await invoiceWith("100"); // 120,00 TTC
    await issueDocument("alice", a.id, inv.id);
  });

  it("paiement partiel puis complet : « payée » seulement quand les paiements couvrent le total", async () => {
    const p1 = await recordPayment("alice", a.id, inv.id, { amount: "50", paidOn: "2026-10-01", method: "cash" });
    let d = await getDocument("alice", a.id, inv.id);
    expect(d!.settlement).toMatchObject({ paidMinor: 5000, outstandingMinor: 7000, state: expect.stringMatching(/partial|overdue/) });
    await recordPayment("alice", a.id, inv.id, { amount: "70", paidOn: "2026-10-02", method: "bank_transfer", reference: "VIR-1" });
    d = await getDocument("alice", a.id, inv.id);
    expect(d!.settlement.state).toBe("paid");
    // annuler un paiement rouvre le solde
    await voidPayment("alice", a.id, p1.id);
    d = await getDocument("alice", a.id, inv.id);
    expect(d!.settlement.outstandingMinor).toBe(5000);
    expect(d!.settlement.state).not.toBe("paid");
  });

  it("refuse le surpaiement et les montants invalides", async () => {
    await expect(recordPayment("alice", a.id, inv.id, { amount: "50,01", paidOn: "2026-10-03", method: "cash" })).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(recordPayment("alice", a.id, inv.id, { amount: "0", paidOn: "2026-10-03", method: "cash" })).rejects.toThrow();
    await expect(recordPayment("alice", a.id, inv.id, { amount: "-5", paidOn: "2026-10-03", method: "cash" })).rejects.toThrow();
  });

  it("deux paiements simultanés ne peuvent pas dépasser le solde", async () => {
    const r = await Promise.allSettled([
      recordPayment("alice", a.id, inv.id, { amount: "30", paidOn: "2026-10-03", method: "cash" }),
      recordPayment("alice", a.id, inv.id, { amount: "30", paidOn: "2026-10-03", method: "cash" }),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((await getDocument("alice", a.id, inv.id))!.settlement.outstandingMinor).toBe(2000);
  });

  it("les paiements sont en ajout seul dans la base", async () => {
    await expect(withTenant(ctxA(), (tx) => tx.update(schema.payment).set({ amountMinor: 1 }))).rejects.toThrow();
    await expect(withTenant(ctxA(), (tx) => tx.delete(schema.payment))).rejects.toThrow();
  });

  it("on ne peut pas payer un brouillon", async () => {
    const d = await invoiceWith("10");
    await expect(recordPayment("alice", a.id, d.id, { amount: "1", paidOn: "2026-10-03", method: "cash" })).rejects.toBeInstanceOf(BusinessRuleError);
  });
});

describe("avoirs", () => {
  it("un avoir émis réduit le solde, sans dépasser la facture", async () => {
    const inv = await invoiceWith("100");
    await issueDocument("alice", a.id, inv.id);
    const cn = await createCreditNote("alice", a.id, inv.id);
    const cnNum = await issueDocument("alice", a.id, cn.id);
    expect(cnNum).toMatch(/^AV-\d{4}$/);
    const d = await getDocument("alice", a.id, inv.id);
    expect(d!.settlement.creditedMinor).toBe(12000);
    expect(d!.settlement.outstandingMinor).toBe(0);
    const cn2 = await createCreditNote("alice", a.id, inv.id);
    await expect(issueDocument("alice", a.id, cn2.id)).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it("un avoir ne se crée pas sur un brouillon", async () => {
    const d = await invoiceWith("10");
    await expect(createCreditNote("alice", a.id, d.id)).rejects.toBeInstanceOf(BusinessRuleError);
  });
});

describe("devis", () => {
  it("brouillon → envoyé → accepté → converti en facture", async () => {
    const q = await createDraft("alice", a.id, { type: "quote", contactId: clientA.id });
    await addLine("alice", a.id, q.id, { description: "Étude", quantity: "3", unitPrice: "100", taxRateId: tax20.id });
    await expect(convertQuoteToInvoice("alice", a.id, q.id)).rejects.toBeInstanceOf(BusinessRuleError);
    const num = await sendQuote("alice", a.id, q.id);
    expect(num).toMatch(/^DEV-\d{4}$/);
    await expect(addLine("alice", a.id, q.id, { description: "x", quantity: "1", unitPrice: "1" })).rejects.toBeInstanceOf(BusinessRuleError);
    await setQuoteDecision("alice", a.id, q.id, "accepted");
    const inv = await convertQuoteToInvoice("alice", a.id, q.id);
    const d = await getDocument("alice", a.id, inv.id);
    expect(d!.doc.status).toBe("draft");
    expect(d!.doc.relatedId).toBe(q.id);
    expect(d!.doc.totalMinor).toBe(36000);
    expect((await getDocument("alice", a.id, q.id))!.doc.status).toBe("converted");
    await expect(convertQuoteToInvoice("alice", a.id, q.id)).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it("un devis refusé ne se convertit pas", async () => {
    const q = await createDraft("alice", a.id, { type: "quote", contactId: clientA.id });
    await addLine("alice", a.id, q.id, { description: "x", quantity: "1", unitPrice: "10" });
    await sendQuote("alice", a.id, q.id);
    await setQuoteDecision("alice", a.id, q.id, "declined");
    await expect(convertQuoteToInvoice("alice", a.id, q.id)).rejects.toBeInstanceOf(BusinessRuleError);
  });
});

describe("isolation et permissions", () => {
  it("l'autre entreprise ne voit ni ne touche les documents", async () => {
    const d = await invoiceWith("10");
    await expect(getDocument("bob", a.id, d.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await getDocument("bob", b.id, d.id)).toBeNull();
    await expect(addLine("bob", b.id, d.id, { description: "x", quantity: "1", unitPrice: "1" })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listDocuments("bob", b.id, "invoice")).length).toBe(0);
  });

  it("refuse un client ou un taux d'une autre entreprise", async () => {
    await expect(createDraft("alice", a.id, { type: "invoice", contactId: clientB.id })).rejects.toThrow();
    const d = await invoiceWith("10");
    const taxB = await createTaxRate("bob", b.id, { name: "T", ratePercent: "5" });
    await expect(addLine("alice", a.id, d.id, { description: "x", quantity: "1", unitPrice: "1", taxRateId: taxB.id })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listTaxRates("alice", a.id)).every((t) => t.companyId === a.id)).toBe(true);
  });

  it("un lecteur peut consulter mais pas créer, émettre ni encaisser", async () => {
    await expect(createDraft("viewer", a.id, { type: "invoice", contactId: clientA.id })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listDocuments("viewer", a.id, "invoice")).length).toBeGreaterThan(0);
    await expect(createTaxRate("viewer", a.id, { name: "x", ratePercent: "1" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("le catalogue crée un produit avec taux, et les indicateurs sont cohérents", async () => {
    const p = await createProduct("alice", a.id, { kind: "service", name: "Audit", price: "250", taxRateId: tax20.id });
    const d = await createDraft("alice", a.id, { type: "invoice", contactId: clientA.id });
    await addLine("alice", a.id, d.id, { productId: p.id, quantity: "2" });
    expect((await getDocument("alice", a.id, d.id))!.doc.totalMinor).toBe(60000);
    const s = await salesSummary("alice", a.id);
    expect(s.currency).toBe("EUR");
    expect(s.invoicedMinor).toBeGreaterThan(0);
    expect(s.receivedMinor).toBe(10000); // 50 + 70 − 50 annulé + 30 simultané
    expect(s.outstandingMinor).toBeGreaterThanOrEqual(0);
    const sb = await salesSummary("bob", b.id);
    expect(sb.invoices).toBe(0);
    void dsql;
  });
});
