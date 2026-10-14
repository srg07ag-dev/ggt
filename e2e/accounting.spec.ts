import { expect, test } from "@playwright/test";
import { signupVerified } from "./helpers";

test.setTimeout(120_000);

const CHART = [
  "A100;Banque test;actif", "A200;Clients test;actif", "A300;Taxe collectée test;passif", "A400;Capital test;capitaux",
  "A500;Ventes test;produit", "A600;Charges test;charge", "A700;Taxe déductible test;actif", "A800;Autres produits test;produit",
].join("\n");

test("comptabilité : plan, période, écritures, contre-passation, comptabilisation automatique, fiscalité", async ({ page, browser }, info) => {
  const tag = `${info.project.name}${Date.now()}`;
  const year = new Date().getUTCFullYear();
  await signupVerified(page, "Comptable Test", `compta-${tag}@test.dev`);
  await page.waitForURL("**/onboarding");
  await page.getByLabel("Nom de l'entreprise").fill("Compta SARL");
  await page.getByLabel("Pays (code ISO)").fill("TG");
  await page.getByLabel("Devise (ISO)").fill("EUR");
  await page.getByRole("button", { name: "Créer l'entreprise" }).click();
  await page.waitForURL(/\/app\/[0-9a-f-]{36}$/);
  const dash = page.url();

  // 1. Plan de comptes : un fichier erroné est refusé en aperçu, rien n'est écrit
  await page.goto(dash + "/accounting/accounts");
  await page.getByLabel("…ou collez le contenu").fill(`${CHART}\nA100;Doublon;actif\nBAD CODE;x;actif`);
  await page.getByRole("button", { name: "Contrôler le fichier" }).click();
  await expect(page.getByText("en erreur")).toBeVisible();
  await expect(page.getByText("Code A100 en double")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Importer/ })).toHaveCount(0);
  // fichier corrigé : aperçu puis import
  await page.getByLabel("…ou collez le contenu").fill(CHART);
  await page.getByRole("button", { name: "Contrôler le fichier" }).click();
  await page.getByRole("button", { name: "Importer 8 compte(s)" }).click();
  await expect(page.getByText("8 compte(s) importé(s)")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("cell", { name: "Banque test" })).toBeVisible();

  // 2. Période
  await page.goto(dash + "/accounting/periods");
  await page.getByRole("button", { name: "Créer", exact: true }).click();
  await expect(page.getByText(`Exercice ${year}`)).toBeVisible();
  await page.getByLabel("Nom").fill("Chevauchement");
  await page.getByRole("button", { name: "Créer", exact: true }).click();
  await expect(page.getByText("chevauche")).toBeVisible();

  // 3. Écriture déséquilibrée : refusée à la validation ; équilibrée : validée et numérotée
  await page.goto(dash + "/accounting/entries");
  await page.getByText("+ Nouvelle écriture manuelle").click();
  await page.getByLabel("Libellé", { exact: true }).fill("Apport en capital");
  await page.getByLabel("Compte ligne 1").selectOption({ label: "A100 — Banque test" });
  await page.getByLabel("Débit ligne 1").fill("1000");
  await page.getByLabel("Compte ligne 2").selectOption({ label: "A400 — Capital test" });
  await page.getByLabel("Crédit ligne 2").fill("900");
  await expect(page.getByText(/Écart/)).toBeVisible();
  await page.getByRole("button", { name: "Créer le brouillon" }).click();
  await page.waitForURL(/\/accounting\/entries\/[0-9a-f-]{36}$/);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Valider l'écriture" }).click();
  await expect(page.getByText(/déséquilibrée/)).toBeVisible();
  await page.getByLabel("Crédit ligne 2").fill("1000");
  await expect(page.getByText("Équilibrée", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Enregistrer le brouillon" }).click();
  await expect(page.getByText("Enregistré")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Valider l'écriture" }).click();
  await expect(page.getByRole("heading", { name: new RegExp(`^OD-${year}-000001$`) })).toBeVisible();
  await expect(page.getByText("Validée", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Débit ligne 1")).toHaveCount(0); // plus modifiable

  // 4. Contre-passation
  await page.getByRole("button", { name: "Contre-passer" }).click();
  await expect(page.getByText("Contre-passation").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: new RegExp(`^OD-${year}-000002$`) })).toBeVisible();

  // 5. Comptabilisation automatique : compte de trésorerie, correspondances, activation
  await page.goto(dash + "/treasury");
  await page.getByText("+ Nouveau compte").click();
  await page.getByLabel("Nom du compte").fill("Banque principale");
  await page.getByLabel(/Solde actuel/).fill("0");
  await page.getByRole("button", { name: "Ajouter le compte" }).click();
  await expect(page.getByText("Banque principale")).toBeVisible();

  await page.goto(dash + "/accounting/settings");
  await page.getByLabel("Clients (créances) — actif").selectOption({ label: "A200 — Clients test" });
  await page.getByLabel("Ventes par défaut — produit").selectOption({ label: "A500 — Ventes test" });
  await page.getByLabel("Taxe collectée par défaut — passif").selectOption({ label: "A300 — Taxe collectée test" });
  await page.getByLabel("Taxe déductible — actif").selectOption({ label: "A700 — Taxe déductible test" });
  await page.getByLabel("Charges par défaut — charge").selectOption({ label: "A600 — Charges test" });
  await page.getByLabel("Autres recettes par défaut — produit").selectOption({ label: "A800 — Autres produits test" });
  await page.getByLabel("Journal des ventes").selectOption({ label: "VT — Journal des ventes" });
  await page.getByLabel("Journal des achats et dépenses").selectOption({ label: "AC — Journal des achats et dépenses" });
  await page.getByLabel("Journal de trésorerie").selectOption({ label: "TR — Journal de trésorerie" });
  await page.getByLabel("Comptabiliser à partir du").fill(`${year}-01-01`);
  // activation sans correspondance de trésorerie possible, mais le paiement sera bloqué tant qu'elle manque
  await page.getByLabel("Activer la comptabilisation automatique").check();
  await page.getByRole("button", { name: "Enregistrer" }).first().click();
  await expect(page.getByText("Enregistré").first()).toBeVisible();
  await page.getByLabel("Compte comptable de Banque principale").selectOption({ label: "A100 — Banque test" });
  await page.waitForTimeout(800);

  // facture émise → écriture automatique
  await page.goto(dash + "/settings");
  await page.getByLabel("Factures", { exact: true }).fill("FA-{YYYY}-{NNNN}");
  await page.getByRole("button", { name: "Enregistrer" }).last().click();
  await expect(page.getByRole("status")).toContainText("Enregistré");
  await page.goto(dash + "/contacts");
  await page.getByText("+ Nouveau contact").click();
  await page.getByLabel("Nom", { exact: true }).fill("Client Compta");
  await page.getByRole("button", { name: "Ajouter le contact" }).click();
  await expect(page.getByRole("link", { name: "Client Compta" })).toBeVisible();
  await page.goto(dash + "/invoices");
  await page.getByText("+ Nouvelle facture").click();
  await page.getByLabel("Client").selectOption({ label: "Client Compta" });
  await page.getByRole("button", { name: "Créer la facture" }).click();
  await page.waitForURL(/\/documents\//);
  await page.getByLabel("Description").fill("Prestation comptabilisée");
  await page.getByLabel("Prix unitaire HT").fill("250");
  await page.getByRole("button", { name: "Ajouter la ligne" }).click();
  await expect(page.getByText("Total TTC").last()).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Émettre la facture" }).click();
  await expect(page.getByRole("heading", { name: /^FA-/ })).toBeVisible();
  const invoiceUrl = page.url();

  await page.goto(dash + "/accounting/entries");
  await expect(page.getByRole("cell", { name: /^Facture FA-/ })).toBeVisible();
  await expect(page.getByText(new RegExp(`VT-${year}-000001`))).toBeVisible();

  // paiement : crédite la banque et solde les clients
  await page.goto(invoiceUrl);
  await page.getByText("+ Enregistrer un paiement").click();
  await page.getByLabel(/Montant/).fill("250");
  await page.getByRole("button", { name: "Enregistrer le paiement" }).click();
  await expect(page.getByText("Payée")).toBeVisible();

  // 6. Balance équilibrée, grand livre, export
  await page.goto(dash + "/accounting/balance");
  await expect(page.getByText("Balance équilibrée")).toBeVisible();
  await expect(page.getByText("A100").first()).toBeVisible();
  await page.screenshot({ path: `e2e/shot-balance-${info.project.name}.png`, fullPage: true });
  const csv = await page.request.get(dash + "/exports/ledger");
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  const text = await csv.text();
  expect(text).toContain("Prestation comptabilisée");
  expect(text).toContain("A200");
  await page.goto(dash + "/accounting/ledger");
  await page.getByLabel("Compte").selectOption({ label: "A200 — Clients test" });
  await page.getByRole("button", { name: "Afficher" }).click();
  await expect(page.getByText("Solde de clôture")).toBeVisible();

  // 7. Fiscalité : aucune règle livrée, suivi manuel de l'historique
  await page.goto(dash + "/tax");
  await expect(page.getByText("Aucune règle fiscale validée pour TG")).toBeVisible();
  await page.getByText("+ Nouvelle échéance").click();
  await page.getByLabel("Intitulé").fill("Déclaration de test");
  await page.getByLabel("Échéance", { exact: true }).fill(`${year + 1}-03-31`);
  await page.getByRole("button", { name: "Ajouter l'échéance" }).click();
  await page.getByRole("link", { name: "Déclaration de test" }).click();
  await page.getByLabel("Type").selectOption("paid");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText(/montant/i).first()).toBeVisible(); // un paiement exige son montant
  await page.getByLabel("Type").selectOption("filed");
  await page.getByLabel(/^Référence/).fill("REF-E2E");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.locator("li").getByText("Déclaration déposée")).toBeVisible();
  await page.getByLabel("Type").selectOption("paid");
  await page.getByLabel(/^Montant/).fill("42");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.locator("li").getByText("Paiement effectué")).toBeVisible();
  await expect(page.getByText("Payée", { exact: true })).toBeVisible();

  // 8. Cloisonnement : un autre compte n'accède à rien
  const other = await browser.newContext();
  const op = await other.newPage();
  await signupVerified(op, "Autre Compta", `autre-${tag}@test.dev`);
  await op.waitForURL("**/onboarding");
  for (const path of ["/accounting", "/accounting/entries", "/accounting/balance", "/tax"]) expect((await op.goto(dash + path))?.status()).toBe(404);
  expect((await op.request.get(dash + "/exports/ledger")).status()).toBe(404);
});
