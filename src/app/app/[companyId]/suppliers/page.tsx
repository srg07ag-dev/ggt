import { Truck } from "lucide-react";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUser } from "@/lib/session";
import { can } from "@/modules/core/permissions";
import { requireMembership } from "@/modules/core/tenant";
import { listSuppliers } from "@/modules/finance/finance";
import { archiveSupplierAction } from "../finance-actions";
import { SupplierForm } from "../finance-forms";
import { withAccess } from "@/lib/with-access";

export const metadata = { title: "Fournisseurs" };

async function Suppliers({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const user = await requireUser();
  const ctx = await requireMembership(user.id, companyId, "finance:read");
  const rows = await listSuppliers(user.id, companyId);
  const canWrite = can(ctx.role, "finance:write");
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Fournisseurs</h1>
      {rows.length === 0 ? (
        <EmptyState icon={<Truck className="size-6" />} title="Aucun fournisseur" description="Ajoutez vos fournisseurs pour les associer à vos dépenses." />
      ) : (
        <ul className="divide-y divide-border rounded-[var(--radius-lg)] border border-border bg-surface">
          {rows.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
              <span><span className="font-medium">{s.name}</span><span className="block text-xs text-muted">{[s.email, s.phone, s.taxId].filter(Boolean).join(" · ")}</span></span>
              {canWrite && <form action={archiveSupplierAction.bind(null, companyId, s.id)}><button className="text-xs text-muted hover:text-danger" aria-label={`Archiver ${s.name}`}>Archiver</button></form>}
            </li>
          ))}
        </ul>
      )}
      {canWrite && <Card><CardTitle>Nouveau fournisseur</CardTitle><SupplierForm companyId={companyId} /></Card>}
    </div>
  );
}

export default withAccess(Suppliers);
