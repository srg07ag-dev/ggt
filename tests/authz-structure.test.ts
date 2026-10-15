import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou structurel : aucune nouvelle action serveur, route ou fonction métier ne doit pouvoir être ajoutée sans contrôle d'accès.
 * Ce test lit le code source ; il complète (sans les remplacer) les tests d'isolation exécutables.
 */
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const read = (p: string) => readFileSync(p, "utf8");
const rel = (p: string) => path.relative(process.cwd(), p);

/** Découpe un fichier en fonctions exportées `export async function nom(...) { … }` (jusqu'au prochain export). */
function exportedFunctions(src: string) {
  const parts = src.split(/^export (?:async )?function /m).slice(1);
  return parts.map((body) => ({ name: body.match(/^(\w+)/)![1]!, params: body.slice(body.indexOf("(") + 1, body.indexOf(")")), body }));
}

describe("contrôles d'accès : structure du code", () => {
  const files = walk("src");

  it("toute action serveur vérifie l'utilisateur connecté avant d'agir", () => {
    const offenders: string[] = [];
    for (const f of files.filter((f) => /actions\.tsx?$/.test(f))) {
      const src = read(f);
      if (!src.includes('"use server"')) continue;
      for (const fn of exportedFunctions(src)) {
        if (!/requireUser\(\)/.test(fn.body.slice(0, 600))) offenders.push(`${rel(f)}:${fn.name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("toute route HTTP vérifie la session ou une signature (liste blanche explicite)", () => {
    const allow = new Set(["src/app/api/auth/[...all]/route.ts", "src/app/api/health/route.ts"]);
    const offenders: string[] = [];
    for (const f of files.filter((f) => /route\.ts$/.test(f))) {
      if (allow.has(rel(f))) continue;
      const src = read(f);
      if (!/getSession\(|verifyWebhook\(/.test(src)) offenders.push(rel(f));
    }
    expect(offenders).toEqual([]);
  });

  it("toute page de l'application ou de l'administration exige une session", () => {
    const offenders: string[] = [];
    const pages = files.filter((f) => /\/app\/(app|admin|account)\/.*page\.tsx$/.test(f.replace(/\\/g, "/")) || /src\/app\/(app|admin|account)\/.*page\.tsx$/.test(f.replace(/\\/g, "/")));
    for (const f of pages) {
      const src = read(f);
      if (src.startsWith('"use client"')) continue;
      if (!/requireUser\(\)|getSession\(\)/.test(src)) offenders.push(rel(f));
    }
    // app/app/page.tsx redirige : il appelle requireUser. Les pages d'entreprise sont en plus protégées par la mise en page (membre requis).
    expect(offenders).toEqual([]);
  });

  it("les pages d'entreprise sont enveloppées par withAccess (un refus devient un 404, jamais une erreur 500)", () => {
    const offenders = files
      .filter((f) => /src\/app\/app\/\[companyId\]\/.*page\.tsx$/.test(f.replace(/\\/g, "/")))
      .filter((f) => !read(f).includes("withAccess("))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("toute fonction métier prenant un utilisateur contrôle son appartenance ou son droit", () => {
    // Fonctions volontairement ouvertes, avec la raison :
    const allow = new Set([
      "listCompaniesForUser", // liste uniquement les entreprises dont l'utilisateur est membre (filtre par userId)
      "createCompany", // tout utilisateur connecté peut créer son entreprise
      "acceptInvitation", // l'utilisateur n'est pas encore membre : la preuve est le jeton secret à usage unique + l'adresse e-mail invitée
    ]);
    const offenders: string[] = [];
    for (const f of files.filter((f) => /src\/modules\/.*\.ts$/.test(f.replace(/\\/g, "/")))) {
      for (const fn of exportedFunctions(read(f))) {
        const first = fn.params.split(",")[0]?.trim().split(":")[0]?.trim();
        if (first !== "userId" && first !== "adminId") continue;
        if (allow.has(fn.name)) continue;
        if (!/requireMembership\(|assertPlatformAdmin\(/.test(fn.body)) offenders.push(`${rel(f)}:${fn.name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("aucun HTML brut n'est injecté (pas de dangerouslySetInnerHTML) et aucun secret n'est codé en dur", () => {
    const bad: string[] = [];
    for (const f of files.filter((f) => /\.(tsx?|mjs)$/.test(f))) {
      const src = read(f);
      if (/dangerouslySetInnerHTML/.test(src)) bad.push(`${rel(f)}: dangerouslySetInnerHTML`);
      if (/(sk_live|sk_test|-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16})/.test(src)) bad.push(`${rel(f)}: secret apparent`);
    }
    expect(bad).toEqual([]);
  });

  it("le code client n'importe jamais de module serveur (base de données, stockage, e-mail)", () => {
    const bad: string[] = [];
    for (const f of files.filter((f) => /\.tsx?$/.test(f))) {
      // les imports de types sont effacés à la compilation : ils n'embarquent aucun code serveur
      const src = read(f).split("\n").filter((l) => !l.startsWith("import type")).join("\n");
      if (!src.startsWith('"use client"')) continue;
      if (/from "@\/(db|lib\/storage|lib\/mailer|lib\/session|lib\/auth")|from "@\/modules\/[a-z]+\/(?!modules)/.test(src.replace(/from "@\/modules\/core\/(modules|permissions)"/g, "").replace(/from "@\/modules\/sales\/calc"/g, ""))) bad.push(rel(f));
    }
    expect(bad).toEqual([]);
  });
});
