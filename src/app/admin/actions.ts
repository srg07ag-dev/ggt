"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runAction, type ActionState } from "@/lib/action";
import { requireUser } from "@/lib/session";
import { adminMarkInvoicePaid, adminVoidInvoice, extendTrial, grantComplimentary, setSuspended } from "@/modules/billing/admin";
import { archivePlan, createPlan, updatePlan, type PlanInput } from "@/modules/billing/plans";
import { savePlatformSettings } from "@/modules/billing/platform";
import { MODULES } from "@/modules/core/entitlements";

const s = (f: FormData, k: string) => String(f.get(k) ?? "");
const refresh = () => revalidatePath("/admin", "layout");

export async function savePlanAction(planId: string | undefined, _: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const input: PlanInput = {
    code: s(f, "code"), name: s(f, "name"), description: s(f, "description"), currency: s(f, "currency"), price: s(f, "price"),
    interval: s(f, "interval") === "year" ? "year" : "month", trialDays: s(f, "trialDays") || "0",
    members: s(f, "members") as never, invoicesPerMonth: s(f, "invoicesPerMonth") as never, storageMb: s(f, "storageMb") as never,
    modules: f.getAll("modules").map(String).filter((m): m is (typeof MODULES)[number] => (MODULES as readonly string[]).includes(m)),
    isPublic: s(f, "isPublic") === "on", isDefault: s(f, "isDefault") === "on",
  };
  const res = await runAction(async () => void (planId ? await updatePlan(user.id, planId, input) : await createPlan(user.id, input)));
  if (res?.ok) {
    refresh();
    if (!planId) redirect("/admin/plans");
  }
  return res;
}

export async function archivePlanAction(id: string, archived: boolean): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(() => archivePlan(user.id, id, archived));
  if (res?.ok) refresh();
  return res;
}

export async function saveSettingsAction(_: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(() => savePlatformSettings(user.id, { billingEnabled: s(f, "billingEnabled") === "on", paymentInstructions: s(f, "paymentInstructions"), graceDays: Number(s(f, "graceDays") || 7) }));
  if (res?.ok) refresh();
  return res;
}

export async function grantAction(companyId: string, _: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(() => grantComplimentary(user.id, companyId, s(f, "planId"), Number(s(f, "days")), s(f, "reason")));
  if (res?.ok) refresh();
  return res;
}

export async function extendTrialAction(companyId: string, _: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(() => extendTrial(user.id, companyId, Number(s(f, "days")), s(f, "reason")));
  if (res?.ok) refresh();
  return res;
}

export async function suspendAction(companyId: string, suspended: boolean, _: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(() => setSuspended(user.id, companyId, suspended, s(f, "reason")));
  if (res?.ok) refresh();
  return res;
}

export async function markPaidAction(invoiceId: string, _: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(async () => void (await adminMarkInvoicePaid(user.id, invoiceId, { method: s(f, "method"), reference: s(f, "reference"), paidAt: s(f, "paidAt") || undefined })));
  if (res?.ok) refresh();
  return res;
}

export async function voidInvoiceAction(invoiceId: string): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(() => adminVoidInvoice(user.id, invoiceId));
  if (res?.ok) refresh();
  return res;
}
