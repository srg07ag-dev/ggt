import Link from "next/link";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { formatMoney } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { withAccess } from "@/lib/with-access";
import { listLedgerAccounts } from "@/modules/accounting/chart";
import { generalLedger } from "@/modules/accounting/reports";

export const metadata = { title: "Grand livre" };

async function Ledger({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<{ account?: string; from?: string; to?: string }> }) {
  const { companyId } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const accounts = await listLedgerAccounts(user.id, companyId, { includeArchived: true });
  const [co] = await db.select({ currency: schema.company.currency }).from(schema.company).where(eq(schema.company.id, companyId));
  const gl = sp.account && /^[0-9a-f-]{36}$/i.test(sp.account) ? await generalLedger(user.id, companyId, sp.account, { from: sp.from, to: sp.to }) : null;
  const money = (n: number) => formatMoney(n, co!.currency);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Grand livre</h1>
      <form className="flex flex-wrap items-end gap-3" role="search">
        <label className="text-sm font-medium">Compte
          <select name="account" defaultValue={sp.account ?? ""} className="mt-1 block h-10 min-w-64 rounded-[var(--radius-sm)] border border-border-strong bg-surface px-3 text-sm">
            <option value="">Choisir…</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">Du<input type="date" name="from" defaultValue={sp.from} className="mt-1 block h-10 rounded-[var(--radius-sm)] border border-border-strong bg-surface px-3 text-sm" /></label>
        <label className="text-sm font-medium">Au<input type="date" name="to" defaultValue={sp.to} className="mt-1 block h-10 rounded-[var(--radius-sm)] border border-border-strong bg-surface px-3 text-sm" /></label>
        <button className="h-10 rounded-[var(--radius-sm)] border border-border-strong bg-surface px-4 text-sm font-medium hover:bg-surface-2">Afficher</button>
      </form>
      {!gl ? (
        <EmptyState title="Choisissez un compte" description="Le grand livre liste les mouvements validés d'un compte avec le solde cumulé." />
      ) : (
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs text-muted"><tr><th className="px-4 py-3 font-medium">Date</th><th className="px-4 py-3 font-medium">Écriture</th><th className="px-4 py-3 font-medium">Libellé</th><th className="px-4 py-3 text-right font-medium">Débit</th><th className="px-4 py-3 text-right font-medium">Crédit</th><th className="px-4 py-3 text-right font-medium">Solde</th></tr></thead>
              <tbody>
                <tr className="border-b border-border text-muted"><td className="px-4 py-2.5" colSpan={5}>Solde d&apos;ouverture</td><td className="num px-4 py-2.5 text-right">{money(gl.openingMinor)}</td></tr>
                {gl.lines.map((l, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="num px-4 py-2.5 text-muted">{l.date}</td>
                    <td className="px-4 py-2.5"><Link className="hover:text-accent" href={`/app/${companyId}/accounting/entries/${l.entryId}`}>{l.number}</Link></td>
                    <td className="px-4 py-2.5">{l.description}</td>
                    <td className="num px-4 py-2.5 text-right">{l.debitMinor ? money(l.debitMinor) : ""}</td>
                    <td className="num px-4 py-2.5 text-right">{l.creditMinor ? money(l.creditMinor) : ""}</td>
                    <td className="num px-4 py-2.5 text-right">{money(l.runningMinor)}</td>
                  </tr>
                ))}
                <tr className="border-t border-border font-semibold"><td className="px-4 py-3" colSpan={5}>Solde de clôture ({gl.closingMinor >= 0 ? "débiteur" : "créditeur"})</td><td className="num px-4 py-3 text-right">{money(gl.closingMinor)}</td></tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

export default withAccess(Ledger);
