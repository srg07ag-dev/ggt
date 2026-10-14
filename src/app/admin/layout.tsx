import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SignOutButton } from "@/components/sign-out";
import { getSession } from "@/lib/session";

export const metadata = { title: { default: "Administration", template: "%s · Administration" }, robots: { index: false } };

/** Réservé aux opérateurs : droit de plateforme ET double authentification. Un utilisateur ordinaire reçoit un 404. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login?next=/admin");
  if (!session.user.isPlatformAdmin) notFound();
  if (!session.user.twoFactorEnabled) redirect("/account/security?need2fa=1");
  const nav = [["/admin", "Vue d'ensemble"], ["/admin/plans", "Offres"], ["/admin/companies", "Entreprises"], ["/admin/settings", "Réglages"], ["/admin/audit", "Journal"]] as const;
  return (
    <div className="min-h-dvh">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3 md:px-8">
        <div className="flex flex-wrap items-center gap-5">
          <span className="font-semibold tracking-tight">GGT · Administration</span>
          <nav aria-label="Administration" className="flex flex-wrap gap-1">
            {nav.map(([href, label]) => <Link key={href} href={href} className="rounded-full px-3 py-1.5 text-sm text-muted hover:bg-accent-soft hover:text-text">{label}</Link>)}
          </nav>
        </div>
        <span className="flex items-center gap-4 text-sm"><span className="text-muted">{session.user.email}</span><SignOutButton /></span>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8 md:px-8">{children}</main>
    </div>
  );
}
