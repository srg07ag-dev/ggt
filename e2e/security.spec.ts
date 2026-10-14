import { expect, test } from "@playwright/test";
import { login, mailLink, signupVerified, totp } from "./helpers";

test.setTimeout(150_000);

test("vérification d'e-mail, mot de passe oublié, double authentification, limitation de débit", async ({ page, browser, request }, info) => {
  const tag = `${info.project.name}${Date.now()}`;
  // Chaque « appareil » a sa propre IP simulée : la limite de 5 connexions/minute est par IP.
  const base = Math.floor(Math.random() * 150) + 20;
  const dev = (n: number) => ({ extraHTTPHeaders: { "x-forwarded-for": `198.51.100.${base + n}` } });
  await page.context().setExtraHTTPHeaders(dev(0).extraHTTPHeaders);
  const email = `zed-${tag}@test.dev`;
  const pw1 = "premier-mot-de-passe-1";
  const pw2 = "second-mot-de-passe-2";

  // 1. Impossible de se connecter avant d'avoir confirmé son adresse
  await page.goto("/signup");
  await page.getByLabel("Nom complet").fill("Zed Test");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(pw1);
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page.getByText("Vérifiez votre boîte e-mail")).toBeVisible();
  await login(page, email, pw1);
  await expect(page.getByText("Adresse e-mail non confirmée")).toBeVisible();
  // le lien de confirmation active le compte et ouvre la session
  await page.goto(await mailLink(email, "Confirmez"));
  await page.waitForURL("**/onboarding");

  // 2. Mot de passe oublié : le lien révoque les sessions existantes
  const other = await browser.newContext(dev(1));
  const op = await other.newPage();
  await login(op, email, pw1);
  await op.waitForURL("**/onboarding");

  await page.context().clearCookies();
  await page.goto("/forgot-password");
  await page.getByLabel("E-mail").fill(email);
  await page.getByRole("button", { name: "Envoyer le lien" }).click();
  await expect(page.getByText("Si un compte existe")).toBeVisible();
  // même réponse pour une adresse inconnue (pas d'énumération de comptes)
  await page.goto("/forgot-password");
  await page.getByLabel("E-mail").fill(`inconnu-${tag}@test.dev`);
  await page.getByRole("button", { name: "Envoyer le lien" }).click();
  await expect(page.getByText("Si un compte existe")).toBeVisible();

  await page.goto(await mailLink(email, "Réinitialisation"));
  await page.getByLabel("Nouveau mot de passe").fill(pw2);
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await page.waitForURL(/\/login\?reset=1/);
  await expect(page.getByText("Mot de passe modifié")).toBeVisible();
  // l'ancienne session de l'autre appareil est coupée
  await op.goto("/app");
  await op.waitForURL(/\/login/);
  await login(page, email, pw1);
  await expect(page.getByRole("alert").filter({ hasText: /incorrect|invalid|Invalid/i }).first()).toBeVisible();
  await login(page, email, pw2);
  await page.waitForURL("**/onboarding");

  // 3. Double authentification : activation, connexion avec code, code de secours
  await page.goto("/account/security");
  await page.getByLabel("Mot de passe (confirmation)").fill(pw2);
  await page.getByRole("button", { name: "Activer" }).click();
  await expect(page.getByAltText("QR code d'activation")).toBeVisible();
  await page.getByText("Saisie manuelle").click();
  const uri = await page.locator("details code").innerText();
  const secret = new URL(uri).searchParams.get("secret")!;
  const backup = (await page.locator("ul.grid li").allInnerTexts())[0]!.trim();
  await page.getByLabel("Code", { exact: true }).fill(totp(secret));
  await page.getByRole("button", { name: "Confirmer" }).click();
  await expect(page.getByText("Activée", { exact: true })).toBeVisible();

  const c2 = await browser.newContext(dev(2));
  const p3 = await c2.newPage();
  await login(p3, email, pw2);
  await p3.waitForURL(/\/two-factor/);
  await p3.getByLabel("Code à 6 chiffres").fill("000000");
  await p3.getByRole("button", { name: "Vérifier" }).click();
  await expect(p3.getByText("Code incorrect")).toBeVisible();
  await p3.getByLabel("Code à 6 chiffres").fill(totp(secret));
  await p3.getByRole("button", { name: "Vérifier" }).click();
  await p3.waitForURL("**/onboarding");

  const c3 = await browser.newContext(dev(3));
  const p4 = await c3.newPage();
  await login(p4, email, pw2);
  await p4.waitForURL(/\/two-factor/);
  await p4.getByRole("button", { name: "Utiliser un code de secours" }).click();
  await p4.getByLabel("Code de secours").fill(backup);
  await p4.getByRole("button", { name: "Vérifier" }).click();
  await p4.waitForURL("**/onboarding");
  // un code de secours ne sert qu'une fois
  const c4 = await browser.newContext(dev(4));
  const p5 = await c4.newPage();
  await login(p5, email, pw2);
  await p5.waitForURL(/\/two-factor/);
  await p5.getByRole("button", { name: "Utiliser un code de secours" }).click();
  await p5.getByLabel("Code de secours").fill(backup);
  await p5.getByRole("button", { name: "Vérifier" }).click();
  await expect(p5.getByText("Code incorrect")).toBeVisible();

  // 4. Sessions : la liste montre les appareils et permet de couper les autres
  await page.goto("/account/security");
  await expect(page.getByText("Cet appareil")).toBeVisible();
  await page.getByRole("button", { name: "Déconnecter tous les autres appareils" }).click();
  await expect(page.getByRole("button", { name: "Déconnecter tous les autres appareils" })).toHaveCount(0);
  await p3.goto("/app");
  await p3.waitForURL(/\/login/);

  // 5. Limitation de débit par IP : 5 tentatives par minute, puis refus
  const ip = `203.0.113.${Math.floor(Math.random() * 200) + 20}`;
  const attempt = (who: string, from: string) =>
    request.post("/api/auth/sign-in/email", { headers: { "x-forwarded-for": from, origin: "http://localhost:3100" }, data: { email: who, password: "mauvais-mot-de-passe" } });
  const statuses: number[] = [];
  for (let i = 0; i < 7; i++) statuses.push((await attempt(`brute-${tag}@test.dev`, ip)).status());
  expect(statuses.slice(0, 5).every((s) => s !== 429)).toBe(true);
  expect(statuses.slice(5).every((s) => s === 429)).toBe(true);

  // 6. Limitation par compte : changer d'IP ne contourne pas la limite (20 tentatives / 15 min par adresse)
  const target = `cible-${tag}@test.dev`;
  const results: number[] = [];
  for (let i = 0; i < 22; i++) results.push((await attempt(target, `192.0.2.${(i % 200) + 10}`)).status());
  expect(results.slice(0, 20).every((s) => s !== 429)).toBe(true);
  expect(results.slice(20).every((s) => s === 429)).toBe(true);
});
