/** Division entière arrondie « half-up » (valeurs positives), en BigInt pour éviter toute perte de précision. */
function roundDiv(a: bigint, b: bigint): number {
  return Number((a * 2n + b) / (b * 2n));
}

export interface LineInput {
  quantityMilli: number;
  unitPriceMinor: number;
  taxRateBp: number;
}

/**
 * Règle d'arrondi (v1, par ligne) : net = quantité × prix, arrondi à l'unité mineure ;
 * taxe = net × taux, arrondie à l'unité mineure. Les totaux sont la somme des lignes.
 * Cette règle devra pouvoir être remplacée par pays (arrondi sur le total, etc.).
 */
export function computeLine({ quantityMilli, unitPriceMinor, taxRateBp }: LineInput) {
  const net = roundDiv(BigInt(quantityMilli) * BigInt(unitPriceMinor), 1000n);
  const tax = roundDiv(BigInt(net) * BigInt(taxRateBp), 10000n);
  return { netMinor: net, taxMinor: tax };
}

export function computeTotals(lines: { netMinor: number; taxMinor: number }[]) {
  const subtotalMinor = lines.reduce((n, l) => n + l.netMinor, 0);
  const taxMinor = lines.reduce((n, l) => n + l.taxMinor, 0);
  return { subtotalMinor, taxMinor, totalMinor: subtotalMinor + taxMinor };
}

/** « 2,5 » → 2500 (jusqu'à 3 décimales). */
export function parseQuantity(input: string): number | null {
  const c = input.replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,3})?$/.test(c)) return null;
  const n = Math.round(Number(c) * 1000);
  return n > 0 && Number.isSafeInteger(n) && n <= 2_000_000_000 ? n : null;
}

/** « 18 » ou « 18,5 » → points de base (1800, 1850). */
export function parseRatePercent(input: string): number | null {
  const c = input.replace(/\s/g, "").replace(",", ".").replace("%", "");
  if (!/^\d+(\.\d{1,2})?$/.test(c)) return null;
  const bp = Math.round(Number(c) * 100);
  return bp >= 0 && bp <= 10000 ? bp : null; // 0 à 100 %
}

export function formatRate(bp: number): string {
  return `${(bp / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;
}
