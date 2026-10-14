"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runAction, type ActionState } from "@/lib/action";
import { requireUser } from "@/lib/session";
import { createObligation, deleteObligation, recordTaxEvent, saveTaxProfile, setObligationNotApplicable } from "@/modules/tax/obligations";

const s = (f: FormData, k: string) => String(f.get(k) ?? "");
const refresh = (companyId: string) => revalidatePath(`/app/${companyId}`, "layout");

export async function saveProfileAction(companyId: string, _: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(() => saveTaxProfile(user.id, companyId, { regimeLabel: s(f, "regimeLabel"), vatRegistered: s(f, "vatRegistered") as "yes", filingFrequency: s(f, "filingFrequency"), notes: s(f, "notes") }));
  if (res?.ok) refresh(companyId);
  return res;
}

export async function createObligationAction(companyId: string, _: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(async () => void (await createObligation(user.id, companyId, { title: s(f, "title"), authority: s(f, "authority"), periodLabel: s(f, "periodLabel"), dueDate: s(f, "dueDate"), notes: s(f, "notes") })));
  if (res?.ok) refresh(companyId);
  return res;
}

export async function recordEventAction(companyId: string, obligationId: string, _: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(async () => void (await recordTaxEvent(user.id, companyId, obligationId, { kind: s(f, "kind"), occurredOn: s(f, "occurredOn"), amount: s(f, "amount"), reference: s(f, "reference"), notes: s(f, "notes") })));
  if (res?.ok) refresh(companyId);
  return res;
}

export async function notApplicableAction(companyId: string, id: string, value: boolean): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(() => setObligationNotApplicable(user.id, companyId, id, value));
  if (res?.ok) refresh(companyId);
  return res;
}

export async function deleteObligationAction(companyId: string, id: string): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(() => deleteObligation(user.id, companyId, id));
  if (res?.ok) redirect(`/app/${companyId}/tax`);
  return res;
}
