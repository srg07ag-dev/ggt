import Link from "next/link";
import { notFound } from "next/navigation";
import { BarChart3, ScrollText, UserCog, CheckSquare, FilePlus2, FileText, HandCoins, Kanban, Landmark, LayoutDashboard, Package, Plus, Receipt, Settings, Truck, Users } from "lucide-react";
import { can, ROLE_LABELS } from "@/modules/core/permissions";
import { SignOutButton } from "@/components/sign-out";
import { requireUser } from "@/lib/session";
import { listCompaniesForUser } from "@/modules/core/companies";
import { ForbiddenError, requireMembership } from "@/modules/core/tenant";

export default async function CompanyLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const user = await requireUser();
  let membership: Awaited<ReturnType<typeof requireMembership>>;
  try {
    membership = await requireMembership(user.id, companyId);
  } catch (e) {
    if (e instanceof ForbiddenError) notFound();
    throw e;
  }
  const companies = await listCompaniesForUser(user.id);
  const current = companies.find((c) => c.id === companyId);

  const b = `/app/${companyId}`;
  const finance = can(membership.role, "finance:read");
  const groups: { title?: string; items: { href: string; label: string; icon: typeof Users }[] }[] = [
    { items: [{ href: b, label: "Vue d'ensemble", icon: LayoutDashboard }] },
    {
      title: "CRM",
      items: [
        { href: `${b}/contacts`, label: "Contacts", icon: Users },
        { href: `${b}/pipeline`, label: "Pipeline", icon: Kanban },
        { href: `${b}/tasks`, label: "Tâches", icon: CheckSquare },
      ],
    },
    {
      title: "Ventes",
      items: [
        { href: `${b}/quotes`, label: "Devis", icon: FilePlus2 },
        { href: `${b}/invoices`, label: "Factures", icon: FileText },
        { href: `${b}/catalog`, label: "Catalogue", icon: Package },
      ],
    },
    ...(finance
      ? [
          {
            title: "Finances",
            items: [
              { href: `${b}/income`, label: "Recettes", icon: HandCoins },
              { href: `${b}/expenses`, label: "Dépenses", icon: Receipt },
              { href: `${b}/treasury`, label: "Trésorerie", icon: Landmark },
              { href: `${b}/suppliers`, label: "Fournisseurs", icon: Truck },
              { href: `${b}/reports`, label: "Rapports", icon: BarChart3 },
            ],
          },
        ]
      : []),
    { title: "Organisation", items: [{ href: `${b}/members`, label: "Membres", icon: UserCog }, ...(can(membership.role, "audit:read") ? [{ href: `${b}/audit`, label: "Journal d'audit", icon: ScrollText }] : []), { href: `${b}/settings`, label: "Paramètres", icon: Settings }] },
  ];

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[248px_1fr]">
      <aside className="border-b border-border bg-surface p-4 md:border-b-0 md:border-r">
        <div className="mb-6 px-2 text-base font-semibold tracking-tight">GGT</div>
        <nav aria-label="Navigation principale" className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
          {groups.map((g, i) => (
            <div key={i} className="flex gap-1 md:flex-col">
              {g.title && <p className="hidden px-3 pb-1 pt-4 text-xs font-medium uppercase tracking-wide text-muted md:block">{g.title}</p>}
              {g.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex h-9 shrink-0 items-center gap-2.5 rounded-full px-3 text-sm text-muted hover:bg-accent-soft hover:text-text"
                >
                  <item.icon className="size-4" aria-hidden />
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="mt-6 hidden md:block">
          <p className="px-2.5 pb-2 text-xs font-medium uppercase tracking-wide text-muted">Entreprises</p>
          {companies.map((c) => (
            <Link
              key={c.id}
              href={`/app/${c.id}`}
              aria-current={c.id === companyId ? "page" : undefined}
              className="block truncate rounded-[var(--radius-sm)] px-2.5 py-1.5 text-sm hover:bg-surface-2 aria-[current=page]:bg-accent-soft aria-[current=page]:text-accent"
            >
              {c.name}
            </Link>
          ))}
          <Link href="/onboarding" className="mt-1 flex items-center gap-2 px-2.5 py-1.5 text-sm text-muted hover:text-text">
            <Plus className="size-4" aria-hidden /> Nouvelle entreprise
          </Link>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="flex h-14 items-center justify-between border-b border-border px-4 md:px-8">
          <span className="text-sm text-muted">{current?.name}</span>
          <span className="flex items-center gap-4 text-sm"><span>{user.name} <span className="text-xs text-muted">· {ROLE_LABELS[membership.role]}</span></span><Link href="/account/security" className="text-muted hover:text-text">Sécurité</Link><SignOutButton /></span>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8 md:px-8">{children}</main>
      </div>
    </div>
  );
}
