import { DocumentList } from "@/components/document-list";
import { requireUser } from "@/lib/session";
import { can } from "@/modules/core/permissions";
import { requireMembership } from "@/modules/core/tenant";
import { listContactOptions } from "@/modules/crm/contacts";
import { listDocuments } from "@/modules/sales/documents";
import { NewDraftForm } from "../documents/forms";
import { withAccess } from "@/lib/with-access";

export const metadata = { title: "Devis" };

async function Quotes({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const user = await requireUser();
  const ctx = await requireMembership(user.id, companyId, "sales:read");
  const [rows, contacts] = await Promise.all([listDocuments(user.id, companyId, "quote"), listContactOptions(user.id, companyId)]);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Devis</h1>
      {can(ctx.role, "sales:write") && (
        <details className="border-y border-border">
          <summary className="cursor-pointer list-none px-5 py-4 text-sm font-medium text-accent">+ Nouveau devis</summary>
          <div className="border-t border-border p-5"><NewDraftForm companyId={companyId} type="quote" contacts={contacts} /></div>
        </details>
      )}
      <DocumentList companyId={companyId} rows={rows} empty="Créez un devis, envoyez-le, puis convertissez-le en facture quand il est accepté." />
    </div>
  );
}

export default withAccess(Quotes);
