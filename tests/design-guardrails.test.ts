import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Garde-fous du système visuel : Material Design 3 à la Google, sobre et net (voir src/app/globals.css).
 * Ils empêchent le retour du style « SaaS générique » : dégradés, ombres, violets/indigos par défaut,
 * palettes Tailwind nommées, coins très arrondis.
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

function offenders(re: RegExp, allow: (f: string) => boolean = () => false) {
  return files.filter((f) => !allow(f) && re.test(read(f)));
}

describe("design : pas de style générique", () => {
  it("aucun dégradé ni ombre portée", () => {
    expect(offenders(/bg-gradient|\bfrom-[a-z]|\bvia-[a-z]|\bto-[a-z]|\bshadow(-[a-z0-9\[]+)?\b|linear-gradient|box-shadow/)).toEqual([]);
  });
  it("aucune palette Tailwind nommée ni teinte violette/indigo", () => {
    expect(offenders(/\b(bg|text|border|ring|from|to)-(red|blue|green|amber|slate|gray|zinc|neutral|stone|orange|yellow|lime|emerald|teal|cyan|sky|pink|rose|violet|indigo|purple|fuchsia)-\d/)).toEqual([]);
    expect(offenders(/violet|indigo|purple|fuchsia/i)).toEqual([]);
  });
  it("jetons de couleur : aucune teinte violette (hue 250°–320°) dans globals.css", () => {
    const css = read("src/app/globals.css");
    for (const [, hex] of css.matchAll(/#([0-9a-f]{6})\b/gi)) {
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex!.slice(i, i + 2), 16) / 255);
      const max = Math.max(r!, g!, b!), min = Math.min(r!, g!, b!), d = max - min;
      if (d < 0.08) continue; // gris
      let h = max === r ? ((g! - b!) / d) % 6 : max === g ? (b! - r!) / d + 2 : (r! - g!) / d + 4;
      h = (h * 60 + 360) % 360;
      const accentBlue = h >= 200 && h <= 225; // bleu système, autorisé
      expect(h >= 250 && h <= 320 && !accentBlue, `#${hex} a une teinte violette (${Math.round(h)}°)`).toBe(false);
    }
  });
  it("coins courts : pas de rayon xl+ ni de pilules (hors formes fonctionnelles listées)", () => {
    expect(offenders(/rounded-(xl|2xl|3xl)/)).toEqual([]);
    const allowed = ["activity-list.tsx", "billing/page.tsx"]; // case à cocher ronde, barre de progression
    expect(offenders(/rounded-full/, (f) => allowed.some((a) => f.replaceAll("\\", "/").endsWith(a)))).toEqual([]);
  });
  it("système de jetons : rayons ≤ 8 px", () => {
    const css = read("src/app/globals.css");
    for (const [, px] of css.matchAll(/--radius[a-z-]*:\s*(\d+)px/g)) expect(Number(px)).toBeLessThanOrEqual(8);
  });
});
