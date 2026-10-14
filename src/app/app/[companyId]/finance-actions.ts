"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runAction, type ActionState } from "@/lib/action";
import { requireUser } from "@/lib/session";
import { UploadError } from "@/lib/storage";
import {
  addAttachment,
  archiveAccount,
  archiveSupplier,
  createAccount,
  createCategory,
  createEntry,
  createSupplier,
  deleteAttachment,
  voidEntry,
} from "@/modules/finance/finance";

const s = (f: FormData, k: string) => String(f.get(k) ?? "");
const refresh = (companyId: string) => revalidatePath(`/app/${companyId}`, "layout");

async function guarded(fn: () => Promise<void>): Promise<ActionState> {
  try {
    return await runAction(fn);
  } catch (e) {
    if (e instanceof UploadError) return { error: e.message };
    throw e;
  }
}

export async function createAccountAction(companyId: string, _: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const res = await guarded(async () => void (await createAccount(user.id, companyId, { name: s(f, "name"), kind: s(f, "kind"), openingBalance: s(f, "openingBalance") })));
  if (res?.ok) refresh(companyId);
  return res;
}

export async function archiveAccountAction(companyId: string, id: string) {
  const user = await requireUser();
  await archiveAccount(user.id, companyId, id);
  refresh(companyId);
}

export async function createSupplierAction(companyId: string, _: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const res = await guarded(async () => void (await createSupplier(user.id, companyId, { name: s(f, "name"), email: s(f, "email"), phone: s(f, "phone"), address: s(f, "address"), taxId: s(f, "taxId") })));
  if (res?.ok) refresh(companyId);
  return res;
}

export async function archiveSupplierAction(companyId: string, id: string) {
  const user = await requireUser();
  await archiveSupplier(user.id, companyId, id);
  refresh(companyId);
}

export async function createCategoryAction(companyId: string, kind: "income" | "expense", _: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const res = await guarded(async () => void (await createCategory(user.id, companyId, { kind, name: s(f, "name") })));
  if (res?.ok) refresh(companyId);
  return res;
}

export async function createEntryAction(companyId: string, kind: "income" | "expense", _: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  let id = "";
  const res = await guarded(async () => {
    id = (
      await createEntry(user.id, companyId, {
        kind,
        accountId: s(f, "accountId"),
        amount: s(f, "amount"),
        tax: s(f, "tax"),
        occurredOn: s(f, "occurredOn"),
        categoryId: s(f, "categoryId") || undefined,
        supplierId: s(f, "supplierId") || undefined,
        contactId: s(f, "contactId") || undefined,
        description: s(f, "description"),
        reference: s(f, "reference"),
      })
    ).id;
    const file = f.get("file");
    if (file instanceof File && file.size > 0) {
      await addAttachment(user.id, companyId, id, { name: file.name, data: Buffer.from(await file.arrayBuffer()) });
    }
  });
  if (res?.ok) {
    refresh(companyId);
    redirect(`/app/${companyId}/entries/${id}`);
  }
  return res;
}

export async function voidEntryAction(companyId: string, id: string): Promise<ActionState> {
  const user = await requireUser();
  const res = await guarded(() => voidEntry(user.id, companyId, id));
  if (res?.ok) refresh(companyId);
  return res;
}

export async function uploadAttachmentAction(companyId: string, entryId: string, _: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const res = await guarded(async () => {
    const file = f.get("file");
    if (!(file instanceof File) || file.size === 0) throw new UploadError("Choisissez un fichier.");
    await addAttachment(user.id, companyId, entryId, { name: file.name, data: Buffer.from(await file.arrayBuffer()) });
  });
  if (res?.ok) refresh(companyId);
  return res;
}

export async function deleteAttachmentAction(companyId: string, id: string): Promise<ActionState> {
  const user = await requireUser();
  const res = await guarded(async () => void (await deleteAttachment(user.id, companyId, id)));
  if (res?.ok) refresh(companyId);
  return res;
}
