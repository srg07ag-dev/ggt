"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { updateNumberingAction, updateProfileAction } from "./actions";

type Profile = { name: string; address: string | null; taxId: string | null; email: string | null; phone: string | null };

export function ProfileForm({ companyId, profile }: { companyId: string; profile: Profile }) {
  const [state, action, pending] = useActionState(updateProfileAction.bind(null, companyId), undefined);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2"><Field id="name" name="name" label="Nom de l'entreprise" defaultValue={profile.name} required /></div>
      <div className="sm:col-span-2"><Field id="address" name="address" label="Adresse" defaultValue={profile.address ?? ""} /></div>
      <Field id="taxId" name="taxId" label="Identifiant fiscal / d'immatriculation" defaultValue={profile.taxId ?? ""} hint="Reproduit tel quel sur vos documents." />
      <Field id="email" name="email" type="email" label="E-mail" defaultValue={profile.email ?? ""} />
      <Field id="phone" name="phone" label="Téléphone" defaultValue={profile.phone ?? ""} />
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" loading={pending}>Enregistrer</Button>
        {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
        {state?.ok && <p role="status" className="text-sm text-success">Enregistré</p>}
      </div>
    </form>
  );
}

export function NumberingForm({ companyId, current, suggestions }: { companyId: string; current: Partial<Record<string, string>>; suggestions: Record<string, string> }) {
  const [state, action, pending] = useActionState(updateNumberingAction.bind(null, companyId), undefined);
  const rows = [["quote", "Devis"], ["invoice", "Factures"], ["credit_note", "Avoirs"]] as const;
  return (
    <form action={action} className="grid gap-3">
      {rows.map(([k, label]) => (
        <Field key={k} id={`num-${k}`} name={k} label={label} defaultValue={current[k] ?? ""} placeholder={suggestions[k]} hint={current[k] ? undefined : "Non configuré : l'émission est bloquée."} />
      ))}
      <p className="text-xs text-muted">Jetons : {"{YYYY}"} (année) et {"{NNNN}"} (compteur, sans trou). Vérifiez auprès de votre comptable les règles de numérotation de votre pays.</p>
      <div className="flex items-center gap-3">
        <Button type="submit" loading={pending}>Enregistrer</Button>
        {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
        {state?.ok && <p role="status" className="text-sm text-success">Enregistré</p>}
      </div>
    </form>
  );
}
