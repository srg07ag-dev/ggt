import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { todayIn } from "@/lib/dates";
import { formatMoney, formatPlain } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { withAccess } from "@/lib/with-access";
import { can } from "@/modules/core/permissions";
import { requireMembership } from "@/modules/core/tenant";
import { listLedgerAccounts } from "@/modules/accounting/chart";
import { getEntry } from "@/modules/accounting/entries";
import { listJournals } from "@/modules/accounting/journals";
import { deleteEntryAction, postEntryAction } from "../../actions";
import { EntryForm, ReverseForm } from "../../forms";

async function EntryPage({ params }: { params: Promise<{ companyId: string; entryId: string }> }) {
  const { companyId, entryId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(entryId)) notFound();
  const user = await requireUser();
  const ctx = await requireMembership(user.id, companyId, "accounting:read");
  const e = await getEntry(user.id, companyId, entryId);
  if (!e) notFound();
  const [co] = await db.select().from(schema.company).where(eq(schema.company.id, companyId));
  const canWrite = can(ctx.role, "accounting:write");
  const draft = e.e.status === "draft";
  const money = (n: number) => (n ? formatMoney(n, co!.currency) : "");
  const [accounts, journals] = draft && canWrite && e.e.sourceType === "manual" ? await Promise.all([listLedgerAccounts(user.id, companyId), listJournals(user.id, companyId)]) : [[], []];
  const d = e.lines.reduce((n, l) => n + l.l.debitMinor, 0);
  const c = e.lines.reduce((n, l) => n + l.l.creditMinor, 0);

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/app/${companyId}/accounting/entries`} className="text-sm text-muted hover:text-accent">← Écritures</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{e.e.number ?? "Brouillon d'écriture"}</h1>
          <Badge tone={draft ? "warning" : "success"}>{draft ? "Brouillon" : "Validée"}</Badge>
          {e.e.reversalOfId && <Badge tone="accent">Contre-passation</Badge>}
          {e.reversedBy && <Link href={`/app/${companyId}/accounting/entries/${e.reversedBy.id}`}><Badge tone="warning">Contre-passée par {e.reversedBy.number}</Badge></Link>}
        </div>
        <p className="mt-1 text-sm text-muted">{e.journalCode} · {e.journalName} · <span className="num">{e.e.entryDate}</span> · {e.e.description}</p>
      </div>

      {draft && canWrite && e.e.sourceType === "manual" ? (
        <Card>
          <CardTitle hint="Les contrôles d'équilibre, de période et de comptes s'appliquent à la validation.">Brouillon</CardTitle>
          <EntryForm companyId={companyId} entryId={e.e.id} journals={journals.map((j) => ({ id: j.id, label: `${j.code} — ${j.name}` }))} accounts={accounts.map((a) => ({ id: a.id, label: `${a.code} — ${a.name}` }))} currency={co!.currency}
            defaults={{ journalId: e.e.journalId, entryDate: e.e.entryDate, description: e.e.description, lines: e.lines.map((x) => ({ accountId: x.l.accountId, debit: x.l.debitMinor ? formatPlain(x.l.debitMinor, co!.currency) : "", credit: x.l.creditMinor ? formatPlain(x.l.creditMinor, co!.currency) : "", description: x.l.description ?? "" })) }} />
          <div className="mt-4 flex flex-wrap gap-3 border-t border-border pt-4">
            <ActionButton action={postEntryAction.bind(null, companyId, e.e.id)} confirm="Une fois validée, l'écriture est numérotée et ne peut plus être modifiée (seulement contre-passée). Continuer ?">Valider l&apos;écriture</ActionButton>
            <ActionButton variant="danger" confirm="Supprimer ce brouillon ?" action={deleteEntryAction.bind(null, companyId, e.e.id)}>Supprimer le brouillon</ActionButton>
          </div>
        </Card>
      ) : (
        <Card>
          <CardTitle>Lignes</CardTitle>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="pb-2 font-medium">Compte</th><th className="pb-2 font-medium">Libellé</th><th className="pb-2 text-right font-medium">Débit</th><th className="pb-2 text-right font-medium">Crédit</th></tr></thead>
            <tbody>
              {e.lines.map((x) => (
                <tr key={x.l.id} className="border-t border-border"><td className="num py-2 font-medium">{x.code} <span className="font-normal text-muted">{x.name}</span></td><td className="py-2 text-muted">{x.l.description}</td><td className="num py-2 text-right">{money(x.l.debitMinor)}</td><td className="num py-2 text-right">{money(x.l.creditMinor)}</td></tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t border-border font-semibold"><td colSpan={2} className="pt-2">Totaux</td><td className="num pt-2 text-right">{money(d)}</td><td className="num pt-2 text-right">{money(c)}</td></tr></tfoot>
          </table>
          {!draft && canWrite && e.e.sourceType !== "reversal" && !e.reversedBy && (
            <div className="mt-4 border-t border-border pt-4">
              <p className="mb-2 text-sm text-muted">Une écriture validée ne se modifie pas : on la contre-passe, ce qui crée l&apos;écriture inverse et conserve l&apos;historique.</p>
              <ReverseForm companyId={companyId} id={e.e.id} today={todayIn(co!.timezone)} />
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

export default withAccess(EntryPage);
