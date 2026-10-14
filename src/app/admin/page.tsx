import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { adminOverview } from "@/modules/billing/admin";
import { getPlatformSettings } from "@/modules/billing/platform";

export const metadata = { title: "Vue d'ensemble" };

const LABELS: Record<string, string> = { trialing: "En essai", active: "Actifs", past_due: "Paiement en retard", expired: "Expirés" };

export default async function AdminHome() {
  const user = await requireUser();
  const [o, settings] = await Promise.all([adminOverview(user.id), getPlatformSettings()]);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Vue d&apos;ensemble</h1>
      {!settings.billingEnabled && <Card className="border-warning"><p className="text-sm">La facturation est <strong>désactivée</strong> : toutes les entreprises ont l&apos;accès complet. <Link className="text-accent" href="/admin/settings">Réglages</Link></p></Card>}
      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardTitle>Entreprises</CardTitle><p className="num text-3xl font-semibold">{o.companies}</p></Card>
        <Card><CardTitle>Utilisateurs</CardTitle><p className="num text-3xl font-semibold">{o.users}</p></Card>
        <Card><CardTitle hint="Sans abonnement : accès complet (créées avant l'activation)">Sans abonnement</CardTitle><p className="num text-3xl font-semibold">{o.withoutSubscription}</p></Card>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardTitle hint="Dernier statut matérialisé par la tâche de facturation">Abonnements</CardTitle>
          <ul className="space-y-1.5 text-sm">{Object.entries(LABELS).map(([k, l]) => <li key={k} className="flex justify-between"><span>{l}</span><span className="num font-medium">{o.byStatus[k] ?? 0}</span></li>)}</ul>
        </Card>
        <Card>
          <CardTitle hint="Factures payées couvrant aujourd'hui, ramenées au mois, par devise (sans conversion)">Revenu mensuel récurrent</CardTitle>
          {o.mrr.length === 0 ? <p className="text-sm text-muted">Aucun revenu récurrent.</p> : <ul className="space-y-1.5">{o.mrr.map((m) => <li key={m.currency} className="num text-2xl font-semibold">{formatMoney(m.minor, m.currency)}</li>)}</ul>}
          <p className="mt-3 text-sm text-muted">Factures à régler : <span className="num font-medium text-text">{o.openInvoices.count}</span></p>
        </Card>
      </div>
    </div>
  );
}
