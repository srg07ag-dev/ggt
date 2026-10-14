/** Nombre de décimales de la devise (XOF = 0, EUR = 2, KWD = 3…), d'après ISO 4217 via Intl. */
export function currencyExponent(currency: string): number {
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

/** Convertit une saisie « 1 250,50 » en unités mineures entières. Retourne null si invalide. */
export function toMinor(input: string, currency: string): number | null {
  const exp = currencyExponent(currency);
  const cleaned = input.replace(/[\s  ]/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const [int = "0", frac = ""] = cleaned.split(".");
  if (frac.length > exp) return null;
  const minor = Number(int + frac.padEnd(exp, "0"));
  return Number.isSafeInteger(minor) ? minor : null;
}

export function formatMoney(minor: number, currency: string, locale = "fr-FR"): string {
  const exp = currencyExponent(currency);
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 10 ** exp);
}

/** Montant prêt à être pré-rempli dans un champ de saisie : 120,00 (sans symbole ni séparateur de milliers). */
export function formatPlain(minor: number, currency: string): string {
  const exp = currencyExponent(currency);
  return (minor / 10 ** exp).toFixed(exp).replace(".", ",");
}
