import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql as rawSql, db, schema } from "@/db/client";
import { createCompany } from "@/modules/core/companies";
import { setNumbering } from "@/modules/core/settings";
import { createContact } from "@/modules/crm/contacts";
import { addLine, createDraft, getDocument, issueDocument } from "@/modules/sales/documents";
import { renderDocumentPdf } from "@/modules/sales/pdf";

let companyId: string;
beforeAll(async () => {
  await rawSql`truncate "user", company, app_rate_limit cascade`;
  await db.insert(schema.user).values({ id: "u", name: "u", email: "u@t.dev" });
  companyId = (await createCompany("u", { name: "Société Éclair", country: "TG", currency: "XOF" })).id;
  await setNumbering("u", companyId, "invoice", "FA-{NNNN}");
});
afterAll(async () => {
  await rawSql.end();
});

describe("PDF", () => {
  it("génère un PDF valide pour une facture émise (accents, XOF)", async () => {
    const c = await createContact("u", companyId, { name: "Élodie Ça" });
    const d = await createDraft("u", companyId, { type: "invoice", contactId: c.id });
    await addLine("u", companyId, d.id, { description: "Création de logo — très long libellé ".repeat(4), quantity: "2", unitPrice: "150000" });
    await issueDocument("u", companyId, d.id);
    const pdf = await renderDocumentPdf((await getDocument("u", companyId, d.id))!);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1500);
  });

  it("génère un brouillon avec plusieurs pages si nécessaire", async () => {
    const c = await createContact("u", companyId, { name: "Client" });
    const d = await createDraft("u", companyId, { type: "invoice", contactId: c.id });
    for (let i = 0; i < 40; i++) await addLine("u", companyId, d.id, { description: `Ligne ${i}`, quantity: "1", unitPrice: "100" });
    const pdf = await renderDocumentPdf((await getDocument("u", companyId, d.id))!);
    expect((pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1);
  });
});
