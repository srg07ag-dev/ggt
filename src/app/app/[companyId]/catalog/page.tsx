import { Package } from "lucide-react";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatMoney } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { can } from "@/modules/core/permissions";
import { requireMembership } from "@/modules/core/tenant";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { formatRate } from "@/modules/sales/calc";
import { listProducts, listTaxRates } from "@/modules/sales/catalog";
import { archiveProductAction, archiveTaxRateAction } from "./actions";
import { ProductForm, TaxRateForm } from "./forms";
import { withAccess } from "@/lib/with-access";

export const metadata = { title: "Catalogue" };

async function Catalog({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const user = await requireUser();
  const ctx = await requireMembership(user.id, companyId, "sales:read");
  const [products, taxes, [co]] = await Promise.all([
    listProducts(user.id, companyId),
    listTaxRates(user.id, companyId),
    db.select({ currency: schema.company.currency }).from(schema.company).where(eq(schema.company.id, companyId)),
  ]);
  const canWrite = can(ctx.role, "sales:write");
  const canManage = can(ctx.role, "company:manage");
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Produits et services</h1>
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardTitle>Catalogue</CardTitle>
          {products.length === 0 ? (
            <EmptyState icon={<Package className="size-6" />} title="Catalogue vide" description="Ajoutez vos produits et services pour les réutiliser dans vos devis et factures." />
          ) : (
            <ul className="divide-y divide-border text-sm">
              {products.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span>
                    <span className="font-medium">{p.name}</span>
                    <span className="block text-xs text-muted">{p.kind === "service" ? "Service" : "Produit"}{p.taxName ? ` · ${p.taxName} ${formatRate(p.taxRateBp ?? 0)}` : ""}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="num">{formatMoney(p.unitPriceMinor, co!.currency)}</span>
                    {canWrite && <form action={archiveProductAction.bind(null, companyId, p.id)}><button className="text-xs text-muted hover:text-danger" aria-label={`Archiver ${p.name}`}>Archiver</button></form>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {canWrite && (
            <details className="mt-4 border-t border-border pt-4">
              <summary className="cursor-pointer text-sm font-medium text-accent">+ Nouveau produit ou service</summary>
              <div className="pt-4"><ProductForm companyId={companyId} currency={co!.currency} taxes={taxes} /></div>
            </details>
          )}
        </Card>
        <Card>
          <CardTitle hint="Les taux dépendent de la réglementation de votre pays : saisissez ceux qui vous sont applicables.">Taxes</CardTitle>
          {taxes.length === 0 ? (
            <p className="text-sm text-muted">Aucune taxe définie. Vos lignes seront sans taxe tant que vous n&apos;en ajoutez pas.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {taxes.map((t) => (
                <li key={t.id} className="flex items-center justify-between py-2">
                  <span>{t.name} <span className="num text-muted">{formatRate(t.rateBp)}</span></span>
                  {canManage && <form action={archiveTaxRateAction.bind(null, companyId, t.id)}><button className="text-xs text-muted hover:text-danger" aria-label={`Archiver ${t.name}`}>Archiver</button></form>}
                </li>
              ))}
            </ul>
          )}
          {canManage && <div className="mt-4 border-t border-border pt-4"><TaxRateForm companyId={companyId} /></div>}
        </Card>
      </div>
    </div>
  );
}

export default withAccess(Catalog);
