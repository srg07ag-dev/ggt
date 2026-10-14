"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runAction, type ActionState } from "@/lib/action";
import { requireUser } from "@/lib/session";
import { changeRole, createInvitation, removeMember, revokeInvitation } from "@/modules/core/members";

export type InviteState = (NonNullable<ActionState> & { path?: string }) | undefined;

const s = (f: FormData, k: string) => String(f.get(k) ?? "");
const refresh = (companyId: string) => revalidatePath(`/app/${companyId}/members`);

export async function inviteAction(companyId: string, _: InviteState, f: FormData): Promise<InviteState> {
  const user = await requireUser();
  let path = "";
  const res = await runAction(async () => {
    const { token } = await createInvitation(user.id, companyId, { email: s(f, "email"), role: s(f, "role") });
    path = `/invite/${token}`;
  });
  if (res?.ok) refresh(companyId);
  return res?.ok ? { ...res, path } : res;
}

export async function revokeInvitationAction(companyId: string, id: string): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(() => revokeInvitation(user.id, companyId, id));
  if (res?.ok) refresh(companyId);
  return res;
}

export async function changeRoleAction(companyId: string, targetUserId: string, _: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(() => changeRole(user.id, companyId, targetUserId, s(f, "role")));
  if (res?.ok) revalidatePath(`/app/${companyId}`, "layout");
  return res;
}

export async function removeMemberAction(companyId: string, targetUserId: string): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(() => removeMember(user.id, companyId, targetUserId));
  if (res?.ok && targetUserId === user.id) redirect("/app");
  if (res?.ok) revalidatePath(`/app/${companyId}`, "layout");
  return res;
}
