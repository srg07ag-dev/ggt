import { expect, test } from "@playwright/test";

test("inscription → entreprise → contact, puis isolation entre comptes", async ({ page, browser }, info) => {
  const tag = `${info.project.name}${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Nom complet").fill("Alice Test");
  await page.getByLabel("E-mail").fill(`alice-${tag}@test.dev`);
  await page.getByLabel("Mot de passe").fill("motdepasse-solide-1");
  await page.getByRole("button", { name: "Créer mon compte" }).click();
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

  // Archivage
  await page.goto(dashUrl + "/contacts");
  await page.getByRole("link", { name: "Client Un" }).click();
  await page.getByRole("button", { name: "Archiver le contact" }).click();
  await expect(page.getByText("Archivé", { exact: true })).toBeVisible();

  await page.waitForTimeout(11_000);
  // Un second utilisateur ne peut pas ouvrir l'entreprise d'Alice
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto("/signup");
  await p2.getByLabel("Nom complet").fill("Bob Test");
  await p2.getByLabel("E-mail").fill(`bob-${tag}@test.dev`);
  await p2.getByLabel("Mot de passe").fill("motdepasse-solide-2");
  await p2.getByRole("button", { name: "Créer mon compte" }).click();
  await p2.waitForURL("**/onboarding");
  const res = await p2.goto(dashUrl + "/contacts");
  expect(res?.status()).toBe(404);
  await expect(p2.getByText("Client Un")).toHaveCount(0);
  expect((await p2.goto(dashUrl + "/pipeline"))?.status()).toBe(404);
});
