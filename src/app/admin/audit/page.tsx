import Link from "next/link";
import { requireUser } from "@/lib/session";
import { listPlatformAudit } from "@/modules/billing/admin";

export const metadata = { title: "Journal" };

export default async function PlatformAuditPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const { before } = await searchParams;
  const user = await requireUser();
  const { rows, next } = await listPlatformAudit(user.id, before);
  const fmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "medium" });
  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-semibold tracking-tight">Journal de la plateforme</h1><p className="text-sm text-muted">Actions des opérateurs et événements d&apos;abonnement. En ajout seul.</p></div>
      <div className="overflow-x-auto border-y border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs text-muted"><tr><th className="px-4 py-3 font-medium">Date</th><th className="px-4 py-3 font-medium">Action</th><th className="hidden px-4 py-3 font-medium md:table-cell">Auteur</th><th className="hidden px-4 py-3 font-medium lg:table-cell">Détail</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border align-top last:border-0">
                <td className="num whitespace-nowrap px-4 py-3 text-muted">{fmt.format(r.createdAt)}</td>
                <td className="px-4 py-3 font-medium">{r.action}<span className="block text-xs font-normal text-muted">{r.targetType} {r.targetId?.slice(0, 8)}</span></td>
                <td className="hidden px-4 py-3 text-muted md:table-cell">{r.actor ?? "Système"}</td>
                <td className="hidden max-w-sm truncate px-4 py-3 font-mono text-xs text-muted lg:table-cell">{r.meta ? JSON.stringify(r.meta) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {next && <Link href={`/admin/audit?before=${encodeURIComponent(next)}`} className="inline-flex h-10 items-center rounded-[var(--radius-sm)] border border-border-strong bg-surface px-4 text-sm font-medium hover:bg-surface-2">Entrées plus anciennes</Link>}
    </div>
  );
}
