import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/session";
import { withAccess } from "@/lib/with-access";
import { listLedgerAccounts } from "@/modules/accounting/chart";
import { listPeriods } from "@/modules/accounting/periods";
import { getAccountingSettings } from "@/modules/accounting/posting";
import { trialBalance } from "@/modules/accounting/reports";
import { listEntries } from "@/modules/accounting/entries";

export const metadata = { title: "Comptabilité" };

async function AccountingHome({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const user = await requireUser();
  const [accounts, periods, settings, tb, drafts] = await Promise.all([
    listLedgerAccounts(user.id, companyId),
    listPeriods(user.id, companyId),
    getAccountingSettings(user.id, companyId),
    trialBalance(user.id, companyId, {}),
    listEntries(user.id, companyId, { status: "draft" }),
  ]);
  const b = `/app/${companyId}/accounting`;
  const steps = [
    { done: accounts.length > 0, title: "Importer ou saisir votre plan de comptes", href: `${b}/accounts`, hint: "Demandez à votre comptable le plan de votre référentiel." },
    { done: periods.length > 0, title: "Créer votre exercice comptable", href: `${b}/periods`, hint: "Les écritures ne peuvent être validées que dans une période ouverte." },
    { done: Boolean(settings?.enabled), title: "Associer vos comptes et activer la comptabilisation automatique", href: `${b}/settings`, hint: "Factures, paiements, dépenses et recettes génèrent alors leurs écritures." },
  ];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Comptabilité</h1>
        <p className="text-sm text-muted">Comptabilité en partie double : écritures équilibrées, périodes verrouillables, journal d&apos;audit.</p>
      </div>
      <Card>
        <CardTitle hint="Aucune règle ni aucun plan de comptes d'un pays n'est préinstallé : c'est vous (ou votre comptable) qui définissez votre référentiel.">Mise en route</CardTitle>
        <ol className="space-y-3">
          {steps.map((s) => (
            <li key={s.href} className="flex items-start gap-3 text-sm">
              {s.done ? <CheckCircle2 className="mt-0.5 size-5 text-success" aria-label="Fait" /> : <Circle className="mt-0.5 size-5 text-muted" aria-label="À faire" />}
              <span><Link href={s.href} className="font-medium hover:text-accent">{s.title}</Link><span className="block text-xs text-muted">{s.hint}</span></span>
            </li>
          ))}
        </ol>
      </Card>
      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardTitle>Comptes</CardTitle><p className="num text-3xl font-semibold">{accounts.length}</p></Card>
        <Card><CardTitle>Brouillons à valider</CardTitle><p className="num text-3xl font-semibold">{drafts.length}</p></Card>
        <Card>
          <CardTitle hint="Débits = crédits sur toutes les écritures validées">Équilibre de la balance</CardTitle>
          {tb.rows.length === 0 ? <p className="text-sm text-muted">Aucune écriture validée.</p> : <Badge tone={tb.balanced ? "success" : "danger"}>{tb.balanced ? "Équilibrée" : "Déséquilibre détecté"}</Badge>}
        </Card>
      </div>
    </div>
  );
}

export default withAccess(AccountingHome);
