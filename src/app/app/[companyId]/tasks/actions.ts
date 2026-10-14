"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionState } from "@/lib/action";
import { requireUser } from "@/lib/session";
import { createActivity, setActivityStatus } from "@/modules/crm/activities";

export async function createActivityAction(companyId: string, contactId: string | undefined, _: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const s = (k: string) => String(form.get(k) ?? "");
  const res = await runAction(async () => {
    await createActivity(user.id, companyId, {
      type: s("type") as "call",
      title: s("title"),
      priority: (s("priority") || "normal") as "normal",
      dueAt: s("dueAt"),
      contactId: contactId ?? (s("contactId") || undefined),
      assigneeId: s("assigneeId") || user.id,
    });
  });
  if (res?.ok) revalidatePath(`/app/${companyId}`, "layout");
  return res;
}

export async function setActivityStatusAction(companyId: string, id: string, status: "todo" | "done" | "cancelled") {
  const user = await requireUser();
  await setActivityStatus(user.id, companyId, id, status);
  revalidatePath(`/app/${companyId}`, "layout");
}
