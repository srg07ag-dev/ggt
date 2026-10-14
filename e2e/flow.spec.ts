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

  await page.goto(dashUrl + "/contacts");
  await page.getByLabel("Nom", { exact: true }).fill("Client Un");
  await page.getByRole("button", { name: "Ajouter" }).click();
  await expect(page.getByRole("cell", { name: "Client Un" })).toBeVisible();

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
});
