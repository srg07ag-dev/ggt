"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

/** Entrée du menu bleu : la page courante est une pastille blanche au texte bleu. */
export function NavLink({ href, root, children }: { href: string; root?: boolean; children: React.ReactNode }) {
  const path = usePathname();
  const active = root ? path === href : path === href || path.startsWith(href + "/");
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "flex h-10 shrink-0 items-center gap-3 rounded-[var(--radius)] px-3 text-sm transition-colors",
        active ? "bg-surface font-semibold text-accent shadow-card" : "text-on-frame/90 hover:bg-white/10",
      )}
    >
      {children}
    </Link>
  );
}
