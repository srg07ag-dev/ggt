"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { useResetOnSuccess } from "@/lib/use-reset-on-success";
import { createAccountAction, createCategoryAction, createEntryAction, createSupplierAction, uploadAttachmentAction } from "./finance-actions";

type Opt = { id: string; name: string };

export function AccountForm({ companyId, currency }: { companyId: string; currency: string }) {
  const [state, action, pending] = useActionState(createAccountAction.bind(null, companyId), undefined);
  const ref = useResetOnSuccess(state);
  return (
    <form ref={ref} action={action} className="grid gap-3 sm:grid-cols-3">
      <Field id="aname" name="name" label="Nom du compte" required />
      <Select id="akind" name="kind" label="Type" defaultValue="bank">
        <option value="bank">Banque</option>
        <option value="cash">Caisse</option>
        <option value="mobile_money">Mobile money</option>
        <option value="other">Autre</option>
      </Select>
      <Field id="aopen" name="openingBalance" label={`Solde actuel (${currency})`} inputMode="decimal" defaultValue="0" hint="Point de départ du suivi." />
      <div className="flex items-center gap-3 sm:col-span-3">
        <Button type="submit" loading={pending}>Ajouter le compte</Button>
        {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      </div>
    </form>
  );
}

export function SupplierForm({ companyId }: { companyId: string }) {
  const [state, action, pending] = useActionState(createSupplierAction.bind(null, companyId), undefined);
  const ref = useResetOnSuccess(state);
  return (
    <form ref={ref} action={action} className="grid gap-3 sm:grid-cols-2">
      <Field id="sname" name="name" label="Nom" required />
      <Field id="semail" name="email" type="email" label="E-mail" />
      <Field id="sphone" name="phone" label="Téléphone" />
      <Field id="staxid" name="taxId" label="Identifiant fiscal" />
      <div className="sm:col-span-2"><Field id="saddr" name="address" label="Adresse" /></div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" loading={pending}>Ajouter le fournisseur</Button>
        {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      </div>
    </form>
  );
}

export function CategoryForm({ companyId, kind }: { companyId: string; kind: "income" | "expense" }) {
  const [state, action, pending] = useActionState(createCategoryAction.bind(null, companyId, kind), undefined);
  const ref = useResetOnSuccess(state);
  return (
    <form ref={ref} action={action} className="flex flex-wrap items-end gap-3">
      <div className="min-w-48 flex-1"><Field id={`cat-${kind}`} name="name" label="Nouvelle catégorie" required /></div>
      <Button type="submit" variant="secondary" loading={pending}>Ajouter</Button>
      {state?.error && <p role="alert" className="w-full text-sm text-danger">{state.error}</p>}
    </form>
  );
}

export function EntryForm({
  companyId,
  kind,
  today,
  currency,
  accounts,
  categories,
  parties,
}: {
  companyId: string;
  kind: "income" | "expense";
  today: string;
  currency: string;
  accounts: Opt[];
  categories: Opt[];
  /** Fournisseurs (dépense) ou clients (recette). */
  parties: Opt[];
}) {
  const [state, action, pending] = useActionState(createEntryAction.bind(null, companyId, kind), undefined);
  const expense = kind === "expense";
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <Field id="description" name="description" label="Description" required />
      <Field id="occurredOn" name="occurredOn" type="date" label="Date" defaultValue={today} required />
      <Field id="amount" name="amount" label={`Montant ${expense ? "TTC " : ""}(${currency})`} inputMode="decimal" required />
      {expense && <Field id="tax" name="tax" label="Dont taxe (optionnel)" inputMode="decimal" hint="Tel qu'indiqué sur le justificatif." />}
      <Select id="accountId" name="accountId" label={expense ? "Payé depuis" : "Encaissé sur"} required defaultValue={accounts[0]?.id ?? ""}>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </Select>
      <Select id="categoryId" name="categoryId" label="Catégorie" defaultValue="">
        <option value="">—</option>
        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </Select>
      <Select id={expense ? "supplierId" : "contactId"} name={expense ? "supplierId" : "contactId"} label={expense ? "Fournisseur" : "Client"} defaultValue="">
        <option value="">—</option>
        {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </Select>
      <Field id="reference" name="reference" label="Référence" />
      <div className="sm:col-span-2">
        <Field id="file" name="file" type="file" label="Justificatif (PDF, PNG, JPEG, WebP — 10 Mo max)" accept="application/pdf,image/png,image/jpeg,image/webp" />
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" loading={pending}>{expense ? "Enregistrer la dépense" : "Enregistrer la recette"}</Button>
        {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      </div>
    </form>
  );
}

export function UploadForm({ companyId, entryId }: { companyId: string; entryId: string }) {
  const [state, action, pending] = useActionState(uploadAttachmentAction.bind(null, companyId, entryId), undefined);
  const ref = useResetOnSuccess(state);
  return (
    <form ref={ref} action={action} className="flex flex-wrap items-end gap-3">
      <div className="min-w-56 flex-1"><Field id="upload" name="file" type="file" label="Ajouter un justificatif" accept="application/pdf,image/png,image/jpeg,image/webp" required /></div>
      <Button type="submit" variant="secondary" loading={pending}>Téléverser</Button>
      {state?.error && <p role="alert" className="w-full text-sm text-danger">{state.error}</p>}
    </form>
  );
}
