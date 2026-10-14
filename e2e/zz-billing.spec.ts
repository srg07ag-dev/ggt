import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { enableTwoFactor, signupVerified } from "./helpers";

test.setTimeout(180_000);

const dbUrl = () => process.env.DATABASE_URL ?? readFileSync(".env.local", "utf8").match(/^DATABASE_URL=(.*)$/m)![1]!;
const run = (script: string, ...args: string[]) => execFileSync("npx", ["tsx", script, ...args], { env: { ...process.env, DATABASE_URL: dbUrl() }, encoding: "utf8" });
const psql = (sql: string) => execFileSync("psql", [dbUrl(), "-qc", sql]);

test.afterAll(() => {
  // la facturation ne doit jamais rester active pour les autres tests
  psql("update platform_settings set billing_enabled = false");
});

test("administration : offres, facturation, limites, paiement constaté, suspension", async ({ page, browser }, info) => {
  // état de départ propre : aucune offre, facturation inactive (le test est rejouable)
  psql("update platform_settings set billing_enabled = false");
  psql("truncate plan cascade");
  const tag = `${info.project.name}${Date.now()}`;
  const adminEmail = `admin-${tag}@test.dev`;
  const ownerEmail = `olive-${tag}@test.dev`;
  const pw = "motdepasse-solide-9";
  const essai = `essai-${tag}`.toLowerCase().slice(0, 30);
  const pro = `pro-${tag}`.toLowerCase().slice(0, 30);

  // 1. Opérateur : sans 2FA, l'accès à l'administration est redirigé vers l'activation
  await signupVerified(page, "Admin Test", adminEmail, "/signup", pw);
  await page.waitForURL("**/onboarding");
  run("scripts/make-admin.ts", adminEmail);
  await page.goto("/admin");
  await page.waitForURL(/\/account\/security\?need2fa=1/);
  await expect(page.getByText("exige la double authentification")).toBeVisible();
  await enableTwoFactor(page, pw);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Vue d'ensemble" })).toBeVisible();

  // 2. Un utilisateur ordinaire ne voit pas l'administration (404)
  const oc = await browser.newContext();
  const op = await oc.newPage();
  await signupVerified(op, "Olive Owner", ownerEmail, "/signup", pw);
  await op.waitForURL("**/onboarding");
  for (const path of ["/admin", "/admin/plans", "/admin/companies", "/admin/settings"]) expect((await op.goto(path))?.status()).toBe(404);

  // 3. Offres : l'activation de la facturation exige une offre par défaut
  await page.goto("/admin/settings");
  await page.getByLabel("Facturation activée").check();
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Définissez d'abord une offre par défaut")).toBeVisible();

  await page.goto("/admin/plans");
  await page.getByLabel("Code (identifiant)").fill(essai);
  await page.getByLabel("Nom affiché").fill("Essai test");
  await page.getByLabel("Membres max.").fill("2");
  await page.getByLabel("Jours d'essai").fill("14");
  for (const m of ["Finances", "Comptabilité", "Fiscalité"]) await page.getByLabel(m, { exact: true }).uncheck();
  await page.getByLabel("Offre par défaut des nouvelles entreprises").check();
  await page.getByRole("button", { name: "Créer l'offre" }).click();
  await page.waitForURL("**/admin/plans");
  await expect(page.getByText("Essai test").first()).toBeVisible();
  await page.getByLabel("Code (identifiant)").fill(pro);
  await page.getByLabel("Nom affiché").fill("Pro test");
  await page.getByLabel("Prix par période (0 = gratuit)").fill("20");
  await page.getByRole("button", { name: "Créer l'offre" }).click();
  await expect(page.getByText("Pro test").first()).toBeVisible();

  await page.goto("/admin/settings");
  await page.getByLabel("Facturation activée").check();
  await page.getByLabel("Instructions de paiement affichées aux clients").fill("Virement de test sur le compte 123");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("status")).toContainText("Enregistré");

  // 4. Le propriétaire crée son entreprise : offre par défaut, modules limités
  await op.goto("/onboarding");
  await op.getByLabel("Nom de l'entreprise").fill(`Olive ${tag}`);
  await op.getByLabel("Pays (code ISO)").fill("TG");
  await op.getByLabel("Devise (ISO)").fill("EUR");
  await op.getByRole("button", { name: "Créer l'entreprise" }).click();
  await op.waitForURL(/\/app\/[0-9a-f-]{36}$/);
  const dash = op.url();
  await expect(op.getByRole("link", { name: "Contacts" })).toBeVisible();
  await expect(op.getByRole("link", { name: "Plan de comptes" })).toHaveCount(0);
  await expect(op.getByRole("link", { name: "Dépenses" })).toHaveCount(0);
  // un module hors offre redirige vers l'abonnement avec une explication
  await op.goto(dash + "/accounting");
  await op.waitForURL(/\/billing\?reason=module/);
  await expect(op.getByText("n'est pas inclus dans votre offre").first()).toBeVisible();
  await expect(op.getByText("Actif", { exact: true })).toBeVisible();

  // limite de membres : 1 membre + 1 invitation = 2 (limite) ; la suivante est refusée
  await op.goto(dash + "/members");
  await op.getByLabel("E-mail de la personne à inviter").fill(`p1-${tag}@test.dev`);
  await op.getByRole("button", { name: "Inviter" }).click();
  await expect(op.getByLabel("Lien d'invitation")).toBeVisible();
  await op.getByLabel("E-mail de la personne à inviter").fill(`p2-${tag}@test.dev`);
  await op.getByRole("button", { name: "Inviter" }).click();
  await expect(op.getByText("Limite de votre offre atteinte")).toBeVisible();

  // 5. Choix d'une offre payante : facture à régler, accès inchangé tant que non payée
  await op.goto(dash + "/billing");
  const proCard = op.locator("section", { hasText: "Pro test" }).first();
  await proCard.getByRole("button", { name: "Choisir cette offre" }).click();
  await expect(op.getByText("Factures à régler")).toBeVisible();
  await expect(op.getByText("Virement de test sur le compte 123")).toBeVisible();
  await op.reload();
  await expect(op.getByRole("link", { name: "Plan de comptes" })).toHaveCount(0);

  await op.screenshot({ path: `e2e/shot-billing-${info.project.name}.png`, fullPage: true });

  // 6. L'opérateur constate le paiement : l'offre s'applique
  await page.goto("/admin/companies");
  await page.getByLabel("Rechercher une entreprise").fill(`Olive ${tag}`);
  await page.getByLabel("Rechercher une entreprise").press("Enter");
  await page.getByRole("link", { name: `Olive ${tag}` }).click();
  await expect(page.getByText(ownerEmail)).toBeVisible();
  await expect(page.getByText("Contacts")).toHaveCount(0); // aucune donnée métier côté administration
  await page.getByLabel("Référence du paiement").fill("VIR-E2E-1");
  await page.getByRole("button", { name: "Marquer payée" }).click();
  await expect(page.getByText("Payée", { exact: true })).toBeVisible();

  // l'offre gratuite était active : la période payée démarre immédiatement
  await op.waitForTimeout(3500); // cache d'accès de 3 s
  await op.goto(dash + "/accounting");
  await expect(op.getByRole("heading", { name: "Comptabilité" }).first()).toBeVisible();
  await expect(op.getByRole("link", { name: "Plan de comptes", exact: true })).toBeVisible();

  await page.screenshot({ path: `e2e/shot-admin-company-${info.project.name}.png`, fullPage: true });

  // 7. Suspension : lecture seule, avec bandeau ; puis levée
  await page.reload();
  await page.getByLabel("Motif (conservé dans l'audit)").last().fill("Test de suspension e2e");
  await page.getByRole("button", { name: "Suspendre l'entreprise" }).click();
  await expect(page.getByText("Suspension : Test de suspension e2e")).toBeVisible();
  await op.waitForTimeout(3500);
  await op.goto(dash + "/contacts");
  await expect(op.getByText("Ce compte est suspendu")).toBeVisible();
  await expect(op.getByText("+ Nouveau contact")).toHaveCount(1); // le formulaire s'affiche, mais l'écriture est refusée par le serveur
  await op.getByText("+ Nouveau contact").click();
  await op.getByLabel("Nom", { exact: true }).fill("Refusé");
  await op.getByRole("button", { name: "Ajouter le contact" }).click();
  await expect(op.getByText("lecture seule").first()).toBeVisible();
  await page.getByLabel("Motif (conservé dans l'audit)").last().fill("Régularisation reçue");
  await page.getByRole("button", { name: "Lever la suspension" }).click();
  await expect(page.getByText("Suspension :")).toHaveCount(0);

  // 8. Le journal de la plateforme garde la trace des actions
  await page.goto("/admin/audit");
  await expect(page.getByText("billing_invoice.paid").first()).toBeVisible();
  await expect(page.getByText("company.suspended").first()).toBeVisible();
});
