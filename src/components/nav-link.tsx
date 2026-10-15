"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

/** Lien du menu latéral : l'entrée de la page courante est en gras sur fond gris. */
export function NavLink({ href, root, children }: { href: string; root?: boolean; children: React.ReactNode }) {
  const path = usePathname();
  const active = root ? path === href : path === href || path.startsWith(href + "/");
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "flex h-8 shrink-0 items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 text-[13px] transition-colors",
        active ? "bg-black/[0.07] font-semibold text-text dark:bg-white/[0.12]" : "text-text/80 hover:bg-black/[0.04] dark:hover:bg-white/[0.08]",
      )}
    >
      {children}
    </Link>
  );
}
