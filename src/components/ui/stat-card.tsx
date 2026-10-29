import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import { Badge } from "./badge";

const TONES = {
  neutral: { card: "bg-surface", chip: "bg-accent-soft text-accent" },
  danger: { card: "bg-danger-soft", chip: "bg-danger text-white" },
  warning: { card: "bg-warning-soft", chip: "bg-warning text-white" },
  success: { card: "bg-success-soft", chip: "bg-success text-white" },
} as const;

/**
 * Indicateur : carte blanche, pastille d'icône, légende, grand chiffre.
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
  icon: Icon,
}: {
  label: string;
  value: string | null;
  delta?: string;
  deltaTone?: "success" | "danger" | "neutral";
  compare?: string;
  emptyHint?: string;
  featured?: boolean;
  tone?: keyof typeof TONES;
  icon?: LucideIcon;
}) {
  return (
    <section className={clsx("flex flex-col gap-3 rounded-[var(--radius-lg)] p-5 shadow-card", TONES[tone].card)}>
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {Icon && (
            <span className={clsx("grid size-9 place-items-center rounded-full", TONES[tone].chip)}>
              <Icon className="size-[18px]" aria-hidden />
            </span>
          )}
          <p className="text-xs font-semibold text-muted">{label}</p>
        </div>
        {delta && <Badge tone={deltaTone}>{delta}</Badge>}
      </header>
      <p className={clsx("num font-bold tracking-tight", featured ? "text-2xl md:text-4xl" : "text-2xl md:text-3xl", value === null && "text-muted")}>{value ?? "—"}</p>
      {(compare || (value === null && emptyHint)) && <p className="text-xs text-muted">{value === null ? emptyHint : compare}</p>}
    </section>
  );
}
