import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { getCompanyAdmin } from "@/modules/billing/admin";
import { listPublicPlans } from "@/modules/billing/plans";
import { ROLE_LABELS } from "@/modules/core/permissions";
import { voidInvoiceAction } from "../../actions";
import { GrantForm, MarkPaidForm, SuspendForm, TrialForm } from "../../forms";

export const metadata = { title: "Entreprise" };

export default async function CompanyAdmin({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(companyId)) notFound();
  const user = await requireUser();
  const d = await getCompanyAdmin(user.id, companyId);
  if (!d) notFound();
  const plans = await listPublicPlans();
  const fmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" });
  const a = d.access;
  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/companies" className="text-sm text-muted hover:text-accent">← Entreprises</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold tracking-tight">{d.company.name}</h1><Badge tone={a.state === "suspended" || a.state === "expired" ? "danger" : a.state === "past_due" ? "warning" : "success"}>{a.state}</Badge></div>
        <p className="mt-1 text-sm text-muted">{d.company.country} · {d.company.currency} · créée le {fmt.format(d.company.createdAt)} · offre : {a.planName ?? "—"}{a.until && ` · jusqu'au ${fmt.format(a.until)}`}</p>
        {d.subscription?.suspendedReason && <p className="mt-1 text-sm text-danger">Suspension : {d.subscription.suspendedReason}</p>}
      </div>
      <Card>
        <CardTitle hint="Rôles uniquement : aucune donnée métier n'est accessible depuis l'administration.">Membres</CardTitle>
        <ul className="divide-y divide-border text-sm">{d.members.map((m) => <li key={m.email} className="flex justify-between py-2"><span>{m.name} <span className="text-muted">· {m.email}</span></span><Badge tone="neutral">{ROLE_LABELS[m.role]}</Badge></li>)}</ul>
      </Card>
      {d.subscription ? (
        <>
          <Card><CardTitle hint="Geste commercial : période payée à 0, tracée avec son motif.">Offre gracieuse</CardTitle><GrantForm companyId={companyId} plans={plans.map((p) => ({ id: p.id, name: p.name }))} /></Card>
          <Card><CardTitle>Période d&apos;essai</CardTitle><TrialForm companyId={companyId} /></Card>
          <Card><CardTitle hint="La suspension met l'entreprise en lecture seule (données consultables et exportables).">Suspension</CardTitle><SuspendForm companyId={companyId} suspended={Boolean(d.subscription.suspendedAt)} /></Card>
        </>
      ) : <Card><p className="text-sm text-muted">Cette entreprise n&apos;a pas d&apos;abonnement (créée avant l&apos;activation de la facturation) : accès complet. Vous pouvez lui accorder une offre gracieuse en lui créant un abonnement via une facture, ou la laisser ainsi.</p></Card>}
      <Card>
        <CardTitle>Factures d&apos;abonnement</CardTitle>
        {d.invoices.length === 0 ? <p className="text-sm text-muted">Aucune facture.</p> : (
          <ul className="divide-y divide-border text-sm">
            {d.invoices.map(({ inv, planName }) => (
              <li key={inv.id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span><span className="font-medium">{inv.number}</span> · {planName}<span className="block text-xs text-muted">{fmt.format(inv.periodStart)} → {fmt.format(inv.periodEnd)}{inv.paymentMethod ? ` · ${inv.paymentMethod}${inv.paymentReference ? ` (${inv.paymentReference})` : ""}` : ""}</span></span>
                  <span className="flex items-center gap-3"><span className="num">{formatMoney(inv.amountMinor, inv.currency)}</span><Badge tone={inv.status === "paid" ? "success" : inv.status === "open" ? "warning" : "neutral"}>{inv.status === "paid" ? "Payée" : inv.status === "open" ? "À régler" : "Annulée"}</Badge></span>
                </div>
                {inv.status === "open" && (
                  <div className="space-y-2 rounded-[var(--radius-sm)] bg-surface-2 p-3">
                    <MarkPaidForm invoiceId={inv.id} />
                    <ActionButton variant="secondary" confirm="Annuler cette facture ?" action={voidInvoiceAction.bind(null, inv.id)}>Annuler la facture</ActionButton>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
