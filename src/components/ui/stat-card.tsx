import clsx from "clsx";
import { Badge } from "./badge";

/**
 * Indicateur : un filet, une légende, un grand chiffre. Pas de boîte.
 * `value` est null tant que la donnée n'existe pas réellement : on affiche alors un tiret et `emptyHint`, jamais un faux chiffre.
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
    <section className="flex flex-col gap-2 border-t border-border-strong pt-3">
      <header className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-muted">{label}</p>
        {delta && <Badge tone={deltaTone}>{delta}</Badge>}
      </header>
      <p className={clsx("num font-semibold tracking-tight", featured ? "text-4xl" : "text-3xl", value === null && "text-muted")}>
        {value ?? "—"}
      </p>
      {(compare || (value === null && emptyHint)) && <p className="text-xs text-muted">{value === null ? emptyHint : compare}</p>}
    </section>
  );
}
