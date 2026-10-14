"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { useResetOnSuccess } from "@/lib/use-reset-on-success";
import { formatRate } from "@/modules/sales/calc";
import { createProductAction, createTaxRateAction } from "./actions";

export function ProductForm({ companyId, currency, taxes }: { companyId: string; currency: string; taxes: { id: string; name: string; rateBp: number }[] }) {
  const [state, action, pending] = useActionState(createProductAction.bind(null, companyId), undefined);
  const ref = useResetOnSuccess(state);
  return (
    <form ref={ref} action={action} className="grid gap-3 sm:grid-cols-2">
      <Select id="kind" name="kind" label="Type" defaultValue="service">
        <option value="service">Service</option>
        <option value="product">Produit</option>
      </Select>
      <Field id="pname" name="name" label="Nom" required />
      <Field id="price" name="price" label={`Prix unitaire HT (${currency})`} inputMode="decimal" defaultValue="0" />
      <Select id="ptax" name="taxRateId" label="Taxe par défaut" defaultValue="">
        <option value="">Aucune</option>
        {taxes.map((t) => <option key={t.id} value={t.id}>{t.name} ({formatRate(t.rateBp)})</option>)}
      </Select>
      <div className="sm:col-span-2"><Field id="pdesc" name="description" label="Description" /></div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" loading={pending}>Ajouter au catalogue</Button>
        {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      </div>
    </form>
  );
}

export function TaxRateForm({ companyId }: { companyId: string }) {
  const [state, action, pending] = useActionState(createTaxRateAction.bind(null, companyId), undefined);
  const ref = useResetOnSuccess(state);
  return (
    <form ref={ref} action={action} className="flex flex-wrap items-end gap-3">
      <div className="min-w-40 flex-1"><Field id="tname" name="name" label="Nom de la taxe" required /></div>
      <div className="w-32"><Field id="trate" name="ratePercent" label="Taux (%)" inputMode="decimal" required /></div>
      <Button type="submit" loading={pending}>Ajouter</Button>
      {state?.error && <p role="alert" className="w-full text-sm text-danger">{state.error}</p>}
    </form>
  );
}
