"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionState } from "@/lib/action";
import { requireUser } from "@/lib/session";
import { createOpportunity, moveOpportunity } from "@/modules/crm/pipeline";

export async function createOpportunityAction(companyId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const s = (k: string) => String(form.get(k) ?? "");
  const res = await runAction(async () => {
    await createOpportunity(user.id, companyId, {
      contactId: s("contactId"),
      title: s("title"),
      amount: s("amount"),
      expectedClose: s("expectedClose"),
    });
  });
  if (res?.ok) revalidatePath(`/app/${companyId}/pipeline`);
  return res;
}

export async function moveOpportunityAction(companyId: string, id: string, form: FormData) {
  const user = await requireUser();
  await moveOpportunity(user.id, companyId, id, String(form.get("stageId") ?? ""));
  revalidatePath(`/app/${companyId}`, "layout");
}
