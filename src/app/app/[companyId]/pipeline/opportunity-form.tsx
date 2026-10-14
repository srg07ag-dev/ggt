"use client";

import { useActionState } from "react";
import { useResetOnSuccess } from "@/lib/use-reset-on-success";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { createOpportunityAction } from "./actions";

export function OpportunityForm({
  companyId,
  currency,
  contacts,
}: {
  companyId: string;
  currency: string;
  contacts: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(createOpportunityAction.bind(null, companyId), undefined);
  const formRef = useResetOnSuccess(state);
  return (
    <form ref={formRef} action={action} className="grid gap-4 sm:grid-cols-2">
      <Field id="title" name="title" label="Titre" required />
      <Select id="contactId" name="contactId" label="Client" required defaultValue="">
        <option value="" disabled>Choisir…</option>
        {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </Select>
      <Field id="amount" name="amount" label={`Montant (${currency})`} inputMode="decimal" defaultValue="0" />
      <Field id="expectedClose" name="expectedClose" type="date" label="Clôture estimée" />
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" loading={pending}>Créer l&apos;opportunité</Button>
        {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      </div>
    </form>
  );
}
