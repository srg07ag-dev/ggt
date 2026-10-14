"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select, Textarea } from "@/components/ui/select";
import { useResetOnSuccess } from "@/lib/use-reset-on-success";
import { createObligationAction, recordEventAction, saveProfileAction } from "./actions";

export function ProfileForm({ companyId, profile }: { companyId: string; profile: { regimeLabel: string | null; vatRegistered: boolean | null; filingFrequency: string | null; notes: string | null } | null }) {
  const [state, action, pending] = useActionState(saveProfileAction.bind(null, companyId), undefined);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <Field id="regime" name="regimeLabel" label="Régime d'imposition (tel que déclaré)" defaultValue={profile?.regimeLabel ?? ""} hint="Texte libre : il n'est pas interprété." />
      <Select id="vat" name="vatRegistered" label="Assujetti à une taxe sur la valeur ajoutée ?" defaultValue={profile?.vatRegistered === true ? "yes" : profile?.vatRegistered === false ? "no" : ""}>
        <option value="">Non renseigné</option><option value="yes">Oui</option><option value="no">Non</option>
      </Select>
      <Field id="freq" name="filingFrequency" label="Périodicité des déclarations" defaultValue={profile?.filingFrequency ?? ""} />
      <div className="sm:col-span-2"><Textarea id="tnotes" name="notes" label="Notes" defaultValue={profile?.notes ?? ""} /></div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" loading={pending}>Enregistrer</Button>
        {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
        {state?.ok && <p role="status" className="text-sm text-success">Enregistré</p>}
      </div>
    </form>
  );
}

export function ObligationForm({ companyId }: { companyId: string }) {
  const [state, action, pending] = useActionState(createObligationAction.bind(null, companyId), undefined);
  const ref = useResetOnSuccess(state);
  return (
    <form ref={ref} action={action} className="grid gap-3 sm:grid-cols-2">
      <Field id="otitle" name="title" label="Intitulé" required />
      <Field id="odue" name="dueDate" type="date" label="Échéance" required />
      <Field id="oauth" name="authority" label="Administration" />
      <Field id="operiod" name="periodLabel" label="Période concernée" placeholder="T1 2026" />
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" loading={pending}>Ajouter l&apos;échéance</Button>
        {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      </div>
    </form>
  );
}

export function EventForm({ companyId, obligationId, today, currency }: { companyId: string; obligationId: string; today: string; currency: string }) {
  const [state, action, pending] = useActionState(recordEventAction.bind(null, companyId, obligationId), undefined);
  const ref = useResetOnSuccess(state);
  return (
    <form ref={ref} action={action} className="grid gap-3 sm:grid-cols-2">
      <Select id="ekind" name="kind" label="Type" defaultValue="filed">
        <option value="filed">Déclaration déposée</option><option value="paid">Paiement effectué</option><option value="note">Note</option>
      </Select>
      <Field id="edate" name="occurredOn" type="date" label="Date" defaultValue={today} required />
      <Field id="eamount" name="amount" label={`Montant (${currency}) — obligatoire pour un paiement`} inputMode="decimal" />
      <Field id="eref" name="reference" label="Référence / quittance" />
      <div className="sm:col-span-2"><Field id="enotes" name="notes" label="Notes" /></div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" loading={pending}>Enregistrer</Button>
        {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      </div>
    </form>
  );
}
