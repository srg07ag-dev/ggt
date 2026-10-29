import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Garde-fous du système visuel (bleu intense, feuille arrondie, cartes à ombre douce ; voir src/app/globals.css).
 * Ils garantissent la lisibilité (contrastes WCAG AA), la cohérence (tout passe par les jetons) et l'absence de
 * teintes violettes ou de palettes Tailwind par défaut.
 */
function walk(dir: string, out: string[] = []) {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx|ts|css)$/.test(f)) out.push(p);
  }
  return out;
}
const files = walk("src").filter((f) => !f.startsWith(path.join("src", "db")));
const read = (f: string) => readFileSync(f, "utf8");
const offenders = (re: RegExp) => files.filter((f) => re.test(read(f)));
const css = read("src/app/globals.css");

/** Jetons d'un bloc CSS (clair : :root ; sombre : le bloc prefers-color-scheme: dark). */
function tokens(block: string) {
  return Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1]!, m[2]!]));
}
const lightBlock = css.slice(css.indexOf(":root {"), css.indexOf("@media (prefers-color-scheme: dark)"));
const darkBlock = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"), css.indexOf("@theme inline"));
const light = tokens(lightBlock);
const dark = { ...light, ...tokens(darkBlock) };

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

describe("design : contrastes AA (4,5:1) sur les jetons, clair et sombre", () => {
  const pairs: [string, string][] = [
    ["text", "surface"], ["text", "surface-2"], ["text", "bg"],
    ["text-muted", "surface"], ["text-muted", "surface-2"], ["text-muted", "bg"],
    ["on-accent", "accent"], ["on-accent-soft", "accent-soft"], ["accent", "surface"], ["accent", "surface-2"],
    ["text-muted", "accent-soft"],
    ["success", "success-soft"], ["warning", "warning-soft"], ["danger", "danger-soft"],
    ["on-frame", "frame"], ["on-frame", "frame-2"],
  ];
  for (const [name, set] of [["clair", light], ["sombre", dark]] as const) {
    it(`thème ${name}`, () => {
      for (const [fg, bg] of pairs) {
        expect(set[fg] && set[bg], `jeton manquant : ${fg} ou ${bg}`).toBeTruthy();
        expect(contrast(set[fg]!, set[bg]!), `${fg} sur ${bg} (${set[fg]} / ${set[bg]})`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
  it("texte blanc à 85 % sur le bleu du cadre reste lisible (≥ 4,5:1)", () => {
    for (const set of [light, dark]) {
      for (const base of [set["frame"]!, set["frame-2"]!]) {
        const mix = [1, 3, 5].map((i) => Math.round(255 * 0.85 + parseInt(base.slice(i, i + 2), 16) * 0.15).toString(16).padStart(2, "0")).join("");
        expect(contrast(`#${mix}`, base)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe("design : cohérence", () => {
  it("aucune palette Tailwind nommée ni teinte violette dans le code", () => {
    expect(offenders(/\b(bg|text|border|ring|from|to|via)-(red|blue|green|amber|slate|gray|zinc|neutral|stone|orange|yellow|lime|emerald|teal|cyan|sky|pink|rose|violet|indigo|purple|fuchsia)-\d/)).toEqual([]);
    // (le commentaire de globals.css cite ces mots pour expliquer la règle : on l'écarte)
    expect(files.filter((f) => !f.endsWith("globals.css") && /violet|indigo|purple|fuchsia/i.test(read(f)))).toEqual([]);
  });
  it("aucune teinte violette (250°–320°) dans les jetons de couleur", () => {
    for (const hex of [...Object.values(light), ...Object.values(dark)]) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
      const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
      if (d < 0.08) continue; // quasi gris
      let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
      expect(h >= 250 && h <= 320, `${hex} a une teinte violette (${Math.round(h)}°)`).toBe(false);
    }
  });
  it("les ombres passent par les jetons (shadow-card, shadow-pop), jamais en valeur libre", () => {
    expect(offenders(/shadow-\[|shadow-(sm|md|lg|xl|2xl)\b|box-shadow/)).toEqual([]);
  });
  it("les couleurs passent par les jetons : pas de code hexadécimal dans les composants", () => {
    const allowed = ["globals.css", "pdf.ts"]; // le PDF n'est pas du CSS : il porte ses propres couleurs
    const bad = files.filter((f) => !allowed.some((a) => f.endsWith(a)) && /["'`]#[0-9a-f]{3,8}["'`]/i.test(read(f)));
    expect(bad).toEqual([]);
  });
});
