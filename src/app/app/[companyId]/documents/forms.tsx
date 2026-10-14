"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select, Textarea } from "@/components/ui/select";
import { useResetOnSuccess } from "@/lib/use-reset-on-success";
import { formatRate } from "@/modules/sales/calc";
import { METHOD_LABELS } from "./labels";
import { addLineAction, createDraftAction, paymentAction, updateMetaAction } from "./actions";

type Opt = { id: string; name: string };

export function NewDraftForm({ companyId, type, contacts }: { companyId: string; type: "quote" | "invoice"; contacts: Opt[] }) {
  const [state, action, pending] = useActionState(createDraftAction.bind(null, companyId, type), undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="min-w-56 flex-1">
        <Select id="contactId" name="contactId" label="Client" required defaultValue="">
          <option value="" disabled>Choisir un client…</option>
          {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </div>
      <Button type="submit" loading={pending}>{type === "quote" ? "Créer le devis" : "Créer la facture"}</Button>
      {state?.error && <p role="alert" className="w-full text-sm text-danger">{state.error}</p>}
    </form>
  );
}

export function AddLineForm({
  companyId,
  docId,
  products,
  taxes,
}: {
  companyId: string;
  docId: string;
  products: { id: string; name: string }[];
  taxes: { id: string; name: string; rateBp: number }[];
}) {
  const [state, action, pending] = useActionState(addLineAction.bind(null, companyId, docId), undefined);
  const ref = useResetOnSuccess(state);
  return (
    <form ref={ref} action={action} className="grid gap-3 sm:grid-cols-6">
      <div className="sm:col-span-6">
        <Select id="productId" name="productId" label="Produit ou service du catalogue (optionnel)" defaultValue="">
          <option value="">— Ligne libre —</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </div>
      <div className="sm:col-span-3"><Field id="description" name="description" label="Description" /></div>
      <div className="sm:col-span-1"><Field id="quantity" name="quantity" label="Qté" defaultValue="1" inputMode="decimal" /></div>
      <div className="sm:col-span-2"><Field id="unitPrice" name="unitPrice" label="Prix unitaire HT" inputMode="decimal" hint="Vide : prix du catalogue" /></div>
      <div className="sm:col-span-3">
        <Select id="taxRateId" name="taxRateId" label="Taxe" defaultValue="">
          <option value="">Aucune</option>
          {taxes.map((t) => <option key={t.id} value={t.id}>{t.name} ({formatRate(t.rateBp)})</option>)}
        </Select>
      </div>
      <div className="flex items-end gap-3 sm:col-span-3">
        <Button type="submit" loading={pending}>Ajouter la ligne</Button>
        {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      </div>
    </form>
  );
}

export function MetaForm({ companyId, docId, issueDate, dueDate, notes }: { companyId: string; docId: string; issueDate: string; dueDate: string | null; notes: string | null }) {
  const [state, action, pending] = useActionState(updateMetaAction.bind(null, companyId, docId), undefined);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <Field id="issueDate" name="issueDate" type="date" label="Date" defaultValue={issueDate} required />
      <Field id="dueDate" name="dueDate" type="date" label="Échéance" defaultValue={dueDate ?? ""} />
      <div className="sm:col-span-2"><Textarea id="notes" name="notes" label="Notes (affichées sur le document)" defaultValue={notes ?? ""} /></div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" variant="secondary" loading={pending}>Enregistrer</Button>
        {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
        {state?.ok && <p role="status" className="text-sm text-success">Enregistré</p>}
      </div>
    </form>
  );
}


export function PaymentForm({ companyId, invoiceId, today, currency, outstanding, accounts }: { companyId: string; invoiceId: string; today: string; currency: string; outstanding: string; accounts: Opt[] }) {
  const [state, action, pending] = useActionState(paymentAction.bind(null, companyId, invoiceId), undefined);
  const ref = useResetOnSuccess(state);
  return (
    <form ref={ref} action={action} className="grid gap-3 sm:grid-cols-2">
      <Field id="amount" name="amount" label={`Montant (${currency})`} inputMode="decimal" required defaultValue={outstanding} />
      <Field id="paidOn" name="paidOn" type="date" label="Date du paiement" defaultValue={today} required />
      <Select id="method" name="method" label="Moyen de paiement" defaultValue="bank_transfer">
        {Object.entries(METHOD_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </Select>
      <Field id="reference" name="reference" label="Référence" />
      {accounts.length > 0 && (
        <Select id="accountId" name="accountId" label="Encaissé sur le compte" defaultValue={accounts[0]!.id}>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
      )}
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" loading={pending}>Enregistrer le paiement</Button>
        {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      </div>
    </form>
  );
}
