import { describe, expect, it } from "vitest";
import { computeLine, computeTotals, parseQuantity, parseRatePercent } from "@/modules/sales/calc";
import { formatNumber, validatePattern } from "@/modules/sales/numbering";

describe("calcul des lignes", () => {
  it("arrondit net et taxe à l'unité mineure", () => {
    // 2,5 × 33,33 € = 83,325 → 83,33 ; 18 % de 83,33 = 14,9994 → 15,00
    expect(computeLine({ quantityMilli: 2500, unitPriceMinor: 3333, taxRateBp: 1800 })).toEqual({ netMinor: 8333, taxMinor: 1500 });
    expect(computeLine({ quantityMilli: 1000, unitPriceMinor: 1000, taxRateBp: 0 })).toEqual({ netMinor: 1000, taxMinor: 0 });
  });
  it("reste exact sur de très gros montants", () => {
    const r = computeLine({ quantityMilli: 1_000_000, unitPriceMinor: 9_000_000_000_000, taxRateBp: 1000 });
    expect(r.netMinor).toBe(9_000_000_000_000_000);
  });
  it("somme les lignes", () => {
    expect(computeTotals([{ netMinor: 100, taxMinor: 18 }, { netMinor: 50, taxMinor: 9 }])).toEqual({ subtotalMinor: 150, taxMinor: 27, totalMinor: 177 });
  });
  it("lit quantités et taux", () => {
    expect(parseQuantity("2,5")).toBe(2500);
    expect(parseQuantity("0")).toBeNull();
    expect(parseQuantity("1,2345")).toBeNull();
    expect(parseRatePercent("18")).toBe(1800);
    expect(parseRatePercent("5,5 %")).toBe(550);
    expect(parseRatePercent("101")).toBeNull();
  });
});

describe("numérotation", () => {
  it("formate et valide les motifs", () => {
    expect(formatNumber("FA-{YYYY}-{NNNN}", 2026, 7)).toBe("FA-2026-0007");
    expect(formatNumber("{NNNNNN}", 2026, 12)).toBe("000012");
    expect(validatePattern("FA-{YYYY}-{NNNN}")).toBeNull();
    expect(validatePattern("FA-{YYYY}")).not.toBeNull();
    expect(validatePattern("{NNNN}{NN}")).not.toBeNull();
    expect(validatePattern("{NNNN};drop")).not.toBeNull();
  });
});
