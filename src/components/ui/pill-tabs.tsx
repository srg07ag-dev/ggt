import Link from "next/link";
import clsx from "clsx";

export interface PillTab {
  href: string;
  label: string;
  count?: number;
  active?: boolean;
}

/** Onglets en pilules (navigation interne d'une page ou filtres de liste). */
export function PillTabs({ tabs, label }: { tabs: PillTab[]; label: string }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-2">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.active ? "page" : undefined}
          className={clsx(
            "inline-flex h-9 items-center gap-2 rounded-full border px-4 text-sm transition-colors",
            t.active
              ? "border-accent bg-surface font-medium text-text"
              : "border-border text-muted hover:border-border-strong hover:text-text",
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span className="num inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-soft px-1.5 text-xs font-medium text-accent">
              {t.count}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}
