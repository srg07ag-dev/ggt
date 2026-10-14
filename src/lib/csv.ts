export type Cell = string | number | null | undefined;

/**
 * CSV pour tableur français : séparateur « ; », BOM UTF-8, décimale « , ».
 * Les textes commençant par = + - @ sont neutralisés (injection de formule dans Excel/Sheets) ;
 * les nombres, eux, restent des nombres.
 */
export function toCsv(headers: string[], rows: Cell[][]): string {
  const cell = (v: Cell): string => {
    if (v === null || v === undefined) return "";
    if (typeof v === "number") return String(v).replace(".", ",");
    const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [headers, ...rows].map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
}
