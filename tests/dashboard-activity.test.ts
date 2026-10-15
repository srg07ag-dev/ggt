import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql as rawSql, db, schema } from "@/db/client";
import { createCompany } from "@/modules/core/companies";
import { setNumbering } from "@/modules/core/settings";
import { ForbiddenError } from "@/modules/core/tenant";
import { createContact } from "@/modules/crm/contacts";
import { addLine, createCreditNote, createDraft, issueDocument, monthlyActivity, recordPayment } from "@/modules/sales/documents";

let a: { id: string }, b: { id: string };

beforeAll(async () => {
  await rawSql`truncate "user", company, app_rate_limit cascade`;
  for (const id of ["alice", "bob"]) await db.insert(schema.user).values({ id, name: id, email: `${id}@t.dev` });
  a = await createCompany("alice", { name: "Alice SARL", country: "TG", currency: "XOF" });
  b = await createCompany("bob", { name: "Bob SAS", country: "TG", currency: "XOF" });
  await setNumbering("alice", a.id, "invoice", "FA-{NNNN}");
  await setNumbering("alice", a.id, "credit_note", "AV-{NNNN}");
});
afterAll(async () => {
  await rawSql.end();
});

describe("activité mensuelle du tableau de bord", () => {
  it("renvoie 6 mois à zéro pour une entreprise sans mouvement, dans l'ordre chronologique", async () => {
    const r = await monthlyActivity("alice", a.id, 6);
    expect(r.months).toHaveLength(6);
    expect(r.months.every((m) => m.invoicedMinor === 0 && m.receivedMinor === 0)).toBe(true);
    expect(r.months.map((m) => m.month)).toEqual([...r.months.map((m) => m.month)].sort());
    expect(r.currency).toBe("XOF");
  });

  it("compte le facturé net d'avoirs et l'encaissé du mois, sans les paiements annulés", async () => {
    const client = await createContact("alice", a.id, { name: "Client" });
    const d = await createDraft("alice", a.id, { type: "invoice", contactId: client.id });
    await addLine("alice", a.id, d.id, { description: "Prestation", quantity: "1", unitPrice: "1000" });
    await issueDocument("alice", a.id, d.id);
    await recordPayment("alice", a.id, d.id, { amount: "400", paidOn: new Date().toISOString().slice(0, 10), method: "cash" });
    const cn = await createCreditNote("alice", a.id, d.id);
    // un avoir en brouillon ne compte pas encore
    let cur = (await monthlyActivity("alice", a.id, 6)).months.at(-1)!;
    expect(cur.invoicedMinor).toBe(1000);
    expect(cur.receivedMinor).toBe(400);
    // avoir complet émis le même mois : facturé net = 1 000 − 1 000
    await issueDocument("alice", a.id, cn.id);
    cur = (await monthlyActivity("alice", a.id, 6)).months.at(-1)!;
    expect(cur.invoicedMinor).toBe(0);
    expect(cur.receivedMinor).toBe(400);
  });

  it("ne mélange pas les entreprises et respecte les droits", async () => {
    const other = await monthlyActivity("bob", b.id, 6);
    expect(other.months.every((m) => m.invoicedMinor === 0 && m.receivedMinor === 0)).toBe(true);
    await expect(monthlyActivity("bob", a.id, 6)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
