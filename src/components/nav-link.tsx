"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

/** Entrée du menu latéral : la page courante est un conteneur tonal bleu avec texte medium. */
export function NavLink({ href, root, children }: { href: string; root?: boolean; children: React.ReactNode }) {
  const path = usePathname();
  const active = root ? path === href : path === href || path.startsWith(href + "/");
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "flex h-9 shrink-0 items-center gap-3 rounded-[var(--radius)] px-3 text-sm transition-colors",
        active ? "bg-accent-soft font-medium text-on-accent-soft" : "text-text hover:bg-surface-2",
      )}
    >
      {children}
    </Link>
  );
}
