import { expect, test } from "@playwright/test";

test.setTimeout(120_000);

async function signup(page: import("@playwright/test").Page, name: string, email: string, path = "/signup") {
  await page.goto(path);
  await page.getByLabel("Nom complet").fill(name);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Mot de passe").fill("motdepasse-solide-9");
  await page.getByRole("button", { name: "Créer mon compte" }).click();
}

test("invitation, rôles, accès et retrait d'un membre", async ({ page, browser }, info) => {
  const tag = `${info.project.name}${Date.now()}`;
  const carol = `carol-${tag}@test.dev`;

  // Propriétaire : compte + entreprise
  await signup(page, "Olga Owner", `olga-${tag}@test.dev`);
  await page.waitForURL("**/onboarding");
  await page.getByLabel("Nom de l'entreprise").fill("Olga SARL");
  await page.getByLabel("Pays (code ISO)").fill("TG");
  await page.getByLabel("Devise (ISO)").fill("XOF");
  await page.getByRole("button", { name: "Créer l'entreprise" }).click();
  await page.waitForURL(/\/app\/[0-9a-f-]{36}$/);
  const dash = page.url();

  // Invitation d'un lecteur
  await page.goto(dash + "/members");
  await page.getByLabel("E-mail de la personne à inviter").fill(carol);
  await page.getByLabel("Rôle", { exact: true }).first().selectOption({ label: "Lecteur" });
  await page.getByRole("button", { name: "Inviter" }).click();
  const link = await page.getByLabel("Lien d'invitation").inputValue();
  expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{40,}$/);
  await expect(page.getByText("expire le")).toBeVisible();

  // Carol ouvre le lien, crée son compte (retour automatique sur l'invitation), accepte
  await page.waitForTimeout(11_000);
  const c = await browser.newContext();
  const cp = await c.newPage();
  await cp.goto(link);
  await expect(cp.getByRole("heading", { name: "Rejoindre Olga SARL" })).toBeVisible();
  await cp.getByRole("link", { name: "Créer un compte" }).click();
  await cp.waitForURL(/\/signup\?next=/);
  await signup(cp, "Carol Lecteur", carol, cp.url().replace(/^https?:\/\/[^/]+/, ""));
  await cp.waitForURL(/\/invite\//);
  await cp.getByRole("button", { name: "Accepter l'invitation" }).click();
  await cp.waitForURL(dash);
  await expect(cp.getByText("Lecteur", { exact: false }).first()).toBeVisible();
  await expect(cp.getByRole("link", { name: "Recettes" })).toBeVisible(); // un lecteur a accès en lecture aux finances
  await cp.goto(dash + "/contacts");
  await expect(cp.getByText("+ Nouveau contact")).toHaveCount(0); // pas d'écriture pour un lecteur
  await cp.goto(dash + "/members");
  await expect(cp.getByLabel("Inviter")).toHaveCount(0);

  // Le lien est à usage unique
  await cp.goto(link);
  await expect(cp.getByText("déjà été utilisée")).toBeVisible();

  // Olga fait passer Carol en « Collaborateur » : l'accès aux finances disparaît
  await page.goto(dash + "/members");
  await page.locator("li").filter({ hasText: "Carol Lecteur" }).getByLabel("Rôle").selectOption({ label: "Collaborateur" });
  await expect(page.locator("li").filter({ hasText: "Carol Lecteur" }).getByLabel("Rôle")).toHaveValue("member");
  // l'action serveur est asynchrone : on recharge jusqu'à ce que le nouveau rôle soit effectif
  await expect(async () => {
    await cp.goto(dash);
    await expect(cp.getByRole("link", { name: "Recettes" })).toHaveCount(0, { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  expect((await cp.goto(dash + "/expenses"))?.status()).toBe(404); // rôle sans accès aux finances : refus propre, pas de 500

  // Retrait : Carol perd l'accès
  page.once("dialog", (d) => d.accept());
  await page.locator("li").filter({ hasText: "Carol Lecteur" }).getByRole("button", { name: "Retirer" }).click();
  await expect(page.locator("li").filter({ hasText: "Carol Lecteur" })).toHaveCount(0);
  expect((await cp.goto(dash))?.status()).toBe(404);

  // Le dernier propriétaire ne peut pas quitter l'entreprise
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Quitter" }).click();
  await expect(page.getByText("dernier propriétaire")).toBeVisible();

  // Mauvaise adresse : une autre personne ne peut pas utiliser le lien d'un tiers
  await page.getByLabel("E-mail de la personne à inviter").fill(`dave-${tag}@test.dev`);
  await page.getByRole("button", { name: "Inviter" }).click();
  const link2 = await page.getByLabel("Lien d'invitation").inputValue();
  await page.waitForTimeout(11_000);
  const e = await browser.newContext();
  const ep = await e.newPage();
  await signup(ep, "Eve Intruse", `eve-${tag}@test.dev`);
  await ep.waitForURL("**/onboarding");
  await ep.goto(link2);
  await ep.getByRole("button", { name: "Accepter l'invitation" }).click();
  await expect(ep.getByText(/destinée à dave-/)).toBeVisible();
});
