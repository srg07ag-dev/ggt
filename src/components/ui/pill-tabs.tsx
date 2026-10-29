import Link from "next/link";
import clsx from "clsx";

export interface PillTab {
  href: string;
  label: string;
  count?: number;
  active?: boolean;
}

/** Onglets soulignés (navigation interne d'une page ou filtres de liste). */
export function PillTabs({ tabs, label }: { tabs: PillTab[]; label: string }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-2">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.active ? "page" : undefined}
          className={clsx(
            "inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm transition-colors",
            t.active ? "bg-accent font-semibold text-on-accent shadow-card" : "bg-surface text-muted hover:text-text",
          )}
        >
          {t.label}
          {t.count !== undefined && <span className={clsx("num text-xs", t.active ? "text-on-accent/80" : "text-muted")}>{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}
