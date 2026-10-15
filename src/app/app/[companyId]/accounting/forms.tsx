"use client";

import { useActionState, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select, Textarea } from "@/components/ui/select";
import { useResetOnSuccess } from "@/lib/use-reset-on-success";
import { formatMoney, toMinor } from "@/lib/money";
import {
  confirmChartAction, createAccountAction, createPeriodAction, previewChartAction, reopenPeriodAction, reverseEntryAction, saveEntryAction, saveSettingsAction, setMappingAction,
} from "./actions";

type Opt = { id: string; label: string };

export const TYPES = [["asset", "Actif"], ["liability", "Passif"], ["equity", "Capitaux propres"], ["revenue", "Produit"], ["expense", "Charge"]] as const;

export function AccountForm({ companyId }: { companyId: string }) {
  const [state, action, pending] = useActionState(createAccountAction.bind(null, companyId), undefined);
  const ref = useResetOnSuccess(state);
  return (
    <form ref={ref} action={action} className="grid gap-3 sm:grid-cols-4 sm:items-end">
      <Field id="acode" name="code" label="Code" required maxLength={20} />
      <div className="sm:col-span-2"><Field id="aname" name="name" label="Libellé" required /></div>
      <Select id="atype" name="type" label="Type" defaultValue="asset">{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
      <div className="flex items-center gap-3 sm:col-span-4">
        <Button type="submit" loading={pending}>Ajouter le compte</Button>
        {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      </div>
    </form>
  );
}

/** Import en deux temps : aperçu et contrôle, puis confirmation. */
export function ImportChart({ companyId }: { companyId: string }) {
  const [preview, previewAction, previewing] = useActionState(previewChartAction, undefined);
  const [done, confirmAction, confirming] = useActionState(confirmChartAction.bind(null, companyId), undefined);
  const parsed = preview?.parsed;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Format : <code>code;libellé;type</code> (type : actif, passif, capitaux, produit, charge). Demandez à votre comptable le plan de comptes de votre référentiel : le produit n&apos;en fournit aucun.
      </p>
      <form action={previewAction} className="space-y-3">
        <Field id="chartfile" name="file" type="file" label="Fichier CSV" accept=".csv,text/csv,text/plain" />
        <Textarea id="chartcsv" name="csv" label="…ou collez le contenu" rows={4} placeholder="101;Capital;capitaux" />
        <Button type="submit" variant="secondary" loading={previewing}>Contrôler le fichier</Button>
        {preview?.error && <p role="alert" className="text-sm text-danger">{preview.error}</p>}
      </form>
      {parsed && (
        <div className="space-y-3 rounded-[var(--radius)] border border-border p-4 text-sm">
          <p><strong>{parsed.rows.length}</strong> compte(s) valide(s), <strong className={parsed.errors.length ? "text-danger" : ""}>{parsed.errors.length}</strong> ligne(s) en erreur.</p>
          {parsed.errors.length > 0 && (
            <ul role="alert" className="space-y-1 text-danger">{parsed.errors.slice(0, 20).map((e) => <li key={e.line}>Ligne {e.line} : {e.message}</li>)}</ul>
          )}
          {parsed.rows.length > 0 && (
            <ul className="max-h-48 overflow-auto font-mono text-xs text-muted">{parsed.rows.slice(0, 50).map((r) => <li key={r.code}>{r.code} — {r.name} ({r.type})</li>)}{parsed.rows.length > 50 && <li>… et {parsed.rows.length - 50} autres</li>}</ul>
          )}
          {parsed.errors.length === 0 && parsed.rows.length > 0 && (
            <form action={confirmAction}>
              <input type="hidden" name="csv" value={preview?.csv ?? ""} />
              <Button type="submit" loading={confirming}>Importer {parsed.rows.length} compte(s)</Button>
            </form>
          )}
          {parsed.errors.length > 0 && <p className="text-muted">Corrigez le fichier puis relancez le contrôle : l&apos;import est tout ou rien.</p>}
        </div>
      )}
      {done?.ok && <p role="status" className="text-sm text-success">{done.imported} compte(s) importé(s).</p>}
      {done?.error && <p role="alert" className="text-sm text-danger">{done.error}</p>}
    </div>
  );
}

export function PeriodForm({ companyId, suggestedYear }: { companyId: string; suggestedYear: number }) {
  const [state, action, pending] = useActionState(createPeriodAction.bind(null, companyId), undefined);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-4 sm:items-end">
      <Field id="pname" name="name" label="Nom" defaultValue={`Exercice ${suggestedYear}`} required />
      <Field id="pstart" name="startDate" type="date" label="Début" defaultValue={`${suggestedYear}-01-01`} required />
      <Field id="pend" name="endDate" type="date" label="Fin" defaultValue={`${suggestedYear}-12-31`} required />
      <Button type="submit" loading={pending}>Créer</Button>
      {state?.error && <p role="alert" className="text-sm text-danger sm:col-span-4">{state.error}</p>}
    </form>
  );
}

