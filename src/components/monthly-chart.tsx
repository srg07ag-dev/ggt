import { currencyExponent, formatMoney } from "@/lib/money";

export interface MonthPoint {
  month: string; // YYYY-MM
  invoicedMinor: number;
  receivedMinor: number;
}

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const label = (ym: string) => MONTHS[Number(ym.slice(5)) - 1]!;

/** Graduation « ronde » (1, 2, 5 × 10^n) au-dessus du maximum, pour des repères lisibles. */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

/**
 * Barres groupées : facturé (net d'avoirs) et encaissé, par mois. Rendu serveur en SVG, sans dépendance.
 * Les valeurs exactes sont dans une infobulle (title) et dans un tableau accessible ; les montants négatifs (avoirs > factures) sont ramenés à 0 dans le dessin seulement.
 */
export function MonthlyChart({ months, currency }: { months: MonthPoint[]; currency: string }) {
  const exp = currencyExponent(currency);
  const empty = months.every((m) => m.invoicedMinor === 0 && m.receivedMinor === 0);
  if (empty) {
    return <p className="glass rounded-[var(--radius-lg)] py-10 text-center text-sm text-muted">Le graphique apparaîtra après votre première facture émise ou votre premier paiement enregistré.</p>;
  }
  const W = 640, H = 240, L = 56, R = 8, T = 12, B = 28;
  const plotW = W - L - R, plotH = H - T - B;
  const max = niceMax(Math.max(1, ...months.flatMap((m) => [m.invoicedMinor, m.receivedMinor])));
  const y = (v: number) => T + plotH - (Math.max(0, v) / max) * plotH;
  const group = plotW / months.length;
  const bar = Math.min(22, group / 3);
  const tick = (v: number) => new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 }).format(v / 10 ** exp);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);

  return (
    <figure>
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-2"><span className="size-2.5 bg-accent" aria-hidden />Facturé (net d&apos;avoirs)</span>
        <span className="inline-flex items-center gap-2"><span className="size-2.5 bg-success" aria-hidden />Encaissé</span>
      </div>
      {/* dir="rtl" : sur petit écran, le défilement démarre à droite, donc sur les mois les plus récents */}
      <div className="overflow-x-auto" dir="rtl">
      <svg style={{ direction: "ltr" }} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Facturé et encaissé par mois sur les six derniers mois" className="h-auto w-full min-w-[480px]">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={t === 0 ? 1.5 : 0.75} />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--text-muted)">{tick(t)}</text>
          </g>
        ))}
        {months.map((m, i) => {
          const cx = L + group * i + group / 2;
          return (
            <g key={m.month}>
              <rect x={cx - bar - 1} y={y(m.invoicedMinor)} width={bar} height={Math.max(0, plotH - (y(m.invoicedMinor) - T))} fill="var(--accent)" rx="2">
                <title>{`${label(m.month)} · facturé ${formatMoney(m.invoicedMinor, currency)}`}</title>
              </rect>
              <rect x={cx + 1} y={y(m.receivedMinor)} width={bar} height={Math.max(0, plotH - (y(m.receivedMinor) - T))} fill="var(--success)" rx="2">
                <title>{`${label(m.month)} · encaissé ${formatMoney(m.receivedMinor, currency)}`}</title>
              </rect>
              <text x={cx} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--text-muted)">{label(m.month)}</text>
            </g>
          );
        })}
      </svg>
      </div>
      <table className="sr-only">
        <caption>Facturé et encaissé par mois</caption>
        <thead><tr><th>Mois</th><th>Facturé (net d&apos;avoirs)</th><th>Encaissé</th></tr></thead>
        <tbody>
          {months.map((m) => (
            <tr key={m.month}><td>{m.month}</td><td>{formatMoney(m.invoicedMinor, currency)}</td><td>{formatMoney(m.receivedMinor, currency)}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
