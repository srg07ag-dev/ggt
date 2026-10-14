import { Card, CardTitle } from "@/components/ui/card";
import { schema } from "@/db/client";
import { asc, isNull } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { withAccess } from "@/lib/with-access";
import { can } from "@/modules/core/permissions";
import { requireMembership, withTenant } from "@/modules/core/tenant";
import { listLedgerAccounts } from "@/modules/accounting/chart";
import { listJournals } from "@/modules/accounting/journals";
import { getAccountingSettings } from "@/modules/accounting/posting";
import { MappingSelect, SettingsForm } from "../forms";

export const metadata = { title: "Correspondances comptables" };

async function AccountingSettingsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const user = await requireUser();
  const ctx = await requireMembership(user.id, companyId, "accounting:read");
  const [accounts, journals, settings] = await Promise.all([listLedgerAccounts(user.id, companyId), listJournals(user.id, companyId), getAccountingSettings(user.id, companyId)]);
  const maps = await withTenant(ctx, async (tx) => ({
    treasury: await tx.select().from(schema.financeAccount).where(isNull(schema.financeAccount.archivedAt)).orderBy(asc(schema.financeAccount.name)),
    taxes: await tx.select().from(schema.taxRate).where(isNull(schema.taxRate.archivedAt)).orderBy(asc(schema.taxRate.name)),
    categories: await tx.select().from(schema.financeCategory).where(isNull(schema.financeCategory.archivedAt)).orderBy(asc(schema.financeCategory.name)),
  }));
  const canWrite = can(ctx.role, "accounting:write");
  const opts = (type?: string) => accounts.filter((a) => !type || a.type === type).map((a) => ({ id: a.id, label: `${a.code} — ${a.name}` }));
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Correspondances comptables</h1>
        <p className="text-sm text-muted">Indiquez à quels comptes vos factures, paiements, dépenses et recettes doivent être comptabilisés. Tant que tout n&apos;est pas configuré, rien n&apos;est comptabilisé automatiquement.</p>
      </div>
      {canWrite ? (
        <Card>
          <CardTitle hint="L'activation exige une configuration complète et une période ouverte à la date de départ.">Comptes et journaux par défaut</CardTitle>
          <SettingsForm companyId={companyId} accounts={accounts.map((a) => ({ id: a.id, label: `${a.code} — ${a.name}`, type: a.type }))} journals={journals.map((j) => ({ id: j.id, label: `${j.code} — ${j.name}`, kind: j.kind }))} values={settings ? { ...settings, updatedAt: undefined, enabledFrom: settings.enabledFrom ?? "" } : {}} />
        </Card>
      ) : (
        <Card><p className="text-sm text-muted">Comptabilisation automatique : {settings?.enabled ? `active depuis le ${settings.enabledFrom}` : "inactive"}.</p></Card>
      )}
      {canWrite && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardTitle hint="Chaque compte de trésorerie doit avoir son compte comptable (actif).">Comptes de trésorerie</CardTitle>
            {maps.treasury.length === 0 ? <p className="text-sm text-muted">Aucun compte de trésorerie.</p> : (
              <ul className="space-y-2 text-sm">{maps.treasury.map((t) => <li key={t.id} className="flex items-center justify-between gap-2"><span>{t.name}</span><MappingSelect companyId={companyId} kind="finance_account" id={t.id} current={t.ledgerAccountId} accounts={opts("asset")} label={`Compte comptable de ${t.name}`} /></li>)}</ul>
            )}
          </Card>
          <Card>
            <CardTitle hint="À défaut, le compte de taxe collectée par défaut est utilisé.">Taxes (collectée)</CardTitle>
            {maps.taxes.length === 0 ? <p className="text-sm text-muted">Aucune taxe définie.</p> : (
              <ul className="space-y-2 text-sm">{maps.taxes.map((t) => <li key={t.id} className="flex items-center justify-between gap-2"><span>{t.name}</span><MappingSelect companyId={companyId} kind="tax_rate" id={t.id} current={t.ledgerAccountId} accounts={opts("liability")} label={`Compte de ${t.name}`} /></li>)}</ul>
            )}
          </Card>
          <Card>
            <CardTitle hint="À défaut, les comptes par défaut ci-dessus sont utilisés.">Catégories de dépenses et de recettes</CardTitle>
            <ul className="space-y-2 text-sm">{maps.categories.map((c) => <li key={c.id} className="flex items-center justify-between gap-2"><span>{c.name} <span className="text-xs text-muted">({c.kind === "expense" ? "dépense" : "recette"})</span></span><MappingSelect companyId={companyId} kind="finance_category" id={c.id} current={c.ledgerAccountId} accounts={opts(c.kind === "expense" ? "expense" : "revenue")} label={`Compte de ${c.name}`} /></li>)}</ul>
          </Card>
        </div>
      )}
    </div>
  );
}

export default withAccess(AccountingSettingsPage);