export function ReopenForm({ companyId, id }: { companyId: string; id: string }) {
  const [state, action, pending] = useActionState(reopenPeriodAction.bind(null, companyId, id), undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <div className="min-w-48"><Field id={`why-${id}`} name="reason" label="Motif de réouverture" required minLength={5} /></div>
      <Button type="submit" variant="secondary" loading={pending}>Rouvrir</Button>
      {state?.error && <p role="alert" className="w-full text-xs text-danger">{state.error}</p>}
    </form>
  );
}

export function ReverseForm({ companyId, id, today }: { companyId: string; id: string; today: string }) {
  const [state, action, pending] = useActionState(reverseEntryAction.bind(null, companyId, id), undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <div className="w-44"><Field id="rev-date" name="date" type="date" label="Date de la contre-passation" defaultValue={today} required /></div>
      <Button type="submit" variant="secondary" loading={pending}>Contre-passer</Button>
      {state?.error && <p role="alert" className="w-full text-sm text-danger">{state.error}</p>}
    </form>
  );
}

type LineState = { accountId: string; debit: string; credit: string; description: string };

/** Saisie d'écriture avec totaux et équilibre en direct (la base reste l'arbitre final). */
export function EntryForm({
  companyId, entryId, journals, accounts, currency, defaults,
}: {
  companyId: string; entryId?: string; journals: Opt[]; accounts: Opt[]; currency: string;
  defaults: { journalId: string; entryDate: string; description: string; lines: LineState[] };
}) {
  const [state, action, pending] = useActionState(saveEntryAction.bind(null, companyId, entryId), undefined);
  const [lines, setLines] = useState<LineState[]>(defaults.lines.length ? defaults.lines : [{ accountId: "", debit: "", credit: "", description: "" }, { accountId: "", debit: "", credit: "", description: "" }]);
  const totals = useMemo(() => {
    let d = 0, c = 0, invalid = false;
    for (const l of lines) {
      const dv = l.debit.trim() ? toMinor(l.debit, currency) : 0;
      const cv = l.credit.trim() ? toMinor(l.credit, currency) : 0;
      if (dv === null || cv === null) invalid = true; else { d += dv; c += cv; }
    }
    return { d, c, invalid };
  }, [lines, currency]);
  const balanced = !totals.invalid && totals.d === totals.c && totals.d > 0;
  const set = (i: number, patch: Partial<LineState>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Select id="journalId" name="journalId" label="Journal" defaultValue={defaults.journalId}>{journals.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}</Select>
        <Field id="entryDate" name="entryDate" type="date" label="Date" defaultValue={defaults.entryDate} required />
        <Field id="edesc" name="description" label="Libellé" defaultValue={defaults.description} required />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-xs text-muted"><tr><th className="pb-2 font-medium">Compte</th><th className="pb-2 font-medium">Libellé (facultatif)</th><th className="w-32 pb-2 text-right font-medium">Débit</th><th className="w-32 pb-2 text-right font-medium">Crédit</th><th className="w-8" /></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="pr-2 pb-2"><select name="accountId" aria-label={`Compte ligne ${i + 1}`} value={l.accountId} onChange={(e) => set(i, { accountId: e.target.value })} className="h-10 w-full rounded-[var(--radius-sm)] border border-border-strong bg-surface px-2 text-sm"><option value="">—</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></td>
                <td className="pr-2 pb-2"><input name="lineDescription" aria-label={`Libellé ligne ${i + 1}`} value={l.description} onChange={(e) => set(i, { description: e.target.value })} className="h-10 w-full rounded-[var(--radius-sm)] border border-border-strong bg-surface px-2 text-sm" /></td>
                <td className="pr-2 pb-2"><input name="debit" aria-label={`Débit ligne ${i + 1}`} inputMode="decimal" value={l.debit} onChange={(e) => set(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} className="num h-10 w-full rounded-[var(--radius-sm)] border border-border-strong bg-surface px-2 text-right text-sm" /></td>
                <td className="pr-2 pb-2"><input name="credit" aria-label={`Crédit ligne ${i + 1}`} inputMode="decimal" value={l.credit} onChange={(e) => set(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} className="num h-10 w-full rounded-[var(--radius-sm)] border border-border-strong bg-surface px-2 text-right text-sm" /></td>
                <td className="pb-2">{lines.length > 2 && <button type="button" aria-label={`Supprimer la ligne ${i + 1}`} className="text-muted hover:text-danger" onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))}>✕</button>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border font-medium"><td colSpan={2} className="pt-2">Totaux</td><td className="num pt-2 text-right">{formatMoney(totals.d, currency)}</td><td className="num pt-2 text-right">{formatMoney(totals.c, currency)}</td><td /></tr>
          </tfoot>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" onClick={() => setLines((ls) => [...ls, { accountId: "", debit: "", credit: "", description: "" }])}>+ Ligne</Button>
        <Badge tone={balanced ? "success" : "warning"}>{balanced ? "Équilibrée" : totals.invalid ? "Montant invalide" : `Écart : ${formatMoney(Math.abs(totals.d - totals.c), currency)}`}</Badge>
        <Button type="submit" loading={pending}>{entryId ? "Enregistrer le brouillon" : "Créer le brouillon"}</Button>
        {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
        {state?.ok && entryId && <p role="status" className="text-sm text-success">Enregistré</p>}
      </div>
    </form>
  );
}

const NONE = "—";
export function SettingsForm({
  companyId, accounts, journals, values,
}: {
  companyId: string;
  accounts: { id: string; label: string; type: string }[];
  journals: { id: string; label: string; kind: string }[];
  values: Record<string, string | boolean | null | undefined>;
}) {
  const [state, action, pending] = useActionState(saveSettingsAction.bind(null, companyId), undefined);
  const accSel = (name: string, label: string, type: string) => (
    <Select id={name} name={name} label={label} defaultValue={String(values[name] ?? "")}>
      <option value="">{NONE}</option>
      {accounts.filter((a) => a.type === type).map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
    </Select>
  );
  const jrSel = (name: string, label: string, kind: string) => (
    <Select id={name} name={name} label={label} defaultValue={String(values[name] ?? "")}>
      <option value="">{NONE}</option>
      {journals.filter((j) => j.kind === kind).map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
    </Select>
  );
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {accSel("receivableAccountId", "Clients (créances) — actif", "asset")}
        {accSel("revenueAccountId", "Ventes par défaut — produit", "revenue")}
        {accSel("taxCollectedAccountId", "Taxe collectée par défaut — passif", "liability")}
        {accSel("taxDeductibleAccountId", "Taxe déductible — actif", "asset")}
        {accSel("expenseAccountId", "Charges par défaut — charge", "expense")}
        {accSel("otherIncomeAccountId", "Autres recettes par défaut — produit", "revenue")}
        {jrSel("salesJournalId", "Journal des ventes", "sales")}
        {jrSel("purchasesJournalId", "Journal des achats et dépenses", "purchases")}
        {jrSel("treasuryJournalId", "Journal de trésorerie", "treasury")}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
        <Field id="enabledFrom" name="enabledFrom" type="date" label="Comptabiliser à partir du" defaultValue={String(values.enabledFrom ?? "")} hint="Les opérations plus anciennes ne sont pas comptabilisées automatiquement." />
        <label className="flex items-center gap-2 pb-2 text-sm font-medium"><input type="checkbox" name="enabled" defaultChecked={Boolean(values.enabled)} className="size-4" /> Activer la comptabilisation automatique</label>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" loading={pending}>Enregistrer</Button>
        {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
        {state?.ok && <p role="status" className="text-sm text-success">Enregistré</p>}
      </div>
    </form>
  );
}

export function MappingSelect({ companyId, kind, id, current, accounts, label }: { companyId: string; kind: "finance_account" | "tax_rate" | "finance_category" | "product"; id: string; current: string | null; accounts: Opt[]; label: string }) {
  const [state, action] = useActionState(setMappingAction.bind(null, companyId, kind, id), undefined);
  return (
    <form action={action} className="flex items-center gap-2">
      <select name="ledgerAccountId" defaultValue={current ?? ""} aria-label={label} onChange={(e) => e.currentTarget.form?.requestSubmit()} className="h-9 max-w-60 rounded-[var(--radius-sm)] border border-border-strong bg-surface px-3 text-sm">
        <option value="">Non associé</option>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
      </select>
      {state?.error && <span role="alert" className="max-w-52 text-xs text-danger">{state.error}</span>}
    </form>
  );
}
