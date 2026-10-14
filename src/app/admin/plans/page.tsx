import Link from "next/link";
import { ActionButton } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { listPlansAdmin } from "@/modules/billing/plans";
import { MODULE_LABELS, type Limits, type Module } from "@/modules/core/entitlements";
import { archivePlanAction } from "../actions";
import { PlanForm } from "../forms";

export const metadata = { title: "Offres" };

export default async function Plans() {
  const user = await requireUser();
  const plans = await listPlansAdmin(user.id);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Offres</h1>
        <p className="text-sm text-muted">Aucune offre n&apos;est préinstallée : créez les vôtres. Un nouveau prix ne s&apos;applique qu&apos;aux prochaines factures ; les modules et limites s&apos;appliquent tout de suite à tous les abonnés.</p>
      </div>
      {plans.length === 0 ? <Card><p className="text-sm text-muted">Aucune offre. Créez-en une ci-dessous (au moins une offre par défaut est nécessaire pour activer la facturation).</p></Card> : (
        <ul className="divide-y divide-border rounded-[var(--radius-lg)] border border-border bg-surface">
          {plans.map(({ plan: p, subscribers }) => {
            const l = p.limits as Limits;
            return (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm">
                <span>
                  <Link href={`/admin/plans/${p.id}`} className="font-medium hover:text-accent">{p.name}</Link> <span className="text-xs text-muted">({p.code})</span>
                  <span className="block text-xs text-muted">{p.priceMinor === 0 ? "Gratuit" : `${formatMoney(p.priceMinor, p.currency)} / ${p.interval === "month" ? "mois" : "an"}`} · {p.modules.map((m) => MODULE_LABELS[m as Module]).join(", ")} · membres {l.members ?? "∞"} · factures/mois {l.invoicesPerMonth ?? "∞"} · stockage {l.storageMb ?? "∞"} Mo · {subscribers} abonné(s)</span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  {p.isDefault && <Badge tone="accent">Par défaut</Badge>}
                  {!p.isPublic && <Badge tone="neutral">Privée</Badge>}
                  {p.archivedAt && <Badge tone="warning">Archivée</Badge>}
                  {!p.isDefault && <ActionButton variant="secondary" action={archivePlanAction.bind(null, p.id, !p.archivedAt)}>{p.archivedAt ? "Restaurer" : "Archiver"}</ActionButton>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <Card><CardTitle>Nouvelle offre</CardTitle><PlanForm /></Card>
    </div>
  );
}
