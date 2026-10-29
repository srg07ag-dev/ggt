import { ActionButton } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/session";
import { withAccess } from "@/lib/with-access";
import { can } from "@/modules/core/permissions";
import { requireMembership } from "@/modules/core/tenant";
import { listPeriods } from "@/modules/accounting/periods";
import { closePeriodAction } from "../actions";
import { PeriodForm, ReopenForm } from "../forms";

export const metadata = { title: "Périodes comptables" };

async function Periods({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const user = await requireUser();
  const ctx = await requireMembership(user.id, companyId, "accounting:read");
  const rows = await listPeriods(user.id, companyId);
  const canWrite = can(ctx.role, "accounting:write");
  const owner = can(ctx.role, "company:manage");
  const last = rows[rows.length - 1];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Périodes comptables</h1>
        <p className="text-sm text-muted">Une période clôturée verrouille ses écritures. Seul le propriétaire peut la rouvrir, avec un motif conservé dans le journal d&apos;audit.</p>
      </div>
      {rows.length > 0 && (
        <ul className="divide-y divide-border rounded-[var(--radius-lg)] bg-surface shadow-card">
          {rows.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm">
              <span><span className="font-medium">{p.name}</span><span className="num block text-xs text-muted">{p.startDate} → {p.endDate}</span></span>
              <span className="flex flex-wrap items-center gap-3">
                <Badge tone={p.status === "open" ? "success" : "neutral"}>{p.status === "open" ? "Ouverte" : "Clôturée"}</Badge>
                {canWrite && p.status === "open" && <ActionButton variant="secondary" confirm="Clôturer cette période ? Ses écritures seront verrouillées." action={closePeriodAction.bind(null, companyId, p.id)}>Clôturer</ActionButton>}
                {owner && p.status === "closed" && <ReopenForm companyId={companyId} id={p.id} />}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canWrite && <Card><CardTitle>Nouvelle période</CardTitle><PeriodForm companyId={companyId} suggestedYear={last ? Number(last.endDate.slice(0, 4)) + 1 : new Date().getUTCFullYear()} /></Card>}
    </div>
  );
}

export default withAccess(Periods);
