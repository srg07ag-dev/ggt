import { PillTabs } from "@/components/ui/pill-tabs";
import { DocumentList } from "@/components/document-list";
import { requireUser } from "@/lib/session";
import { can } from "@/modules/core/permissions";
import { requireMembership } from "@/modules/core/tenant";
import { listContactOptions } from "@/modules/crm/contacts";
import { listDocuments } from "@/modules/sales/documents";
import { NewDraftForm } from "../documents/forms";

export const metadata = { title: "Factures" };

export default async function Invoices({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { companyId } = await params;
  const { tab } = await searchParams;
  const user = await requireUser();
  const ctx = await requireMembership(user.id, companyId, "sales:read");
  const credit = tab === "credit_notes";
  const [rows, contacts] = await Promise.all([listDocuments(user.id, companyId, credit ? "credit_note" : "invoice"), listContactOptions(user.id, companyId)]);
  const base = `/app/${companyId}/invoices`;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Factures</h1>
      {can(ctx.role, "sales:write") && !credit && (
        <details className="rounded-[var(--radius-lg)] border border-border bg-surface">
          <summary className="cursor-pointer list-none px-5 py-4 text-sm font-medium text-accent">+ Nouvelle facture</summary>
          <div className="border-t border-border p-5"><NewDraftForm companyId={companyId} type="invoice" contacts={contacts} /></div>
        </details>
      )}
      <PillTabs label="Type" tabs={[{ href: base, label: "Factures", active: !credit }, { href: `${base}?tab=credit_notes`, label: "Avoirs", active: credit }]} />
      <DocumentList companyId={companyId} rows={rows} empty={credit ? "Un avoir se crée depuis une facture émise." : "Créez votre première facture pour un client."} />
    </div>
  );
}
