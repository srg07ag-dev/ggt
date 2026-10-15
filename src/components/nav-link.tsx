"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

/** Lien du menu latéral : l'entrée de la page courante est mise en évidence (la plus spécifique l'emporte). */
export function NavLink({ href, root, children }: { href: string; root?: boolean; children: React.ReactNode }) {
  const path = usePathname();
  const active = root ? path === href : path === href || path.startsWith(href + "/");
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "flex h-9 shrink-0 items-center gap-2.5 rounded-full px-3 text-sm transition-colors",
        active ? "bg-white/15 font-medium text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12)]" : "text-white/70 hover:bg-white/10 hover:text-white",
      )}
    >
      {children}
    </Link>
  );
}
