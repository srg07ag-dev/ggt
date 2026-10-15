import Link from "next/link";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PillTabs } from "@/components/ui/pill-tabs";
import { requireUser } from "@/lib/session";
import { listCompaniesAdmin } from "@/modules/billing/admin";

export const metadata = { title: "Entreprises" };

const STATUS: [string, string][] = [["", "Toutes"], ["trialing", "En essai"], ["active", "Actives"], ["past_due", "En retard"], ["expired", "Expirées"], ["none", "Sans abonnement"]];

export default async function Companies({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows, hasMore } = await listCompaniesAdmin(user.id, { q: sp.q, status: sp.status, page });
  const qs = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: sp.q, status: sp.status, ...o })) if (v) p.set(k, v);
    return `/admin/companies${p.toString() ? `?${p}` : ""}`;
  };
  const fmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" });
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Entreprises</h1>
      <p className="text-sm text-muted">Métadonnées d&apos;abonnement uniquement : les données métier des entreprises ne sont jamais accessibles ici.</p>
      <form role="search" className="relative max-w-sm">
        <Search className="absolute left-3 top-2.5 size-4 text-muted" aria-hidden />
        <input name="q" defaultValue={sp.q} placeholder="Nom ou e-mail du propriétaire" aria-label="Rechercher une entreprise" className="h-10 w-full rounded-[var(--radius-sm)] border border-border-strong bg-surface pl-9 pr-4 text-sm" />
        {sp.status && <input type="hidden" name="status" value={sp.status} />}
      </form>
      <PillTabs label="Statut" tabs={STATUS.map(([k, l]) => ({ href: qs({ status: k || undefined, page: undefined }), label: l, active: (sp.status ?? "") === k }))} />
      <div className="overflow-x-auto border-y border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs text-muted"><tr><th className="px-4 py-3 font-medium">Entreprise</th><th className="hidden px-4 py-3 font-medium md:table-cell">Propriétaire</th><th className="px-4 py-3 font-medium">Offre</th><th className="px-4 py-3 font-medium">Statut</th><th className="hidden px-4 py-3 font-medium md:table-cell">Membres</th><th className="hidden px-4 py-3 font-medium md:table-cell">Créée</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted">Aucune entreprise.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                <td className="px-4 py-2.5"><Link href={`/admin/companies/${r.id}`} className="font-medium hover:text-accent">{r.name}</Link> <span className="text-xs text-muted">{r.country}</span></td>
                <td className="hidden px-4 py-2.5 text-muted md:table-cell">{r.ownerEmail ?? "—"}</td>
                <td className="px-4 py-2.5">{r.planName ?? "—"}</td>
                <td className="px-4 py-2.5">{r.suspendedAt ? <Badge tone="danger">Suspendue</Badge> : r.status ? <Badge tone={r.status === "active" ? "success" : r.status === "trialing" ? "accent" : r.status === "past_due" ? "warning" : "danger"}>{r.status}</Badge> : <Badge tone="neutral">Sans abonnement</Badge>}</td>
                <td className="num hidden px-4 py-2.5 md:table-cell">{r.members}</td>
                <td className="num hidden px-4 py-2.5 text-muted md:table-cell">{fmt.format(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-3 text-sm">
        {page > 1 && <Link className="text-accent" href={qs({ page: String(page - 1) })}>← Précédente</Link>}
        {hasMore && <Link className="text-accent" href={qs({ page: String(page + 1) })}>Suivante →</Link>}
      </div>
    </div>
  );
}
