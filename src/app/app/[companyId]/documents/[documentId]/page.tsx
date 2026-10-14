import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { ActionButton } from "@/components/action-form";
import { Card, CardTitle } from "@/components/ui/card";
import { formatMoney, formatPlain } from "@/lib/money";
import { todayIn } from "@/lib/dates";
import { requireUser } from "@/lib/session";
import { can } from "@/modules/core/permissions";
import { requireMembership } from "@/modules/core/tenant";
import { formatRate } from "@/modules/sales/calc";
import { listProducts, listTaxRates } from "@/modules/sales/catalog";
import { getDocument } from "@/modules/sales/documents";
import {
  convertAction,
  creditNoteAction,
  deleteDraftAction,
  issueAction,
  quoteDecisionAction,
  removeLineAction,
  sendQuoteAction,
  voidPaymentAction,
} from "../actions";
import { AddLineForm, MetaForm, PaymentForm } from "../forms";
import { METHOD_LABELS } from "../labels";
import { DocStatusBadge } from "../status";

const TITLES = { quote: "Devis", invoice: "Facture", credit_note: "Avoir" } as const;

export default async function DocumentPage({ params }: { params: Promise<{ companyId: string; documentId: string }> }) {
  const { companyId, documentId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) notFound();
  const user = await requireUser();
  const ctx = await requireMembership(user.id, companyId, "sales:read");
  const d = await getDocument(user.id, companyId, documentId);
  if (!d) notFound();
  const { doc, lines, payments, contact, settlement, company } = d;
  const canWrite = can(ctx.role, "sales:write");
  const draft = doc.status === "draft";
  const money = (n: number) => formatMoney(n, doc.currency);
  const [products, taxes] = canWrite && draft ? await Promise.all([listProducts(user.id, companyId), listTaxRates(user.id, companyId)]) : [[], []];
  const back = doc.type === "quote" ? "quotes" : "invoices";
  const title = doc.number ?? `${TITLES[doc.type]} (brouillon)`;

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/app/${companyId}/${back}`} className="text-sm text-muted hover:text-accent">← {doc.type === "quote" ? "Devis" : "Factures"}</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <DocStatusBadge type={doc.type} status={doc.status} settlement={settlement} />
        </div>
        <p className="mt-1 text-sm text-muted">
          {TITLES[doc.type]} · <Link className="hover:text-accent" href={`/app/${companyId}/contacts/${contact.id}`}>{contact.name}</Link>
          {d.related && <> · liée à <Link className="hover:text-accent" href={`/app/${companyId}/documents/${d.related.id}`}>{d.related.number ?? "brouillon"}</Link></>}
        </p>
      </div>

      <div className="flex flex-wrap items-start gap-3">
        <a href={`/app/${companyId}/documents/${doc.id}/pdf`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-border-strong bg-surface px-4 text-sm font-medium hover:bg-surface-2">
          <Download className="size-4" aria-hidden /> PDF
        </a>
        {canWrite && draft && doc.type === "quote" && <ActionButton action={sendQuoteAction.bind(null, companyId, doc.id)}>Envoyer le devis</ActionButton>}
        {canWrite && draft && doc.type !== "quote" && (
          <ActionButton action={issueAction.bind(null, companyId, doc.id)} confirm="Une fois émis, le document est numéroté et ne peut plus être modifié. Continuer ?">
            {doc.type === "invoice" ? "Émettre la facture" : "Émettre l'avoir"}
          </ActionButton>
        )}
        {canWrite && doc.type === "quote" && doc.status === "sent" && (
          <>
            <ActionButton action={quoteDecisionAction.bind(null, companyId, doc.id, "accepted")}>Marquer accepté</ActionButton>
            <ActionButton variant="secondary" action={quoteDecisionAction.bind(null, companyId, doc.id, "declined")}>Marquer refusé</ActionButton>
          </>
        )}
        {canWrite && doc.type === "quote" && doc.status === "accepted" && <ActionButton action={convertAction.bind(null, companyId, doc.id)}>Convertir en facture</ActionButton>}
        {canWrite && doc.type === "invoice" && doc.status === "issued" && (
          <ActionButton variant="secondary" action={creditNoteAction.bind(null, companyId, doc.id)}>Créer un avoir</ActionButton>
        )}
        {canWrite && draft && (
          <ActionButton variant="danger" action={deleteDraftAction.bind(null, companyId, doc.id, back)} confirm="Supprimer ce brouillon ?">Supprimer le brouillon</ActionButton>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Card>
            <CardTitle>Lignes</CardTitle>
            {lines.length === 0 ? (
              <p className="text-sm text-muted">Aucune ligne pour l&apos;instant.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted">
                    <tr>
                      <th className="py-2 font-medium">Description</th>
                      <th className="py-2 text-right font-medium">Qté</th>
                      <th className="py-2 text-right font-medium">Prix HT</th>
                      <th className="py-2 text-right font-medium">Taxe</th>
                      <th className="py-2 text-right font-medium">Total HT</th>
                      {canWrite && draft && <th className="w-8" />}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.id} className="border-t border-border">
                        <td className="py-2 pr-2">{l.description}</td>
                        <td className="num py-2 text-right">{l.quantityMilli / 1000}</td>
                        <td className="num py-2 text-right">{money(l.unitPriceMinor)}</td>
                        <td className="num py-2 text-right text-muted">{l.taxRateBp ? formatRate(l.taxRateBp) : "—"}</td>
                        <td className="num py-2 text-right">{money(l.netMinor)}</td>
                        {canWrite && draft && (
                          <td className="py-2 text-right">
                            <form action={removeLineAction.bind(null, companyId, doc.id, l.id)}>
                              <button aria-label={`Supprimer la ligne ${l.description}`} className="text-muted hover:text-danger">✕</button>
                            </form>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {canWrite && draft && (
              <details className="mt-4 border-t border-border pt-4" open={lines.length === 0}>
                <summary className="cursor-pointer text-sm font-medium text-accent">+ Ajouter une ligne</summary>
                <div className="pt-4"><AddLineForm companyId={companyId} docId={doc.id} products={products} taxes={taxes} /></div>
              </details>
            )}
          </Card>

          {doc.type === "invoice" && doc.status === "issued" && (
            <Card>
              <CardTitle hint="Une facture n'est « payée » que si des paiements enregistrés couvrent son total">Paiements</CardTitle>
              {payments.length === 0 ? (
                <p className="text-sm text-muted">Aucun paiement enregistré.</p>
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {payments.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span className={p.voidedAt ? "text-muted line-through" : ""}>
                        {p.paidOn} · {METHOD_LABELS[p.method]}{p.reference ? ` · ${p.reference}` : ""}
                      </span>
                      <span className="flex items-center gap-3">
                        <span className={`num ${p.voidedAt ? "text-muted line-through" : ""}`}>{money(p.amountMinor)}</span>
                        {canWrite && !p.voidedAt && <ActionButton variant="secondary" confirm="Annuler ce paiement ?" action={voidPaymentAction.bind(null, companyId, p.id)}>Annuler</ActionButton>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {canWrite && settlement.outstandingMinor > 0 && (
                <details className="mt-4 border-t border-border pt-4">
                  <summary className="cursor-pointer text-sm font-medium text-accent">+ Enregistrer un paiement</summary>
                  <div className="pt-4">
                    <PaymentForm companyId={companyId} invoiceId={doc.id} today={todayIn(company.timezone)} currency={doc.currency} outstanding={formatPlain(settlement.outstandingMinor, doc.currency)} />
                  </div>
                </details>
              )}
            </Card>
          )}

          {d.credits.length > 0 && (
            <Card>
              <CardTitle>Avoirs liés</CardTitle>
              <ul className="space-y-1 text-sm">
                {d.credits.map((c) => (
                  <li key={c.id}><Link className="hover:text-accent" href={`/app/${companyId}/documents/${c.id}`}>{c.number ?? "Brouillon"}</Link> · {money(c.totalMinor)}</li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardTitle>Totaux</CardTitle>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Total HT</dt><dd className="num">{money(doc.subtotalMinor)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Taxes</dt><dd className="num">{money(doc.taxMinor)}</dd></div>
              <div className="flex justify-between border-t border-border pt-2 text-base font-semibold"><dt>Total TTC</dt><dd className="num">{money(doc.totalMinor)}</dd></div>
              {doc.type === "invoice" && doc.status === "issued" && (
                <>
                  <div className="flex justify-between"><dt className="text-muted">Réglé</dt><dd className="num">{money(settlement.paidMinor)}</dd></div>
                  {settlement.creditedMinor > 0 && <div className="flex justify-between"><dt className="text-muted">Avoirs</dt><dd className="num">{money(settlement.creditedMinor)}</dd></div>}
                  <div className="flex justify-between font-medium"><dt>Reste à payer</dt><dd className="num">{money(settlement.outstandingMinor)}</dd></div>
                </>
              )}
            </dl>
          </Card>
          <Card>
            <CardTitle>Informations</CardTitle>
            {canWrite && draft ? (
              <MetaForm companyId={companyId} docId={doc.id} issueDate={doc.issueDate} dueDate={doc.dueDate} notes={doc.notes} />
            ) : (
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between"><dt className="text-muted">Date</dt><dd className="num">{doc.issueDate}</dd></div>
                {doc.dueDate && <div className="flex justify-between"><dt className="text-muted">Échéance</dt><dd className="num">{doc.dueDate}</dd></div>}
                {doc.notes && <p className="pt-2 text-muted">{doc.notes}</p>}
              </dl>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
