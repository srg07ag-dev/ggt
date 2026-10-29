import Link from "next/link";
import { FileText } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { formatMoney } from "@/lib/money";
import { DocStatusBadge } from "@/app/app/[companyId]/documents/status";
import type { listDocuments } from "@/modules/sales/documents";

type Rows = Awaited<ReturnType<typeof listDocuments>>;

export function DocumentList({ companyId, rows, empty }: { companyId: string; rows: Rows; empty: string }) {
  if (rows.length === 0) return <EmptyState icon={<FileText className="size-6" />} title="Aucun document" description={empty} />;
  return (
    <div className="overflow-x-auto rounded-[var(--radius-lg)] bg-surface shadow-card">
      <table className="w-full text-sm">
        <thead className="border-b border-border text-left text-xs text-muted">
          <tr>
            <th className="px-4 py-3 font-medium">Numéro</th>
            <th className="px-4 py-3 font-medium">Client</th>
            <th className="hidden px-4 py-3 font-medium md:table-cell">Date</th>
            <th className="hidden px-4 py-3 font-medium md:table-cell">Échéance</th>
            <th className="px-4 py-3 text-right font-medium">Total TTC</th>
            <th className="px-4 py-3 font-medium">Statut</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border last:border-0 hover:bg-surface-2">
              <td className="px-4 py-3">
                <Link href={`/app/${companyId}/documents/${r.id}`} className="font-medium hover:text-accent">{r.number ?? "Brouillon"}</Link>
              </td>
              <td className="px-4 py-3 text-muted">{r.contactName}</td>
              <td className="num hidden px-4 py-3 text-muted md:table-cell">{r.issueDate}</td>
              <td className="num hidden px-4 py-3 text-muted md:table-cell">{r.dueDate ?? "—"}</td>
              <td className="num px-4 py-3 text-right">{formatMoney(r.totalMinor, r.currency)}</td>
              <td className="px-4 py-3"><DocStatusBadge type={r.type} status={r.status} settlement={r.settlement} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
