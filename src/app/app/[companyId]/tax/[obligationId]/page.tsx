import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { todayIn } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { withAccess } from "@/lib/with-access";
import { can } from "@/modules/core/permissions";
import { getCompanyProfile } from "@/modules/core/settings";
import { requireMembership } from "@/modules/core/tenant";
import { getObligation, obligationState } from "@/modules/tax/obligations";
import { deleteObligationAction, notApplicableAction } from "../actions";
import { EventForm } from "../forms";
import { STATE_BADGES } from "../badges";

const KIND: Record<string, string> = { filed: "Déclaration déposée", paid: "Paiement effectué", note: "Note" };

async function ObligationPage({ params }: { params: Promise<{ companyId: string; obligationId: string }> }) {
  const { companyId, obligationId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(obligationId)) notFound();
  const user = await requireUser();
  const ctx = await requireMembership(user.id, companyId, "tax:read");
  const got = await getObligation(user.id, companyId, obligationId);
  if (!got) notFound();
  const company = await getCompanyProfile(user.id, companyId);
  const today = todayIn(company.timezone);
  const { obligation: o, events } = got;
  const st = STATE_BADGES[obligationState(o, today)];
  const canWrite = can(ctx.role, "tax:write");
  return (
    <div className="space-y-6">
      <div>
        <Link href={`/app/${companyId}/tax`} className="text-sm text-muted hover:text-accent">← Fiscalité</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold tracking-tight">{o.title}</h1><Badge tone={st[0]}>{st[1]}</Badge></div>
        <p className="mt-1 text-sm text-muted">Échéance <span className="num">{o.dueDate}</span>{[o.authority, o.periodLabel].filter(Boolean).map((x) => ` · ${x}`).join("")}</p>
      </div>
      <Card>
        <CardTitle hint="En ajout seul : une ligne enregistrée ne peut plus être modifiée.">Historique</CardTitle>
        {events.length === 0 ? <p className="text-sm text-muted">Aucun événement enregistré.</p> : (
          <ul className="divide-y divide-border text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span><span className="font-medium">{KIND[e.kind] ?? e.kind}</span><span className="block text-xs text-muted">{[e.reference, e.notes].filter(Boolean).join(" · ")}</span></span>
                <span className="num text-muted">{e.occurredOn}{e.amountMinor !== null && ` · ${formatMoney(e.amountMinor, company.currency)}`}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {canWrite && o.status !== "not_applicable" && <Card><CardTitle>Enregistrer un événement</CardTitle><EventForm companyId={companyId} obligationId={o.id} today={today} currency={company.currency} /></Card>}
      {canWrite && (
        <div className="flex flex-wrap gap-3">
          {o.status === "todo" && <ActionButton variant="secondary" action={notApplicableAction.bind(null, companyId, o.id, true)}>Marquer non applicable</ActionButton>}
          {o.status === "not_applicable" && <ActionButton variant="secondary" action={notApplicableAction.bind(null, companyId, o.id, false)}>Rétablir</ActionButton>}
          {events.length === 0 && <ActionButton variant="danger" confirm="Supprimer cette échéance ?" action={deleteObligationAction.bind(null, companyId, o.id)}>Supprimer</ActionButton>}
        </div>
      )}
    </div>
  );
}

export default withAccess(ObligationPage);
