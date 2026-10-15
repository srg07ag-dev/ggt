import { BookOpen } from "lucide-react";
import { ActionButton } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUser } from "@/lib/session";
import { withAccess } from "@/lib/with-access";
import { can } from "@/modules/core/permissions";
import { requireMembership } from "@/modules/core/tenant";
import { listLedgerAccounts, TYPE_LABELS } from "@/modules/accounting/chart";
import { archiveAccountAction } from "../actions";
import { AccountForm, ImportChart } from "../forms";

export const metadata = { title: "Plan de comptes" };

async function Accounts({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const user = await requireUser();
  const ctx = await requireMembership(user.id, companyId, "accounting:read");
  const rows = await listLedgerAccounts(user.id, companyId, { includeArchived: true });
  const canWrite = can(ctx.role, "accounting:write");
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Plan de comptes</h1>
      {rows.length === 0 ? (
        <EmptyState icon={<BookOpen className="size-6" />} title="Aucun compte" description="Importez le plan de comptes de votre référentiel (CSV fourni par votre comptable) ou ajoutez vos comptes un par un." />
      ) : (
        <div className="overflow-x-auto border-y border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-muted"><tr><th className="px-4 py-3 font-medium">Code</th><th className="px-4 py-3 font-medium">Libellé</th><th className="px-4 py-3 font-medium">Type</th><th className="px-4 py-3" /></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-b border-border last:border-0">
                  <td className="num px-4 py-2.5 font-medium">{a.code}</td>
                  <td className={`px-4 py-2.5 ${a.archivedAt ? "text-muted line-through" : ""}`}>{a.name}</td>
                  <td className="px-4 py-2.5"><Badge tone="neutral">{TYPE_LABELS[a.type]}</Badge>{a.archivedAt && <span className="ml-2"><Badge tone="warning">Archivé</Badge></span>}</td>
                  <td className="px-4 py-2.5 text-right">{canWrite && <ActionButton variant="secondary" action={archiveAccountAction.bind(null, companyId, a.id, !a.archivedAt)}>{a.archivedAt ? "Restaurer" : "Archiver"}</ActionButton>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canWrite && (
        <>
          <Card><CardTitle hint="Le code et le type ne pourront plus être modifiés une fois le compte créé.">Nouveau compte</CardTitle><AccountForm companyId={companyId} /></Card>
          <Card><CardTitle>Importer un plan de comptes (CSV)</CardTitle><ImportChart companyId={companyId} /></Card>
        </>
      )}
    </div>
  );
}

export default withAccess(Accounts);
