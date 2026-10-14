"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { createContactAction } from "./actions";

export function ContactForm({ companyId }: { companyId: string }) {
  const [state, action, pending] = useActionState(createContactAction.bind(null, companyId), undefined);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <Field id="name" name="name" label="Nom" required />
      <Field id="email" name="email" type="email" label="E-mail" />
      <Button type="submit" loading={pending}>Ajouter</Button>
      {state?.error && <p role="alert" className="text-sm text-danger sm:col-span-3">{state.error}</p>}
    </form>
  );
}
