import { Receipt } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { EntryList } from "@/components/entry-list";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { todayIn } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { can } from "@/modules/core/permissions";
import { requireMembership } from "@/modules/core/tenant";
import { listAccounts, listCategories, listEntries, listSuppliers } from "@/modules/finance/finance";
import { CategoryForm, EntryForm } from "../finance-forms";

export const metadata = { title: "Dépenses" };

export default async function Expenses({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const user = await requireUser();
  const ctx = await requireMembership(user.id, companyId, "finance:read");
  const [rows, accounts, categories, suppliers, [co]] = await Promise.all([
    listEntries(user.id, companyId, { kind: "expense" }),
    listAccounts(user.id, companyId),
    listCategories(user.id, companyId),
    listSuppliers(user.id, companyId),
    db.select().from(schema.company).where(eq(schema.company.id, companyId)),
  ]);
  const active = accounts.filter((a) => !a.archived);
  const canWrite = can(ctx.role, "finance:write");
  const total = rows.filter((r) => !r.voidedAt).reduce((n, r) => n + r.amountMinor, 0);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Dépenses</h1>
        {rows.length > 0 && <p className="text-sm text-muted">Total (hors annulées) : <span className="num font-medium text-text">{formatMoney(total, co!.currency)}</span></p>}
      </div>
      {canWrite && (
        active.length === 0 ? (
          <Card><p className="text-sm text-muted">Créez d&apos;abord un compte de trésorerie (page Trésorerie) pour enregistrer une dépense.</p></Card>
        ) : (
          <details className="rounded-[var(--radius-lg)] border border-border bg-surface">
            <summary className="cursor-pointer list-none px-5 py-4 text-sm font-medium text-accent">+ Nouvelle dépense</summary>
            <div className="space-y-5 border-t border-border p-5">
              <EntryForm companyId={companyId} kind="expense" today={todayIn(co!.timezone)} currency={co!.currency} accounts={active} categories={categories.filter((c) => c.kind === "expense")} parties={suppliers} />
              <div className="border-t border-border pt-4"><CategoryForm companyId={companyId} kind="expense" /></div>
            </div>
          </details>
        )
      )}
      {rows.length === 0 ? (
        <EmptyState icon={<Receipt className="size-6" />} title="Aucune dépense" description="Enregistrez vos dépenses et joignez le justificatif pour tout retrouver au même endroit." />
      ) : (
        <EntryList companyId={companyId} rows={rows} currency={co!.currency} partyLabel="Fournisseur" />
      )}
    </div>
  );
}
