import Link from "next/link";
import { FileSpreadsheet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PillTabs } from "@/components/ui/pill-tabs";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { todayIn } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { withAccess } from "@/lib/with-access";
import { can } from "@/modules/core/permissions";
import { requireMembership } from "@/modules/core/tenant";
import { listLedgerAccounts } from "@/modules/accounting/chart";
import { listEntries } from "@/modules/accounting/entries";
import { listJournals } from "@/modules/accounting/journals";
import { EntryForm } from "../forms";

export const metadata = { title: "Écritures" };

const SOURCES: Record<string, string> = { manual: "Saisie", invoice: "Facture", credit_note: "Avoir", payment: "Paiement", finance_entry: "Dépense / recette", reversal: "Contre-passation" };

async function Entries({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<{ status?: string }> }) {
  const { companyId } = await params;
  const { status } = await searchParams;
  const user = await requireUser();
  const ctx = await requireMembership(user.id, companyId, "accounting:read");
  const st = status === "draft" || status === "posted" ? status : undefined;
  const [rows, accounts, journals, [co]] = await Promise.all([
    listEntries(user.id, companyId, { status: st }),
    listLedgerAccounts(user.id, companyId),
    listJournals(user.id, companyId),
    db.select().from(schema.company).where(eq(schema.company.id, companyId)),
  ]);
  const base = `/app/${companyId}/accounting/entries`;
  const canWrite = can(ctx.role, "accounting:write");
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Écritures comptables</h1>
      {canWrite && (
        accounts.length < 2 ? <Card><p className="text-sm text-muted">Créez d&apos;abord au moins deux comptes (Plan de comptes).</p></Card> : (
          <details className="border-y border-border">
            <summary className="cursor-pointer list-none px-5 py-4 text-sm font-medium text-accent">+ Nouvelle écriture manuelle</summary>
            <div className="border-t border-border p-5">
              <EntryForm companyId={companyId} journals={journals.map((j) => ({ id: j.id, label: `${j.code} — ${j.name}` }))} accounts={accounts.map((a) => ({ id: a.id, label: `${a.code} — ${a.name}` }))} currency={co!.currency} defaults={{ journalId: journals.find((j) => j.kind === "misc")?.id ?? journals[0]?.id ?? "", entryDate: todayIn(co!.timezone), description: "", lines: [] }} />
            </div>
          </details>
        )
      )}
      <PillTabs label="Statut" tabs={[{ href: base, label: "Toutes", active: !st }, { href: `${base}?status=posted`, label: "Validées", active: st === "posted" }, { href: `${base}?status=draft`, label: "Brouillons", active: st === "draft" }]} />
      {rows.length === 0 ? (
        <EmptyState icon={<FileSpreadsheet className="size-6" />} title="Aucune écriture" description="Les écritures manuelles et automatiques apparaîtront ici." />
      ) : (
        <div className="overflow-x-auto border-y border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-muted"><tr><th className="px-4 py-3 font-medium">Date</th><th className="px-4 py-3 font-medium">Numéro</th><th className="px-4 py-3 font-medium">Libellé</th><th className="hidden px-4 py-3 font-medium md:table-cell">Origine</th><th className="px-4 py-3 text-right font-medium">Montant</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                  <td className="num px-4 py-2.5 text-muted">{r.entryDate}</td>
                  <td className="px-4 py-2.5"><Link href={`${base}/${r.id}`} className="font-medium hover:text-accent">{r.number ?? "Brouillon"}</Link>{r.status === "draft" && <span className="ml-2"><Badge tone="warning">Brouillon</Badge></span>}</td>
                  <td className="px-4 py-2.5">{r.description}</td>
                  <td className="hidden px-4 py-2.5 text-muted md:table-cell">{SOURCES[r.sourceType] ?? r.sourceType}</td>
                  <td className="num px-4 py-2.5 text-right">{formatMoney(r.totalMinor, co!.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default withAccess(Entries);
