import Link from "next/link";
import { Kanban } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PillTabs } from "@/components/ui/pill-tabs";
import { formatMoney } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { can } from "@/modules/core/permissions";
import { requireMembership } from "@/modules/core/tenant";
import { listContactOptions } from "@/modules/crm/contacts";
import { listOpportunities, listStages } from "@/modules/crm/pipeline";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { moveOpportunityAction } from "./actions";
import { OpportunityForm } from "./opportunity-form";
import { withAccess } from "@/lib/with-access";

export const metadata = { title: "Pipeline" };

async function Pipeline({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { companyId } = await params;
  const { view } = await searchParams;
  const user = await requireUser();
  const ctx = await requireMembership(user.id, companyId, "crm:read");
  const [stages, opps, contacts, [company]] = await Promise.all([
    listStages(user.id, companyId),
    listOpportunities(user.id, companyId),
    listContactOptions(user.id, companyId),
    db.select({ currency: schema.company.currency }).from(schema.company).where(eq(schema.company.id, companyId)),
  ]);
  const currency = company!.currency;
  const canWrite = can(ctx.role, "crm:write");
  const base = `/app/${companyId}/pipeline`;
  const table = view === "table";
  const fmt = (n: number) => formatMoney(n, currency);

  const Move = ({ id, stageId }: { id: string; stageId: string }) =>
    canWrite ? (
      <form action={moveOpportunityAction.bind(null, companyId, id)} className="flex gap-1">
        <select name="stageId" defaultValue={stageId} aria-label="Étape" className="h-8 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-border bg-surface px-2 text-xs">
          {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button className="h-8 rounded-[var(--radius-sm)] border border-border-strong px-3 text-xs hover:bg-surface-2">OK</button>
      </form>
    ) : null;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Pipeline commercial</h1>
      {canWrite && contacts.length > 0 && (
        <details className="border-y border-border">
          <summary className="cursor-pointer list-none px-5 py-4 text-sm font-medium text-accent">+ Nouvelle opportunité</summary>
          <div className="border-t border-border p-5"><OpportunityForm companyId={companyId} currency={currency} contacts={contacts} /></div>
        </details>
      )}
      <PillTabs label="Vue" tabs={[
        { href: base, label: "Kanban", active: !table },
        { href: `${base}?view=table`, label: "Tableau", count: opps.length, active: table },
      ]} />

      {opps.length === 0 ? (
        <EmptyState
          icon={<Kanban className="size-6" />}
          title="Aucune opportunité"
          description={contacts.length === 0 ? "Ajoutez d'abord un contact, puis créez une opportunité pour le suivre dans le pipeline." : "Créez votre première opportunité pour suivre vos ventes."}
          action={contacts.length === 0 ? <Link className="text-sm font-medium text-accent" href={`/app/${companyId}/contacts`}>Ajouter un contact</Link> : undefined}
        />
      ) : table ? (
        <div className="overflow-x-auto border-y border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-muted">
              <tr>{["Opportunité", "Client", "Étape", "Montant", "Probabilité", "Clôture"].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {opps.map((o) => {
                const st = stages.find((s) => s.id === o.stageId)!;
                return (
                  <tr key={o.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-medium">{o.title}</td>
                    <td className="px-4 py-3 text-muted">{o.contactName}</td>
                    <td className="px-4 py-3"><Badge tone={st.kind === "won" ? "success" : st.kind === "lost" ? "danger" : "accent"}>{st.name}</Badge></td>
                    <td className="num px-4 py-3">{fmt(o.amountMinor)}</td>
                    <td className="num px-4 py-3">{o.probability} %</td>
                    <td className="num px-4 py-3 text-muted">{o.expectedClose ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {stages.map((s) => {
            const col = opps.filter((o) => o.stageId === s.id);
            const total = col.reduce((n, o) => n + o.amountMinor, 0);
            return (
              <section key={s.id} aria-label={s.name} className="w-64 shrink-0 space-y-3 rounded-[var(--radius-lg)] bg-surface-2 p-3">
                <header className="flex items-center justify-between px-1">
                  <h3>{s.name}</h3>
                  <span className="num text-xs text-muted">{col.length}</span>
                </header>
                <p className="num px-1 text-xs text-muted">{fmt(total)}</p>
                {col.map((o) => (
                  <article key={o.id} className="space-y-2 rounded-[var(--radius)] border border-border bg-surface p-3">
                    <p className="text-sm font-medium">{o.title}</p>
                    <Link href={`/app/${companyId}/contacts/${o.contactId}`} className="block text-xs text-muted hover:text-accent">{o.contactName}</Link>
                    <p className="num text-sm">{fmt(o.amountMinor)} <span className="text-xs text-muted">· {o.probability} %</span></p>
                    <Move id={o.id} stageId={o.stageId} />
                  </article>
                ))}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default withAccess(Pipeline);
