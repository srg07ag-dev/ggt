import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckSquare, Kanban, LayoutDashboard, Users, Plus } from "lucide-react";
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
  try {
    await requireMembership(user.id, companyId);
  } catch (e) {
    if (e instanceof ForbiddenError) notFound();
    throw e;
  }
  const companies = await listCompaniesForUser(user.id);
  const current = companies.find((c) => c.id === companyId);

  const nav = [
    { href: `/app/${companyId}`, label: "Vue d'ensemble", icon: LayoutDashboard },
    { href: `/app/${companyId}/contacts`, label: "Contacts", icon: Users },
    { href: `/app/${companyId}/pipeline`, label: "Pipeline", icon: Kanban },
    { href: `/app/${companyId}/tasks`, label: "Tâches", icon: CheckSquare },
  ];

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[248px_1fr]">
      <aside className="border-b border-border bg-surface p-4 md:border-b-0 md:border-r">
        <div className="mb-6 px-2 text-base font-semibold tracking-tight">GGT</div>
        <nav aria-label="Navigation principale" className="flex gap-1 overflow-x-auto md:flex-col">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex h-9 items-center gap-2.5 rounded-full px-3 text-sm text-muted hover:bg-accent-soft hover:text-text"
            >
              <item.icon className="size-4" aria-hidden />
              {item.label}
            </Link>
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
          <span className="text-sm">{user.name}</span>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8 md:px-8">{children}</main>
      </div>
    </div>
  );
}
