import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

const OUTBOX = path.resolve(".mail-outbox-e2e", "outbox.jsonl");

/** Dernier e-mail envoyé à `to` dont l'objet contient `subject` (le serveur de test écrit ses e-mails dans un fichier). */
export async function mailLink(to: string, subject: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    if (existsSync(OUTBOX)) {
      const mails = readFileSync(OUTBOX, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { to: string; subject: string; text: string });
      const m = mails.filter((x) => x.to === to && x.subject.includes(subject)).pop();
      if (m) return m.text.match(/https?:\/\/\S+/)![0];
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Aucun e-mail « ${subject} » pour ${to}`);
}

/** Inscription puis confirmation de l'adresse via le lien reçu (connexion automatique à la fin). */
export async function signupVerified(page: Page, name: string, email: string, startPath = "/signup", password = "motdepasse-solide-9") {
  // chaque utilisateur de test arrive d'une IP simulée distincte : les limites par IP (inscription, connexion) ne se gênent pas entre tests
  const ip = `198.18.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": ip });
  await page.goto(startPath);
  await page.getByLabel("Nom complet").fill(name);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page.getByText("Vérifiez votre boîte e-mail")).toBeVisible();
  await page.goto(await mailLink(email, "Confirmez"));
}

export async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

function base32(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of input.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** Code TOTP à 6 chiffres (RFC 6238, SHA-1, pas de 30 s) calculé à partir du secret de l'URI otpauth. */
export function totp(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const h = createHmac("sha1", base32(secret)).update(counter).digest();
  const o = h[h.length - 1]! & 0xf;
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 1_000_000).padStart(6, "0");
}
