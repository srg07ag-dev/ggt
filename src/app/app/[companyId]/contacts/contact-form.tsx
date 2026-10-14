"use client";

import { useActionState } from "react";
import { useResetOnSuccess } from "@/lib/use-reset-on-success";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select, Textarea } from "@/components/ui/select";
import type { schema } from "@/db/client";
import { createContactAction, updateContactAction } from "./actions";

type Contact = typeof schema.contact.$inferSelect;

export function ContactForm({
  companyId,
  contact,
  parents = [],
}: {
  companyId: string;
  contact?: Contact;
  parents?: { id: string; name: string }[];
}) {
  const action = contact
    ? updateContactAction.bind(null, companyId, contact.id)
    : createContactAction.bind(null, companyId);
  const [state, formAction, pending] = useActionState(action, undefined);
  const formRef = useResetOnSuccess(state, !contact);
  return (
    <form ref={formRef} action={formAction} className="grid gap-4 sm:grid-cols-2">
      <Select id="kind" name="kind" label="Type" defaultValue={contact?.kind ?? "person"}>
        <option value="person">Particulier</option>
        <option value="organization">Entreprise</option>
      </Select>
      <Field id="name" name="name" label="Nom" required defaultValue={contact?.name} />
      <Field id="email" name="email" type="email" label="E-mail" defaultValue={contact?.email ?? ""} />
      <Field id="phone" name="phone" label="Téléphone" defaultValue={contact?.phone ?? ""} />
      <Field id="organization" name="organization" label="Organisation" defaultValue={contact?.organization ?? ""} />
      <Field id="tags" name="tags" label="Tags" hint="Séparés par des virgules" defaultValue={contact?.tags.join(", ") ?? ""} />
      <Select id="parentId" name="parentId" label="Rattaché à (client professionnel)" defaultValue={contact?.parentId ?? ""}>
        <option value="">—</option>
        {parents.filter((p) => p.id !== contact?.id).map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </Select>
      <Field id="address" name="address" label="Adresse" defaultValue={contact?.address ?? ""} />
      <div className="sm:col-span-2">
        <Textarea id="notes" name="notes" label="Notes" defaultValue={contact?.notes ?? ""} />
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" loading={pending}>{contact ? "Enregistrer" : "Ajouter le contact"}</Button>
        {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
        {state?.ok && contact && <p role="status" className="text-sm text-success">Enregistré</p>}
      </div>
    </form>
  );
}
