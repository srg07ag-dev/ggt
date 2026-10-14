"use client";

import { useActionState } from "react";
import { useResetOnSuccess } from "@/lib/use-reset-on-success";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { createActivityAction } from "./actions";

export const TYPE_LABELS = { call: "Appel", meeting: "Rendez-vous", note: "Note", follow_up: "Relance", deadline: "Échéance" } as const;

export function ActivityForm({
  companyId,
  contactId,
  contacts,
}: {
  companyId: string;
  contactId?: string;
  contacts?: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(createActivityAction.bind(null, companyId, contactId), undefined);
  const formRef = useResetOnSuccess(state);
  return (
    <form ref={formRef} action={action} className="grid gap-4 sm:grid-cols-2">
      <Select id="type" name="type" label="Type" defaultValue="follow_up">
        {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </Select>
      <Field id="title" name="title" label="Titre" required />
      <Field id="dueAt" name="dueAt" type="datetime-local" label="Échéance" />
      <Select id="priority" name="priority" label="Priorité" defaultValue="normal">
        <option value="low">Basse</option>
        <option value="normal">Normale</option>
        <option value="high">Haute</option>
      </Select>
      {contacts && (
        <Select id="contactId" name="contactId" label="Contact" defaultValue="">
          <option value="">—</option>
          {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      )}
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" loading={pending}>Ajouter</Button>
        {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      </div>
    </form>
  );
}
