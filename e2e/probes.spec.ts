import { expect, test } from "@playwright/test";
import { mailLink } from "./helpers";

/** Sondes d'attaque contre le serveur réel (sans navigateur). Chaque test décrit la menace visée. */
const ip = () => `100.64.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
const ORIGIN = "http://localhost:3100";

test.describe("authentification", () => {
  test("pas d'énumération de comptes à l'inscription ni à la connexion", async ({ request }) => {
    const email = `probe-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.dev`;
    const headers = { "x-forwarded-for": ip(), origin: ORIGIN };
    const signup = (e: string) => request.post("/api/auth/sign-up/email", { headers, data: { email: e, password: "motdepasse-solide-9", name: "Probe" } });
    const first = await signup(email);
    const again = await signup(email); // même adresse : la réponse ne doit pas révéler qu'elle existe déjà
    const a = { status: first.status(), keys: Object.keys(await first.json()).sort() };
    const b = { status: again.status(), keys: Object.keys(await again.json()).sort() };
    expect(b, "l'inscription d'une adresse existante doit ressembler à une inscription neuve").toEqual(a);

    // connexion : adresse inconnue et mauvais mot de passe donnent la même réponse
    const h2 = { "x-forwarded-for": ip(), origin: ORIGIN };
    const unknown = await request.post("/api/auth/sign-in/email", { headers: h2, data: { email: `inconnu-${Date.now()}@test.dev`, password: "mauvais-mot-de-passe" } });
    const wrong = await request.post("/api/auth/sign-in/email", { headers: h2, data: { email, password: "mauvais-mot-de-passe" } });
    const ub = await unknown.json();
    const wb = await wrong.json();
    expect([unknown.status(), ub.code, ub.message]).toEqual([wrong.status(), wb.code, wb.message]);
  });

  test("une requête d'une autre origine est refusée (CSRF)", async ({ request }) => {
    const r = await request.post("/api/auth/sign-in/email", { headers: { "x-forwarded-for": ip(), origin: "https://evil.example" }, data: { email: "a@b.dev", password: "x".repeat(12) } });
    expect(r.status()).toBeGreaterThanOrEqual(400);
    expect(r.status()).toBeLessThan(500);
    expect((await r.json()).code).toBe("INVALID_ORIGIN");
  });

  test("le cookie de session est HttpOnly et SameSite", async ({ request }) => {
    const email = `cookie-${Date.now()}@test.dev`;
    const headers = { "x-forwarded-for": ip(), origin: ORIGIN };
    await request.post("/api/auth/sign-up/email", { headers, data: { email, password: "motdepasse-solide-9", name: "Cookie" } });
    const link = await mailLink(email, "Confirmez");
    const res = await request.get(link, { headers, maxRedirects: 0 });
    const set = res.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie").map((h) => h.value);
    const session = set.find((c) => /session_token/.test(c));
    expect(session, "un cookie de session doit être posé à la vérification").toBeDefined();
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=Lax/i);
  });
});

test.describe("accès non authentifié", () => {
  test("les pages protégées redirigent vers la connexion, les routes de données répondent 401", async ({ request }) => {
    const fake = "00000000-0000-0000-0000-000000000000";
    for (const path of ["/app", `/app/${fake}`, `/app/${fake}/contacts`, "/admin", "/admin/plans", "/account/security"]) {
      const r = await request.get(path, { maxRedirects: 0 });
      expect([302, 303, 307, 308], `${path} doit rediriger`).toContain(r.status());
      expect(r.headers()["location"] ?? "").toMatch(/\/login/);
    }
    for (const path of [`/app/${fake}/exports/invoices`, `/app/${fake}/exports/ledger`, `/app/${fake}/documents/${fake}/pdf`, `/app/${fake}/attachments/${fake}`]) {
      expect((await request.get(path)).status(), path).toBe(401);
    }
  });

  test("redirection ouverte impossible après connexion", async ({ page }) => {
    await page.goto("/login?next=https://evil.example/phish");
    await expect(page.getByRole("link", { name: "Créer un compte" })).toHaveAttribute("href", "/signup"); // le « next » externe est ignoré
  });
});

test.describe("webhook et en-têtes", () => {
  test("le webhook refuse un prestataire non configuré ou un nom piégé", async ({ request }) => {
    expect((await request.post("/api/billing/webhook/inconnu", { data: "{}" })).status()).toBe(404);
    expect((await request.post("/api/billing/webhook/../../etc", { data: "{}" })).status()).toBe(404);
  });

  test("en-têtes de sécurité présents, aucune information technique divulguée", async ({ request }) => {
    const r = await request.get("/login");
    const h = r.headers();
    expect(h["x-powered-by"]).toBeUndefined();
    expect(h["server"] ?? "").not.toMatch(/\d+\.\d+/);
    expect(h["content-security-policy"]).toMatch(/default-src 'self'/);
    expect(h["content-security-policy"]).toMatch(/frame-ancestors 'none'/);
    expect(h["content-security-policy"]).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBeDefined();
    expect(h["permissions-policy"]).toMatch(/camera=\(\)/);
  });

  test("la sonde de santé ne divulgue rien et les routes inconnues répondent 404 sans trace", async ({ request }) => {
    const h = await request.get("/api/health");
    expect(await h.json()).toEqual({ status: "ok" });
    const nf = await request.get("/cette-page-n-existe-pas");
    expect(nf.status()).toBe(404);
    expect(await nf.text()).not.toMatch(/at \w+ \(|node_modules|\.tsx?:\d+/);
  });
});
