import Link from "next/link";
import { HandCoins } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { todayIn } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { can } from "@/modules/core/permissions";
import { requireMembership } from "@/modules/core/tenant";
import { listContactOptions } from "@/modules/crm/contacts";
import { listAccounts, listCategories, listReceipts } from "@/modules/finance/finance";
import { EntryForm } from "../finance-forms";
import { withAccess } from "@/lib/with-access";

export const metadata = { title: "Recettes" };

async function Income({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const user = await requireUser();
  const ctx = await requireMembership(user.id, companyId, "finance:read");
  const [rows, accounts, categories, contacts, [co]] = await Promise.all([
    listReceipts(user.id, companyId),
    listAccounts(user.id, companyId),
    listCategories(user.id, companyId),
    listContactOptions(user.id, companyId),
    db.select().from(schema.company).where(eq(schema.company.id, companyId)),
  ]);
  const active = accounts.filter((a) => !a.archived);
  const canWrite = can(ctx.role, "finance:write");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Recettes</h1>
        <p className="text-sm text-muted">Encaissements de factures et autres recettes. Les paiements de factures s&apos;enregistrent depuis la facture.</p>
      </div>
      {canWrite && active.length > 0 && (
        <details className="glass rounded-[var(--radius-lg)]">
          <summary className="cursor-pointer list-none px-5 py-4 text-sm font-medium text-accent">+ Nouvelle recette (hors facture)</summary>
          <div className="border-t border-border p-5"><EntryForm companyId={companyId} kind="income" today={todayIn(co!.timezone)} currency={co!.currency} accounts={active} categories={categories.filter((c) => c.kind === "income")} parties={contacts} /></div>
        </details>
      )}
      {canWrite && active.length === 0 && <Card><p className="text-sm text-muted">Créez d&apos;abord un compte de trésorerie pour enregistrer une recette.</p></Card>}
      {rows.length === 0 ? (
        <EmptyState icon={<HandCoins className="size-6" />} title="Aucune recette" description="Les paiements reçus sur vos factures et vos autres recettes apparaîtront ici." />
      ) : (
        <div className="overflow-x-auto glass rounded-[var(--radius-lg)]">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-muted">
              <tr><th className="px-4 py-3 font-medium">Date</th><th className="px-4 py-3 font-medium">Origine</th><th className="hidden px-4 py-3 font-medium md:table-cell">Compte</th><th className="px-4 py-3 text-right font-medium">Montant</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.source}-${r.id}`} className="border-b border-border last:border-0">
                  <td className="num px-4 py-3 text-muted">{r.date}</td>
                  <td className="px-4 py-3">
                    <Link className={`font-medium hover:text-accent ${r.voided ? "text-muted line-through" : ""}`} href={r.source === "payment" ? `/app/${companyId}/documents/${r.docId}` : `/app/${companyId}/entries/${r.id}`}>{r.label}</Link>
                    {r.voided && <span className="ml-2"><Badge tone="warning">Annulé</Badge></span>}
                  </td>
                  <td className="hidden px-4 py-3 text-muted md:table-cell">{r.account ?? <Badge tone="warning">Non affecté</Badge>}</td>
                  <td className={`num px-4 py-3 text-right ${r.voided ? "text-muted line-through" : ""}`}>{formatMoney(r.amountMinor, co!.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default withAccess(Income);
