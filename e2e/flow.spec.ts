import { expect, test } from "@playwright/test";
import { signupVerified } from "./helpers";

test("inscription → entreprise → contact, puis isolation entre comptes", async ({ page, browser }, info) => {
  const tag = `${info.project.name}${Date.now()}`;
  const cspViolations: string[] = [];
  page.on("console", (m) => { if (/content security policy/i.test(m.text())) cspViolations.push(m.text()); });
  page.on("pageerror", (e) => { if (/content security policy/i.test(e.message)) cspViolations.push(e.message); });
  await signupVerified(page, "Alice Test", `alice-${tag}@test.dev`);
  await page.waitForURL("**/onboarding");

  await page.getByLabel("Nom de l'entreprise").fill("Alice SARL");
  await page.getByLabel("Pays (code ISO)").fill("TG");
  await page.getByLabel("Devise (ISO)").fill("XOF");
  await page.getByRole("button", { name: "Créer l'entreprise" }).click();
  await page.waitForURL(/\/app\/[0-9a-f-]{36}$/);
  const dashUrl = page.url();
  await expect(page.getByText("Aucun contact pour l'instant")).toBeVisible();
  await page.screenshot({ path: `e2e/shot-dashboard-${info.project.name}.png` });

  // Contact → recherche → fiche
  await page.goto(dashUrl + "/contacts");
  await page.getByText("+ Nouveau contact").click();
  await page.getByLabel("Nom", { exact: true }).fill("Client Un");
  await page.getByLabel("E-mail").fill("un@client.dev");
  await page.getByLabel("Tags").fill("vip");
  await page.getByRole("button", { name: "Ajouter le contact" }).click();
  await expect(page.getByRole("link", { name: "Client Un" })).toBeVisible();
  await page.getByLabel("Rechercher un contact").fill("zzz");
  await page.getByLabel("Rechercher un contact").press("Enter");
  await expect(page.getByText("Aucun résultat")).toBeVisible();
  await page.getByLabel("Rechercher un contact").fill("client");
  await page.getByLabel("Rechercher un contact").press("Enter");
  await page.getByRole("link", { name: "Client Un" }).click();
  await expect(page.getByRole("heading", { name: "Client Un" })).toBeVisible();

  // Tâche liée à la fiche
  await page.getByText("+ Ajouter une activité").click();
  await page.getByLabel("Titre").fill("Rappeler le client");
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.getByText("Rappeler le client")).toBeVisible();
  await page.getByRole("button", { name: "Marquer comme terminée" }).click();
  await expect(page.getByRole("button", { name: "Rouvrir la tâche" })).toBeVisible();

  // Opportunité → pipeline → déplacement
  await page.goto(dashUrl + "/pipeline");
  await page.getByText("+ Nouvelle opportunité").click();
  await page.getByLabel("Titre").fill("Refonte site");
  await page.getByLabel("Client").selectOption({ label: "Client Un" });
  await page.getByLabel(/Montant/).fill("500000");
  await page.getByRole("button", { name: "Créer l'opportunité" }).click();
  const card = page.getByRole("region", { name: "Nouveau prospect" }).getByRole("article");
  await expect(card).toContainText("Refonte site");
  await card.getByLabel("Étape").selectOption({ label: "Gagné" });
  await card.getByRole("button", { name: "OK" }).click();
  await expect(page.getByRole("region", { name: "Gagné" }).getByRole("article")).toContainText("Refonte site");
  await page.screenshot({ path: `e2e/shot-pipeline-${info.project.name}.png` });

  // Finances : compte de trésorerie (avant la facture, pour y affecter le paiement)
  await page.goto(dashUrl + "/treasury");
  await page.getByText("+ Nouveau compte").click();
  await page.getByLabel("Nom du compte").fill("Banque principale");
  await page.getByLabel(/Solde actuel/).fill("5000");
  await page.getByRole("button", { name: "Ajouter le compte" }).click();
  await expect(page.getByText("Banque principale")).toBeVisible();

  // Ventes : configuration, catalogue, facture, paiement partiel, PDF, avoir
  await page.goto(dashUrl + "/settings");
  await page.getByLabel("Factures", { exact: true }).fill("FA-{YYYY}-{NNNN}");
  await page.getByLabel("Avoirs").fill("AV-{NNNN}");
  await page.getByRole("button", { name: "Enregistrer" }).last().click();
  await expect(page.getByRole("status")).toContainText("Enregistré");
  await page.goto(dashUrl + "/catalog");
  await page.getByLabel("Nom de la taxe").fill("Taxe test");
  await page.getByLabel("Taux (%)").fill("10");
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.getByText("Taxe test 10 %")).toBeVisible();
  await page.goto(dashUrl + "/invoices");
  await page.getByText("+ Nouvelle facture").click();
  await page.getByLabel("Client").selectOption({ label: "Client Un" });
  await page.getByRole("button", { name: "Créer la facture" }).click();
  await page.waitForURL(/\/documents\//);
  await page.getByLabel("Description").fill("Prestation");
  await page.getByLabel("Prix unitaire HT").fill("1000");
  await page.getByLabel("Taxe", { exact: true }).selectOption({ label: "Taxe test (10 %)" });
  await page.getByRole("button", { name: "Ajouter la ligne" }).click();
  await expect(page.getByText("Total TTC").last()).toBeVisible();
  page.once("dialog", (dlg) => dlg.accept());
  await page.getByRole("button", { name: "Émettre la facture" }).click();
  await expect(page.getByRole("heading", { name: /^FA-\d{4}-0001$/ })).toBeVisible();
  await expect(page.getByText("À payer", { exact: true })).toBeVisible();
  await page.getByText("+ Enregistrer un paiement").click();
  await page.getByLabel(/Montant/).fill("400");
  await page.getByRole("button", { name: "Enregistrer le paiement" }).click();
  await expect(page.getByText("Partiellement payée")).toBeVisible();
  await expect(page.getByText(/· Virement/)).toBeVisible();
  const pdf = await page.request.get(page.url() + "/pdf");
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  const docUrl = page.url();
  await page.screenshot({ path: `e2e/shot-invoice-${info.project.name}.png`, fullPage: true });
  await page.goto(dashUrl);
  await expect(page.getByText("Créances clients")).toBeVisible();

  // Dépense avec justificatif, téléchargement protégé, rapport et export
  await page.goto(dashUrl + "/expenses");
  await page.getByText("+ Nouvelle dépense").click();
  await page.getByLabel("Description").fill("Loyer octobre");
  await page.getByLabel(/^Montant TTC/).fill("300");
  await page.getByLabel("Dont taxe").fill("30");
  await page.getByLabel("Justificatif (PDF").setInputFiles({ name: "quittance.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%e2e\n") });
  await page.getByRole("button", { name: "Enregistrer la dépense" }).click();
  await page.waitForURL(/\/entries\//);
  await expect(page.getByRole("link", { name: "quittance.pdf" })).toBeVisible();
  const entryUrl = page.url();
  const att = await page.request.get(await page.getByRole("link", { name: "quittance.pdf" }).evaluate((a) => (a as HTMLAnchorElement).href));
  expect(att.status()).toBe(200);
  expect(att.headers()["content-type"]).toBe("application/pdf");
  expect(att.headers()["x-content-type-options"]).toBe("nosniff");
  expect(att.headers()["content-disposition"]).toContain("attachment");
  const attUrl = await page.getByRole("link", { name: "quittance.pdf" }).evaluate((a) => (a as HTMLAnchorElement).href);
  // un faux PDF est refusé
  await page.getByLabel("Ajouter un justificatif").setInputFiles({ name: "faux.pdf", mimeType: "application/pdf", buffer: Buffer.from("MZ pas un pdf") });
  await page.getByRole("button", { name: "Téléverser" }).click();
  await expect(page.getByText("Format non pris en charge")).toBeVisible();
  // trésorerie : 5000 + 400 encaissés − 300 dépensés = 5 100
  await page.goto(dashUrl + "/treasury");
  await expect(page.getByText("5 100").first()).toBeVisible();
  await page.goto(dashUrl + "/reports");
  await expect(page.getByText("Résultat de gestion (indicatif)")).toBeVisible();
  await page.screenshot({ path: `e2e/shot-reports-${info.project.name}.png`, fullPage: true });
  const csv = await page.request.get(dashUrl + "/exports/expenses");
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(await csv.text()).toContain("Loyer octobre");

  // Archivage
  await page.goto(dashUrl + "/contacts");
  await page.getByRole("link", { name: "Client Un" }).click();
  await page.getByRole("button", { name: "Archiver le contact" }).click();
  await expect(page.getByText("Archivé", { exact: true })).toBeVisible();

  // Un second utilisateur ne peut pas ouvrir l'entreprise d'Alice
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await signupVerified(p2, "Bob Test", `bob-${tag}@test.dev`);
  await p2.waitForURL("**/onboarding");
  const res = await p2.goto(dashUrl + "/contacts");
  expect(res?.status()).toBe(404);
  await expect(p2.getByText("Client Un")).toHaveCount(0);
  expect((await p2.goto(dashUrl + "/pipeline"))?.status()).toBe(404);
  expect((await p2.goto(docUrl))?.status()).toBe(404);
  expect((await p2.request.get(docUrl + "/pdf")).status()).toBe(404);
  expect((await p2.goto(entryUrl))?.status()).toBe(404);
  expect((await p2.request.get(attUrl)).status()).toBe(404);
  expect((await p2.request.get(dashUrl + "/exports/expenses")).status()).toBe(404);

  expect(cspViolations).toEqual([]);
});
