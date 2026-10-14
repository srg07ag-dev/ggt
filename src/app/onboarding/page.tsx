"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { createCompanyAction } from "./actions";

export default function Onboarding() {
  const [state, action, pending] = useActionState(createCompanyAction, undefined);
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <form action={action} className="w-full max-w-md space-y-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Créez votre entreprise</h1>
          <p className="mt-1 text-sm text-muted">
            Le pays et la devise servent à configurer les règles applicables. Vous pourrez ajouter d&apos;autres
            entreprises plus tard.
          </p>
        </div>
        <Field id="name" name="name" label="Nom de l'entreprise" required minLength={2} />
        <div className="grid grid-cols-2 gap-4">
          <Field id="country" name="country" label="Pays (code ISO)" placeholder="TG" required maxLength={2} minLength={2} />
          <Field id="currency" name="currency" label="Devise (ISO)" placeholder="XOF" required maxLength={3} minLength={3} />
        </div>
        {state?.error && (
          <p role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        )}
        <Button type="submit" loading={pending} className="w-full">
          Créer l&apos;entreprise
        </Button>
      </form>
    </main>
  );
}
