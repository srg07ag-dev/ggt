import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import { Badge } from "./badge";

const TONES = {
  accent: { card: "from-accent-soft", chip: "bg-accent text-white" },
  mint: { card: "from-mint-soft", chip: "bg-mint text-white" },
  amber: { card: "from-warning-soft", chip: "bg-warning text-white" },
  coral: { card: "from-danger-soft", chip: "bg-danger text-white" },
  sky: { card: "from-sky-soft", chip: "bg-sky text-white" },
} as const;

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
  tone = "accent",
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
    <section className={clsx("flex flex-col justify-between gap-6 rounded-[var(--radius-lg)] border border-border bg-gradient-to-br to-surface p-5 shadow-[var(--shadow-sm)]", TONES[tone].card)}>
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {Icon && <span className={clsx("grid size-9 place-items-center rounded-full", TONES[tone].chip)}><Icon className="size-[18px]" aria-hidden /></span>}
          <h2 className="text-sm font-medium text-text/80">{label}</h2>
        </div>
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
