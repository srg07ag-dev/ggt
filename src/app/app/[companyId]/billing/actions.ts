"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionState } from "@/lib/action";
import { requireUser } from "@/lib/session";
import { cancelPendingRequest, cancelSubscription, requestPlan, resumeSubscription } from "@/modules/billing/subscriptions";

const refresh = (companyId: string) => revalidatePath(`/app/${companyId}`, "layout");

export async function requestPlanAction(companyId: string, planId: string): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(async () => void (await requestPlan(user.id, companyId, planId)));
  if (res?.ok) refresh(companyId);
  return res;
}

export async function cancelSubscriptionAction(companyId: string): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(() => cancelSubscription(user.id, companyId));
  if (res?.ok) refresh(companyId);
  return res;
}

export async function resumeSubscriptionAction(companyId: string): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(() => resumeSubscription(user.id, companyId));
  if (res?.ok) refresh(companyId);
  return res;
}

export async function cancelRequestAction(companyId: string): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(() => cancelPendingRequest(user.id, companyId));
  if (res?.ok) refresh(companyId);
  return res;
}
