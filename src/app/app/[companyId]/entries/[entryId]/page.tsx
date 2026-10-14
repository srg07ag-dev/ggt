import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { ActionButton } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { formatMoney } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { can } from "@/modules/core/permissions";
import { requireMembership, withTenant } from "@/modules/core/tenant";
import { listAttachments } from "@/modules/finance/finance";
import { deleteAttachmentAction, voidEntryAction } from "../../finance-actions";
import { UploadForm } from "../../finance-forms";
import { withAccess } from "@/lib/with-access";

async function EntryPage({ params }: { params: Promise<{ companyId: string; entryId: string }> }) {
  const { companyId, entryId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(entryId)) notFound();
  const user = await requireUser();
  const ctx = await requireMembership(user.id, companyId, "finance:read");
  const found = await withTenant(ctx, async (tx) => {
    const [e] = await tx
      .select({
        entry: schema.financeEntry,
        account: schema.financeAccount.name,
        category: schema.financeCategory.name,
        supplier: schema.supplier.name,
        contact: schema.contact.name,
      })
      .from(schema.financeEntry)
      .innerJoin(schema.financeAccount, and(eq(schema.financeAccount.id, schema.financeEntry.accountId), eq(schema.financeAccount.companyId, schema.financeEntry.companyId)))
      .leftJoin(schema.financeCategory, and(eq(schema.financeCategory.id, schema.financeEntry.categoryId), eq(schema.financeCategory.companyId, schema.financeEntry.companyId)))
      .leftJoin(schema.supplier, and(eq(schema.supplier.id, schema.financeEntry.supplierId), eq(schema.supplier.companyId, schema.financeEntry.companyId)))
      .leftJoin(schema.contact, and(eq(schema.contact.id, schema.financeEntry.contactId), eq(schema.contact.companyId, schema.financeEntry.companyId)))
      .where(eq(schema.financeEntry.id, entryId));
    return e;
  });
  if (!found) notFound();
  const { entry } = found;
  const [files, [co]] = await Promise.all([listAttachments(user.id, companyId, entryId), db.select({ currency: schema.company.currency }).from(schema.company).where(eq(schema.company.id, companyId))]);
  const canWrite = can(ctx.role, "finance:write");
  const money = (n: number) => formatMoney(n, co!.currency);
  const expense = entry.kind === "expense";
  const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} Ko` : `${(n / 1048576).toFixed(1)} Mo`);

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/app/${companyId}/${expense ? "expenses" : "income"}`} className="text-sm text-muted hover:text-accent">← {expense ? "Dépenses" : "Recettes"}</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{entry.description}</h1>
          {entry.voidedAt && <Badge tone="warning">Annulée</Badge>}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardTitle>Justificatifs</CardTitle>
          {files.length === 0 ? (
            <p className="text-sm text-muted">Aucun justificatif joint.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {files.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <a href={`/app/${companyId}/attachments/${f.id}`} className="inline-flex items-center gap-2 font-medium hover:text-accent"><Download className="size-4" aria-hidden />{f.filename}</a>
                  <span className="flex items-center gap-3 text-xs text-muted">
                    {kb(f.sizeBytes)} · empreinte {f.sha256.slice(0, 8)}
                    {canWrite && <ActionButton variant="secondary" confirm="Supprimer ce justificatif ?" action={deleteAttachmentAction.bind(null, companyId, f.id)}>Supprimer</ActionButton>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {canWrite && <div className="mt-4 border-t border-border pt-4"><UploadForm companyId={companyId} entryId={entry.id} /></div>}
        </Card>
        <div className="space-y-4">
          <Card>
            <CardTitle>Détails</CardTitle>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Date</dt><dd className="num">{entry.occurredOn}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Montant{expense ? " TTC" : ""}</dt><dd className="num font-semibold">{money(entry.amountMinor)}</dd></div>
              {expense && <div className="flex justify-between"><dt className="text-muted">Dont taxe</dt><dd className="num">{money(entry.taxMinor)}</dd></div>}
              <div className="flex justify-between"><dt className="text-muted">Compte</dt><dd>{found.account}</dd></div>
              {found.category && <div className="flex justify-between"><dt className="text-muted">Catégorie</dt><dd>{found.category}</dd></div>}
              {(found.supplier || found.contact) && <div className="flex justify-between"><dt className="text-muted">{expense ? "Fournisseur" : "Client"}</dt><dd>{found.supplier ?? found.contact}</dd></div>}
              {entry.reference && <div className="flex justify-between"><dt className="text-muted">Référence</dt><dd>{entry.reference}</dd></div>}
            </dl>
            {canWrite && !entry.voidedAt && (
              <div className="mt-4 border-t border-border pt-4">
                <ActionButton variant="danger" confirm="Annuler cette opération ? Elle restera visible, mais ne comptera plus." action={voidEntryAction.bind(null, companyId, entry.id)}>Annuler l&apos;opération</ActionButton>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

export default withAccess(EntryPage);
