"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionState } from "@/lib/action";
import { requireUser } from "@/lib/session";
import { createContact, parseTags, setContactArchived, updateContact } from "@/modules/crm/contacts";

function readContact(form: FormData) {
  const s = (k: string) => String(form.get(k) ?? "");
  return {
    kind: s("kind") === "organization" ? ("organization" as const) : ("person" as const),
    name: s("name"),
    email: s("email"),
    phone: s("phone"),
    organization: s("organization"),
    address: s("address"),
    notes: s("notes"),
    tags: parseTags(s("tags")),
    parentId: s("parentId") || undefined,
  };
}

export async function createContactAction(companyId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(async () => void (await createContact(user.id, companyId, readContact(form))));
  if (res?.ok) revalidatePath(`/app/${companyId}/contacts`);
  return res;
}

export async function updateContactAction(
  companyId: string,
  id: string,
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(async () => void (await updateContact(user.id, companyId, id, readContact(form))));
  if (res?.ok) revalidatePath(`/app/${companyId}/contacts`, "layout");
  return res;
}

export async function archiveContactAction(companyId: string, id: string, archived: boolean) {
  const user = await requireUser();
  await setContactArchived(user.id, companyId, id, archived);
  revalidatePath(`/app/${companyId}/contacts`, "layout");
}
