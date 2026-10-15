import clsx from "clsx";
import { Badge } from "./badge";

const TONES = {
  neutral: "bg-surface-2",
  danger: "bg-danger-soft",
  warning: "bg-warning-soft",
  success: "bg-success-soft",
} as const;

/**
 * Indicateur : conteneur tonal (sans bordure), légende, grand chiffre.
 * `value` est null tant que la donnée n'existe pas réellement : on affiche alors un tiret et `emptyHint`, jamais un faux chiffre.
 * `tone` ne sert qu'à signaler un état (retard, alerte), jamais à décorer.
 */
export function StatCard({
  label,
  value,
  delta,
  deltaTone = "neutral",
  compare,
  emptyHint,
  featured,
  tone = "neutral",
}: {
  label: string;
  value: string | null;
  delta?: string;
  deltaTone?: "success" | "danger" | "neutral";
  compare?: string;
  emptyHint?: string;
  featured?: boolean;
  tone?: keyof typeof TONES;
}) {
  return (
    <section className={clsx("flex flex-col gap-2 rounded-[var(--radius)] p-4", TONES[tone])}>
      <header className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-muted">{label}</p>
        {delta && <Badge tone={deltaTone}>{delta}</Badge>}
      </header>
      <p className={clsx("num font-normal", featured ? "text-2xl md:text-4xl" : "text-2xl md:text-3xl", value === null && "text-muted")}>{value ?? "—"}</p>
      {(compare || (value === null && emptyHint)) && <p className="text-xs text-muted">{value === null ? emptyHint : compare}</p>}
    </section>
  );
}
