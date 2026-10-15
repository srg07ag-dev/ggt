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
    <nav aria-label={label} className="flex flex-wrap gap-x-6 border-b border-border">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.active ? "page" : undefined}
          className={clsx(
            "-mb-px inline-flex h-10 items-center gap-1.5 border-b-2 text-sm transition-colors",
            t.active ? "border-text font-medium text-text" : "border-transparent text-muted hover:text-text",
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="num text-xs text-muted">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}
