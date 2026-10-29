import Link from "next/link";
import { ScrollText } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PillTabs } from "@/components/ui/pill-tabs";
import { requireUser } from "@/lib/session";
import { withAccess } from "@/lib/with-access";
import { ACTION_LABELS, FAMILIES, listAudit } from "@/modules/core/audit";

export const metadata = { title: "Journal d'audit" };

async function AuditPage({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<{ family?: string; before?: string }> }) {
  const { companyId } = await params;
  const { family = "", before } = await searchParams;
  const user = await requireUser();
  const { rows, next } = await listAudit(user.id, companyId, { family, before });
  const fmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "medium" });
  const base = `/app/${companyId}/audit`;
  const q = (o: Record<string, string>) => `${base}?${new URLSearchParams(o).toString()}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Journal d&apos;audit</h1>
        <p className="text-sm text-muted">Historique des actions sensibles de l&apos;entreprise. Il est en lecture seule : aucune ligne ne peut être modifiée ni supprimée.</p>
      </div>
      <PillTabs label="Famille" tabs={FAMILIES.map(([k, label]) => ({ href: k ? q({ family: k }) : base, label, active: family === k }))} />
      {rows.length === 0 ? (
        <EmptyState icon={<ScrollText className="size-6" />} title="Aucune entrée" description="Les actions correspondant à ce filtre apparaîtront ici." />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-lg)] bg-surface shadow-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-muted">
              <tr><th className="px-4 py-3 font-medium">Date</th><th className="px-4 py-3 font-medium">Action</th><th className="hidden px-4 py-3 font-medium md:table-cell">Auteur</th><th className="hidden px-4 py-3 font-medium lg:table-cell">Détail</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border align-top last:border-0">
                  <td className="num whitespace-nowrap px-4 py-3 text-muted">{fmt.format(r.createdAt)}</td>
                  <td className="px-4 py-3 font-medium">{ACTION_LABELS[r.action] ?? r.action}</td>
                  <td className="hidden px-4 py-3 text-muted md:table-cell">{r.actorName ?? "Système"}{r.actorEmail ? <span className="block text-xs">{r.actorEmail}</span> : null}</td>
                  <td className="hidden max-w-xs truncate px-4 py-3 font-mono text-xs text-muted lg:table-cell">{r.meta ? JSON.stringify(r.meta) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {next && <Link href={q({ ...(family ? { family } : {}), before: next })} className="inline-flex h-10 items-center rounded-[var(--radius-sm)] border border-border-strong bg-surface px-4 text-sm font-medium hover:bg-surface-2">Entrées plus anciennes</Link>}
    </div>
  );
}

export default withAccess(AuditPage);
