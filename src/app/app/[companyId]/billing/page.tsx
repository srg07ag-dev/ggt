import { ActionButton } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { withAccess } from "@/lib/with-access";
import { getBillingView } from "@/modules/billing/subscriptions";
import { MODULE_LABELS, type Limits, type Module } from "@/modules/core/entitlements";
import { cancelRequestAction, cancelSubscriptionAction, requestPlanAction, resumeSubscriptionAction } from "./actions";

export const metadata = { title: "Abonnement" };

const STATE: Record<string, ["neutral" | "accent" | "success" | "warning" | "danger", string]> = {
  unmanaged: ["success", "Accès complet"], trialing: ["accent", "Période d'essai"], active: ["success", "Actif"], past_due: ["warning", "Paiement en retard"], expired: ["danger", "Expiré"], suspended: ["danger", "Suspendu"],
};
const REASONS: Record<string, string> = {
  module: "Ce module n'est pas inclus dans votre offre.",
  readonly: "Votre abonnement a expiré ou votre compte est suspendu : l'entreprise est en lecture seule.",
  limit: "Vous avez atteint une limite de votre offre.",
};
const INTERVAL = { month: "mois", year: "an" } as const;
const lim = (v: number | null | undefined) => (v == null ? "illimité" : String(v));

async function Billing({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<{ reason?: string }> }) {
  const { companyId } = await params;
  const { reason } = await searchParams;
  const user = await requireUser();
  const v = await getBillingView(user.id, companyId);
  const fmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" });
  const limits = v.access.limits as Limits;
  const open = v.invoices.filter((i) => i.inv.status === "open");
  const st = STATE[v.access.state] ?? STATE.unmanaged!;
  const bar = (used: number, max: number | null | undefined) => (max ? Math.min(100, Math.round((used / max) * 100)) : 0);
  const storageMb = v.usage.storageBytes / 1048576;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Abonnement</h1>
        <p className="text-sm text-muted">Offre, usage et factures de GGT pour cette entreprise.</p>
      </div>
      {reason && REASONS[reason] && <p role="status" className="rounded-[var(--radius)] border border-warning bg-warning-soft px-4 py-3 text-sm text-warning">{REASONS[reason]}</p>}

      {!v.billingEnabled ? (
        <Card><CardTitle>Facturation non activée</CardTitle><p className="text-sm text-muted">Toutes les fonctionnalités sont disponibles sans limite.</p></Card>
      ) : (
        <>
          <Card>
            <CardTitle>Votre offre</CardTitle>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xl font-semibold">{v.access.planName ?? "Aucune offre"}</span>
              <Badge tone={st[0]}>{st[1]}</Badge>
              {v.access.warn === "canceling" && <Badge tone="warning">Résiliation programmée</Badge>}
            </div>
            <p className="mt-2 text-sm text-muted">
              {v.access.state === "trialing" && v.access.until && `Essai jusqu'au ${fmt.format(v.access.until)}.`}
              {v.access.state === "active" && v.access.until && (v.access.cancelAtPeriodEnd ? `Accès jusqu'au ${fmt.format(v.access.until)}, sans renouvellement.` : `Période payée jusqu'au ${fmt.format(v.access.until)}.`)}
              {v.access.state === "past_due" && v.access.until && `Paiement en retard : l'accès est maintenu jusqu'au ${fmt.format(v.access.until)}.`}
              {v.access.state === "expired" && "Abonnement expiré : vos données restent consultables et exportables. Réglez une facture ou choisissez une offre pour reprendre."}
              {v.access.state === "suspended" && "Votre compte est suspendu : contactez le support."}
            </p>
            <div className="mt-4 flex flex-wrap gap-3 border-t border-border pt-4">
              {v.subscription && !v.subscription.cancelAtPeriodEnd && v.access.state === "active" && v.access.until && <ActionButton variant="secondary" confirm="Résilier ? L'accès continue jusqu'à la fin de la période payée." action={cancelSubscriptionAction.bind(null, companyId)}>Résilier à la fin de la période</ActionButton>}
              {v.subscription?.cancelAtPeriodEnd && <ActionButton variant="secondary" action={resumeSubscriptionAction.bind(null, companyId)}>Reprendre l&apos;abonnement</ActionButton>}
            </div>
          </Card>

          <Card>
            <CardTitle hint="Ce que votre offre inclut et ce que vous utilisez">Usage</CardTitle>
            <div className="space-y-4 text-sm">
              <div>
                <div className="flex justify-between"><span>Membres (invitations en attente comprises)</span><span className="num">{v.usage.members + v.usage.pendingInvitations} / {limits.members ?? "∞"}</span></div>
                {limits.members ? <div className="mt-1 h-2 rounded-full bg-surface-2"><div className="h-2 rounded-full bg-accent" style={{ width: `${bar(v.usage.members + v.usage.pendingInvitations, limits.members)}%` }} /></div> : null}
              </div>
              <div>
                <div className="flex justify-between"><span>Justificatifs</span><span className="num">{storageMb.toFixed(1)} Mo / {limits.storageMb ?? "∞"}</span></div>
                {limits.storageMb ? <div className="mt-1 h-2 rounded-full bg-surface-2"><div className="h-2 rounded-full bg-accent" style={{ width: `${bar(storageMb, limits.storageMb)}%` }} /></div> : null}
              </div>
              <p className="text-muted">Factures par mois : {lim(limits.invoicesPerMonth)} · Modules : {v.access.modules.map((m) => MODULE_LABELS[m as Module]).join(", ") || "—"}</p>
            </div>
          </Card>

          {open.length > 0 && (
            <Card className="border-warning">
              <CardTitle hint="Réglez ces factures pour activer ou prolonger votre offre.">Factures à régler</CardTitle>
              <ul className="divide-y divide-border text-sm">
                {open.map((i) => (
                  <li key={i.inv.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <span><span className="font-medium">{i.inv.number}</span> · {i.planName}<span className="block text-xs text-muted">Période du {fmt.format(i.inv.periodStart)} au {fmt.format(i.inv.periodEnd)} · à régler avant le {fmt.format(i.inv.dueAt)}</span></span>
                    <span className="num font-semibold">{formatMoney(i.inv.amountMinor, i.inv.currency)}</span>
                  </li>
                ))}
              </ul>
              {v.paymentInstructions && <p className="mt-3 whitespace-pre-line rounded-[var(--radius-sm)] bg-surface-2 p-3 text-sm">{v.paymentInstructions}</p>}
              <p className="mt-2 text-xs text-muted">Indiquez le numéro de facture dans la référence de votre paiement. L&apos;offre est activée dès que le paiement est constaté.</p>
              <div className="mt-3"><ActionButton variant="secondary" action={cancelRequestAction.bind(null, companyId)}>Annuler cette demande</ActionButton></div>
            </Card>
          )}

          <div>
            <h2 className="mb-3 text-sm font-semibold">Offres disponibles</h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {v.plans.map((p) => {
                const current = v.access.planId === p.id && v.access.state !== "expired";
                const l = p.limits as Limits;
                return (
                  <Card key={p.id} className={current ? "border-accent" : ""}>
                    <h3 className="text-base font-semibold">{p.name}</h3>
                    <p className="num mt-1 text-2xl font-semibold">{p.priceMinor === 0 ? "Gratuit" : formatMoney(p.priceMinor, p.currency)}{p.priceMinor > 0 && <span className="text-sm font-normal text-muted"> / {INTERVAL[p.interval]}</span>}</p>
                    {p.description && <p className="mt-1 text-sm text-muted">{p.description}</p>}
                    <ul className="mt-3 space-y-1 text-sm text-muted">
                      <li>{p.modules.map((m) => MODULE_LABELS[m as Module]).join(", ")}</li>
                      <li>Membres : {lim(l.members)} · Factures/mois : {lim(l.invoicesPerMonth)}</li>
                      <li>Justificatifs : {l.storageMb == null ? "illimité" : `${l.storageMb} Mo`}</li>
                      {p.trialDays > 0 && <li>{p.trialDays} jours d&apos;essai</li>}
                    </ul>
                    <div className="mt-4">{current ? <Badge tone="accent">Offre actuelle</Badge> : <ActionButton action={requestPlanAction.bind(null, companyId, p.id)}>{p.priceMinor === 0 ? "Passer à cette offre" : "Choisir cette offre"}</ActionButton>}</div>
                  </Card>
                );
              })}
            </div>
          </div>

          {v.invoices.length > 0 && (
            <Card>
              <CardTitle>Historique des factures</CardTitle>
              <ul className="divide-y divide-border text-sm">
                {v.invoices.map((i) => (
                  <li key={i.inv.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <span><span className="font-medium">{i.inv.number}</span> · {i.planName}<span className="block text-xs text-muted">{fmt.format(i.inv.periodStart)} → {fmt.format(i.inv.periodEnd)}</span></span>
                    <span className="flex items-center gap-3"><span className="num">{formatMoney(i.inv.amountMinor, i.inv.currency)}</span><Badge tone={i.inv.status === "paid" ? "success" : i.inv.status === "open" ? "warning" : "neutral"}>{i.inv.status === "paid" ? "Payée" : i.inv.status === "open" ? "À régler" : "Annulée"}</Badge></span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

export default withAccess(Billing);
