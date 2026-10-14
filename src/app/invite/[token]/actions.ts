"use server";

import { redirect } from "next/navigation";
import { runAction, type ActionState } from "@/lib/action";
import { requireUser } from "@/lib/session";
import { acceptInvitation } from "@/modules/core/members";

export async function acceptInvitationAction(token: string): Promise<ActionState> {
  const user = await requireUser();
  let companyId = "";
  const res = await runAction(async () => {
    companyId = (await acceptInvitation(user.id, user.email, token)).companyId;
  });
  if (res?.ok) redirect(`/app/${companyId}`);
  return res;
}
