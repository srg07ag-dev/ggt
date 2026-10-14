"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionState } from "@/lib/action";
import { requireUser } from "@/lib/session";
import { setNumbering, updateCompanyProfile } from "@/modules/core/settings";
import type { DocType } from "@/modules/sales/numbering";

const s = (f: FormData, k: string) => String(f.get(k) ?? "");

export async function updateProfileAction(companyId: string, _: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(() => updateCompanyProfile(user.id, companyId, { name: s(f, "name"), address: s(f, "address"), taxId: s(f, "taxId"), email: s(f, "email"), phone: s(f, "phone") }));
  if (res?.ok) revalidatePath(`/app/${companyId}`, "layout");
  return res;
}

export async function updateNumberingAction(companyId: string, _: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(async () => {
    for (const t of ["quote", "invoice", "credit_note"] as DocType[]) {
      const p = s(f, t).trim();
      if (p) await setNumbering(user.id, companyId, t, p);
    }
  });
  if (res?.ok) revalidatePath(`/app/${companyId}/settings`);
  return res;
}
