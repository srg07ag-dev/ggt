import Link from "next/link";
import { notFound } from "next/navigation";
import { CreditCard, BarChart3, BookOpen, Calculator, FileSpreadsheet, Landmark as Bank, Scale, ScrollText, Settings2, CalendarClock, Layers, UserCog, CheckSquare, FilePlus2, FileText, HandCoins, Kanban, Landmark, LayoutDashboard, Package, Plus, Receipt, Settings, Truck, Users } from "lucide-react";
import { can, ROLE_LABELS } from "@/modules/core/permissions";
import { loadAccess, type Module } from "@/modules/core/entitlements";
import { SignOutButton } from "@/components/sign-out";
import { NavLink } from "@/components/nav-link";
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
  const [companies, access] = await Promise.all([listCompaniesForUser(user.id), loadAccess(companyId)]);
  const has = (m: Module) => access.state === "unmanaged" || access.modules.includes(m);
  const current = companies.find((c) => c.id === companyId);

  const b = `/app/${companyId}`;
  const finance = can(membership.role, "finance:read") && has("finance");
  const accounting = can(membership.role, "accounting:read") && has("accounting");
  const taxes = can(membership.role, "tax:read") && has("tax");
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
    ...(accounting
      ? [
          {
            title: "Comptabilité",
            items: [
              { href: `${b}/accounting`, label: "Vue d'ensemble", icon: Calculator },
              { href: `${b}/accounting/entries`, label: "Écritures", icon: FileSpreadsheet },
              { href: `${b}/accounting/accounts`, label: "Plan de comptes", icon: BookOpen },
              { href: `${b}/accounting/ledger`, label: "Grand livre", icon: Layers },
              { href: `${b}/accounting/balance`, label: "Balance", icon: Scale },
              { href: `${b}/accounting/periods`, label: "Périodes", icon: CalendarClock },
              { href: `${b}/accounting/settings`, label: "Correspondances", icon: Settings2 },
            ],
          },
        ]
      : []),
    ...(taxes ? [{ title: "Fiscalité", items: [{ href: `${b}/tax`, label: "Obligations et suivi", icon: Bank }] }] : []),
    { title: "Organisation", items: [...(can(membership.role, "company:manage") ? [{ href: `${b}/billing`, label: "Abonnement", icon: CreditCard }] : []), { href: `${b}/members`, label: "Membres", icon: UserCog }, ...(can(membership.role, "audit:read") ? [{ href: `${b}/audit`, label: "Journal d'audit", icon: ScrollText }] : []), { href: `${b}/settings`, label: "Paramètres", icon: Settings }] },
  ];

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[248px_1fr]">
      <aside className="border-b border-border bg-surface-2 p-3 md:sticky md:top-0 md:h-dvh md:overflow-y-auto md:border-b-0 md:border-r">
        <div className="mb-4 px-2.5 text-[15px] font-semibold tracking-tight">GGT</div>
        <nav aria-label="Navigation principale" className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
          {groups.map((g, i) => (
            <div key={i} className="flex shrink-0 gap-1 md:flex-col">
              {g.title && <p className="hidden px-2.5 pb-1 pt-5 text-[11px] font-semibold text-muted md:block">{g.title}</p>}
              {g.items.map((item) => (
                <NavLink key={item.href} href={item.href} root={item.href === b}>
                  <item.icon className="size-4 text-muted" strokeWidth={1.75} aria-hidden />
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="mt-6 hidden md:block">
          <p className="px-2.5 pb-1 text-[11px] font-semibold text-muted">Entreprises</p>
          {companies.map((c) => (
            <Link
              key={c.id}
              href={`/app/${c.id}`}
              aria-current={c.id === companyId ? "page" : undefined}
              className="block truncate rounded-[var(--radius-sm)] px-2.5 py-1.5 text-[13px] text-text/80 hover:bg-black/[0.04] aria-[current=page]:bg-black/[0.07] aria-[current=page]:font-semibold aria-[current=page]:text-text dark:hover:bg-white/[0.08] dark:aria-[current=page]:bg-white/[0.12]"
            >
              {c.name}
            </Link>
          ))}
          <Link href="/onboarding" className="mt-1 flex items-center gap-2 px-2.5 py-1.5 text-[13px] text-muted hover:text-text">
            <Plus className="size-4" aria-hidden /> Nouvelle entreprise
          </Link>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="flex h-12 items-center justify-between border-b border-border px-4 md:px-8">
          <span className="text-sm text-muted">{current?.name}</span>
          <span className="flex items-center gap-4 text-sm"><span className="hidden sm:inline">{user.name} <span className="text-xs text-muted">· {ROLE_LABELS[membership.role]}</span></span><span className="sm:hidden text-xs text-muted">{ROLE_LABELS[membership.role]}</span><Link href="/account/security" className="text-muted hover:text-text">Sécurité</Link><SignOutButton /></span>
        </header>
        {(access.readOnly || access.warn) && (
          <div role="status" className={`px-4 py-2.5 text-center text-sm md:px-8 ${access.readOnly ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning"}`}>
            {access.state === "suspended" && "Ce compte est suspendu : l'entreprise est en lecture seule."}
            {access.state === "expired" && "Votre abonnement a expiré : l'entreprise est en lecture seule (données consultables et exportables)."}
            {access.warn === "trial_ending" && "Votre période d'essai se termine bientôt."}
            {access.warn === "grace" && "Paiement en retard : l'accès sera limité à la fin du délai de grâce."}
            {access.warn === "canceling" && "Votre abonnement est résilié : il prendra fin à la fin de la période payée."}
            {can(membership.role, "company:manage") && <> <Link href={`/app/${companyId}/billing`} className="font-medium underline">Gérer l&apos;abonnement</Link></>}
          </div>
        )}
        <main className="mx-auto max-w-5xl px-4 py-8 md:px-8">{children}</main>
      </div>
    </div>
  );
}
