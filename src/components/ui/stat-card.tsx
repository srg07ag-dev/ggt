import clsx from "clsx";
import { Badge } from "./badge";

/**
 * Carte d'indicateur. `value` est null tant que la donnée n'existe pas réellement :
 * on affiche alors un tiret et `emptyHint`, jamais un faux chiffre.
 */
export function StatCard({
  label,
  value,
  delta,
  deltaTone = "neutral",
  compare,
  emptyHint,
  featured,
}: {
  label: string;
  value: string | null;
  delta?: string;
  deltaTone?: "success" | "danger" | "neutral";
  compare?: string;
  emptyHint?: string;
  featured?: boolean;
}) {
  return (
    <section className="flex flex-col justify-between gap-6 rounded-[var(--radius-lg)] border border-border bg-surface p-5">
      <header className="flex items-start justify-between gap-3">
        <h2 className="text-sm text-muted">{label}</h2>
        {delta && <Badge tone={deltaTone}>{delta}</Badge>}
      </header>
      <div className="flex items-end justify-between gap-3">
        <p className={clsx("num font-semibold tracking-tight", featured ? "text-4xl" : "text-3xl", value === null && "text-muted")}>
          {value ?? "—"}
        </p>
        {(compare || (value === null && emptyHint)) && (
          <p className="text-right text-xs text-muted">{value === null ? emptyHint : compare}</p>
        )}
      </div>
    </section>
  );
}
