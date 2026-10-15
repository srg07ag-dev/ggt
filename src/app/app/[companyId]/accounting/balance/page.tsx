import { Download } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { formatMoney } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { withAccess } from "@/lib/with-access";
import { trialBalance } from "@/modules/accounting/reports";

export const metadata = { title: "Balance" };

async function Balance({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const { companyId } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const tb = await trialBalance(user.id, companyId, sp);
  const [co] = await db.select({ currency: schema.company.currency }).from(schema.company).where(eq(schema.company.id, companyId));
  const m = (n: number) => (n === 0 ? "" : formatMoney(Math.abs(n), co!.currency));
  const side = (n: number) => (n === 0 ? "" : n > 0 ? " D" : " C");
  const q = new URLSearchParams({ ...(sp.from ? { from: sp.from } : {}), ...(sp.to ? { to: sp.to } : {}) }).toString();
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Balance</h1>
        <a href={`/app/${companyId}/exports/ledger${q ? `?${q}` : ""}`} className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-border-strong bg-surface px-4 text-sm font-medium hover:bg-surface-2"><Download className="size-4" aria-hidden /> Exporter les écritures (CSV)</a>
      </div>
      <form className="flex flex-wrap items-end gap-3" role="search">
        <label className="text-sm font-medium">Du<input type="date" name="from" defaultValue={sp.from} className="mt-1 block h-10 rounded-[var(--radius-sm)] border border-border-strong bg-surface px-3 text-sm" /></label>
        <label className="text-sm font-medium">Au<input type="date" name="to" defaultValue={sp.to} className="mt-1 block h-10 rounded-[var(--radius-sm)] border border-border-strong bg-surface px-3 text-sm" /></label>
        <button className="h-10 rounded-[var(--radius-sm)] border border-border-strong bg-surface px-4 text-sm font-medium hover:bg-surface-2">Appliquer</button>
        {tb.rows.length > 0 && <Badge tone={tb.balanced ? "success" : "danger"}>{tb.balanced ? "Balance équilibrée" : "Déséquilibre détecté"}</Badge>}
      </form>
      {tb.rows.length === 0 ? (
        <EmptyState title="Aucune écriture validée" description="La balance se construit à partir des écritures validées." />
      ) : (
        <div className="overflow-x-auto border-y border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-muted"><tr><th className="px-4 py-3 font-medium">Compte</th><th className="px-4 py-3 text-right font-medium">Ouverture</th><th className="px-4 py-3 text-right font-medium">Débit</th><th className="px-4 py-3 text-right font-medium">Crédit</th><th className="px-4 py-3 text-right font-medium">Solde</th></tr></thead>
            <tbody>
              {tb.rows.map((r) => (
                <tr key={r.accountId} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5"><Link className="font-medium hover:text-accent" href={`/app/${companyId}/accounting/ledger?account=${r.accountId}`}><span className="num">{r.code}</span></Link> <span className="text-muted">{r.name}</span></td>
                  <td className="num px-4 py-2.5 text-right text-muted">{m(r.openingMinor)}{side(r.openingMinor)}</td>
                  <td className="num px-4 py-2.5 text-right">{m(r.debitMinor)}</td>
                  <td className="num px-4 py-2.5 text-right">{m(r.creditMinor)}</td>
                  <td className="num px-4 py-2.5 text-right font-medium">{m(r.closingMinor)}{side(r.closingMinor)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t border-border font-semibold"><td className="px-4 py-3">Totaux des mouvements</td><td /><td className="num px-4 py-3 text-right">{formatMoney(tb.totals.debitMinor, co!.currency)}</td><td className="num px-4 py-3 text-right">{formatMoney(tb.totals.creditMinor, co!.currency)}</td><td /></tr></tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

export default withAccess(Balance);
