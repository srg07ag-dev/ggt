import Link from "next/link";
import { Paperclip } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/money";
import type { listEntries } from "@/modules/finance/finance";

type Rows = Awaited<ReturnType<typeof listEntries>>;

export function EntryList({ companyId, rows, currency, partyLabel }: { companyId: string; rows: Rows; currency: string; partyLabel: string }) {
  return (
    <div className="overflow-x-auto border-y border-border">
      <table className="w-full text-sm">
        <thead className="border-b border-border text-left text-xs text-muted">
          <tr>
            <th className="px-4 py-3 font-medium">Date</th>
            <th className="px-4 py-3 font-medium">Description</th>
            <th className="hidden px-4 py-3 font-medium md:table-cell">Catégorie</th>
            <th className="hidden px-4 py-3 font-medium md:table-cell">{partyLabel}</th>
            <th className="px-4 py-3 text-right font-medium">Montant</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border last:border-0 hover:bg-surface-2">
              <td className="num px-4 py-3 text-muted">{r.occurredOn}</td>
              <td className="px-4 py-3">
                <Link href={`/app/${companyId}/entries/${r.id}`} className={`font-medium hover:text-accent ${r.voidedAt ? "text-muted line-through" : ""}`}>{r.description}</Link>
                {r.attachments > 0 && <Paperclip className="ml-2 inline size-3.5 text-muted" aria-label={`${r.attachments} justificatif(s)`} />}
                {r.voidedAt && <span className="ml-2"><Badge tone="warning">Annulée</Badge></span>}
              </td>
              <td className="hidden px-4 py-3 text-muted md:table-cell">{r.categoryName ?? "—"}</td>
              <td className="hidden px-4 py-3 text-muted md:table-cell">{r.supplierName ?? "—"}</td>
              <td className={`num px-4 py-3 text-right ${r.voidedAt ? "text-muted line-through" : ""}`}>{formatMoney(r.amountMinor, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
