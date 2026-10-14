"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select, Textarea } from "@/components/ui/select";
import { MODULE_LABELS, MODULES } from "@/modules/core/modules";
import { extendTrialAction, grantAction, markPaidAction, savePlanAction, saveSettingsAction, suspendAction } from "./actions";

type PlanDefaults = { code: string; name: string; description: string; currency: string; price: string; interval: string; trialDays: number; members: string; invoicesPerMonth: string; storageMb: string; modules: string[]; isPublic: boolean; isDefault: boolean };

export function PlanForm({ planId, defaults }: { planId?: string; defaults?: PlanDefaults }) {
  const [state, action, pending] = useActionState(savePlanAction.bind(null, planId), undefined);
  const d = defaults ?? { code: "", name: "", description: "", currency: "EUR", price: "0", interval: "month", trialDays: 0, members: "", invoicesPerMonth: "", storageMb: "", modules: [...MODULES], isPublic: true, isDefault: false };
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <Field id="code" name="code" label="Code (identifiant)" defaultValue={d.code} required readOnly={!!planId} hint="Minuscules, chiffres, tirets." />
      <Field id="pname" name="name" label="Nom affiché" defaultValue={d.name} required />
      <div className="sm:col-span-2"><Field id="pdesc" name="description" label="Description" defaultValue={d.description} /></div>
      <Field id="pcur" name="currency" label="Devise (ISO)" defaultValue={d.currency} required maxLength={3} />
      <Field id="pprice" name="price" label="Prix par période (0 = gratuit)" defaultValue={d.price} inputMode="decimal" />
      <Select id="pint" name="interval" label="Périodicité" defaultValue={d.interval}><option value="month">Mensuelle</option><option value="year">Annuelle</option></Select>
      <Field id="ptrial" name="trialDays" label="Jours d'essai" defaultValue={String(d.trialDays)} inputMode="numeric" />
      <Field id="pmem" name="members" label="Membres max." defaultValue={d.members} inputMode="numeric" hint="Vide = illimité" />
      <Field id="pinv" name="invoicesPerMonth" label="Factures émises / mois" defaultValue={d.invoicesPerMonth} inputMode="numeric" hint="Vide = illimité" />
      <Field id="psto" name="storageMb" label="Stockage justificatifs (Mo)" defaultValue={d.storageMb} inputMode="numeric" hint="Vide = illimité" />
      <fieldset className="sm:col-span-2">
        <legend className="mb-1 text-sm font-medium">Modules inclus</legend>
        <div className="flex flex-wrap gap-4 text-sm">{MODULES.map((m) => <label key={m} className="flex items-center gap-2"><input type="checkbox" name="modules" value={m} defaultChecked={d.modules.includes(m)} className="size-4" />{MODULE_LABELS[m]}</label>)}</div>
      </fieldset>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isPublic" defaultChecked={d.isPublic} className="size-4" /> Proposée aux entreprises</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isDefault" defaultChecked={d.isDefault} className="size-4" /> Offre par défaut des nouvelles entreprises</label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" loading={pending}>{planId ? "Enregistrer" : "Créer l'offre"}</Button>
        {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
        {state?.ok && planId && <p role="status" className="text-sm text-success">Enregistré</p>}
      </div>
    </form>
  );
}

export function SettingsForm({ billingEnabled, paymentInstructions, graceDays }: { billingEnabled: boolean; paymentInstructions: string; graceDays: number }) {
  const [state, action, pending] = useActionState(saveSettingsAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" name="billingEnabled" defaultChecked={billingEnabled} className="size-4" /> Facturation activée</label>
      <p className="text-xs text-muted">Activée : les nouvelles entreprises reçoivent l&apos;offre par défaut, et les offres s&apos;appliquent. Les entreprises déjà existantes sans abonnement gardent l&apos;accès complet.</p>
      <Field id="grace" name="graceDays" label="Délai de grâce après une échéance impayée (jours)" defaultValue={String(graceDays)} inputMode="numeric" />
      <Textarea id="payinst" name="paymentInstructions" label="Instructions de paiement affichées aux clients" defaultValue={paymentInstructions} rows={4} />
      <div className="flex items-center gap-3">
        <Button type="submit" loading={pending}>Enregistrer</Button>
        {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
        {state?.ok && <p role="status" className="text-sm text-success">Enregistré</p>}
      </div>
    </form>
  );
}

function Reason({ id }: { id: string }) {
  return <Field id={id} name="reason" label="Motif (conservé dans l'audit)" required minLength={5} />;
}

export function GrantForm({ companyId, plans }: { companyId: string; plans: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(grantAction.bind(null, companyId), undefined);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-3">
      <Select id="gplan" name="planId" label="Offre" defaultValue={plans[0]?.id}>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
      <Field id="gdays" name="days" label="Durée (jours)" defaultValue="30" inputMode="numeric" />
      <Reason id="greason" />
      <div className="flex items-center gap-3 sm:col-span-3"><Button type="submit" loading={pending}>Accorder</Button>{state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}{state?.ok && <p role="status" className="text-sm text-success">Accordé</p>}</div>
    </form>
  );
}

export function TrialForm({ companyId }: { companyId: string }) {
  const [state, action, pending] = useActionState(extendTrialAction.bind(null, companyId), undefined);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-3">
      <Field id="tdays" name="days" label="Jours ajoutés" defaultValue="7" inputMode="numeric" />
      <div className="sm:col-span-2"><Reason id="treason" /></div>
      <div className="flex items-center gap-3 sm:col-span-3"><Button type="submit" variant="secondary" loading={pending}>Prolonger l&apos;essai</Button>{state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}{state?.ok && <p role="status" className="text-sm text-success">Prolongé</p>}</div>
    </form>
  );
}

export function SuspendForm({ companyId, suspended }: { companyId: string; suspended: boolean }) {
  const [state, action, pending] = useActionState(suspendAction.bind(null, companyId, !suspended), undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="min-w-64 flex-1"><Reason id="sreason" /></div>
      <Button type="submit" variant={suspended ? "secondary" : "danger"} loading={pending}>{suspended ? "Lever la suspension" : "Suspendre l'entreprise"}</Button>
      {state?.error && <p role="alert" className="w-full text-sm text-danger">{state.error}</p>}
    </form>
  );
}

export function MarkPaidForm({ invoiceId }: { invoiceId: string }) {
  const [state, action, pending] = useActionState(markPaidAction.bind(null, invoiceId), undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <Select id={`m-${invoiceId}`} name="method" label="Moyen" defaultValue="bank_transfer"><option value="bank_transfer">Virement</option><option value="mobile_money">Mobile money</option><option value="cash">Espèces</option><option value="other">Autre</option></Select>
      <Field id={`r-${invoiceId}`} name="reference" label="Référence du paiement" required />
      <Field id={`d-${invoiceId}`} name="paidAt" type="date" label="Date" />
      <Button type="submit" loading={pending}>Marquer payée</Button>
      {state?.error && <p role="alert" className="w-full text-xs text-danger">{state.error}</p>}
    </form>
  );
}
