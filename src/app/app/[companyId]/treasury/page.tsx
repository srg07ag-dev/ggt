import { Landmark } from "lucide-react";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { formatMoney } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { can } from "@/modules/core/permissions";
import { requireMembership } from "@/modules/core/tenant";
import { listAccounts } from "@/modules/finance/finance";
import { archiveAccountAction } from "../finance-actions";
import { AccountForm } from "../finance-forms";
import { withAccess } from "@/lib/with-access";

export const metadata = { title: "Trésorerie" };

const KINDS: Record<string, string> = { bank: "Banque", cash: "Caisse", mobile_money: "Mobile money", other: "Autre" };

async function Treasury({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const user = await requireUser();
  const ctx = await requireMembership(user.id, companyId, "finance:read");
  const [accounts, [co]] = await Promise.all([listAccounts(user.id, companyId), db.select({ currency: schema.company.currency }).from(schema.company).where(eq(schema.company.id, companyId))]);
  const active = accounts.filter((a) => !a.archived);
  const total = active.reduce((n, a) => n + a.balanceMinor, 0);
  const canWrite = can(ctx.role, "finance:write");
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Trésorerie</h1>
      <Card>
        <CardTitle hint="Somme des soldes de vos comptes : solde initial + encaissements + recettes − dépenses">Trésorerie disponible</CardTitle>
        <p className="num text-4xl font-semibold tracking-tight">{active.length ? formatMoney(total, co!.currency) : "—"}</p>
      </Card>
      {active.length === 0 ? (
        <EmptyState icon={<Landmark className="size-6" />} title="Aucun compte de trésorerie" description="Ajoutez votre banque, votre caisse ou votre compte mobile money avec son solde actuel pour suivre votre trésorerie." />
      ) : (
        <ul className="divide-y divide-border rounded-[var(--radius-lg)] bg-surface shadow-card">
          {active.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-4">
              <span><span className="font-medium">{a.name}</span><span className="block text-xs text-muted">{KINDS[a.kind] ?? a.kind}</span></span>
              <span className="flex items-center gap-4">
                <span className={`num text-base font-semibold ${a.balanceMinor < 0 ? "text-danger" : ""}`}>{formatMoney(a.balanceMinor, a.currency)}</span>
                {canWrite && <form action={archiveAccountAction.bind(null, companyId, a.id)}><button className="text-xs text-muted hover:text-danger" aria-label={`Archiver ${a.name}`}>Archiver</button></form>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <details className="rounded-[var(--radius-lg)] bg-surface shadow-card">
          <summary className="cursor-pointer list-none px-5 py-4 text-sm font-medium text-accent">+ Nouveau compte</summary>
          <div className="border-t border-border p-5"><AccountForm companyId={companyId} currency={co!.currency} /></div>
        </details>
      )}
    </div>
  );
}

export default withAccess(Treasury);
