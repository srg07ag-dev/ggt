"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionState } from "@/lib/action";
import { requireUser } from "@/lib/session";
import { archiveProduct, archiveTaxRate, createProduct, createTaxRate } from "@/modules/sales/catalog";

const s = (f: FormData, k: string) => String(f.get(k) ?? "");

export async function createProductAction(companyId: string, _: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(async () => {
    await createProduct(user.id, companyId, { kind: s(f, "kind"), name: s(f, "name"), description: s(f, "description"), price: s(f, "price"), taxRateId: s(f, "taxRateId") || undefined });
  });
  if (res?.ok) revalidatePath(`/app/${companyId}/catalog`);
  return res;
}

export async function createTaxRateAction(companyId: string, _: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(async () => void (await createTaxRate(user.id, companyId, { name: s(f, "name"), ratePercent: s(f, "ratePercent") })));
  if (res?.ok) revalidatePath(`/app/${companyId}/catalog`);
  return res;
}

export async function archiveProductAction(companyId: string, id: string) {
  const user = await requireUser();
  await archiveProduct(user.id, companyId, id);
  revalidatePath(`/app/${companyId}/catalog`);
}

export async function archiveTaxRateAction(companyId: string, id: string) {
  const user = await requireUser();
  await archiveTaxRate(user.id, companyId, id);
  revalidatePath(`/app/${companyId}/catalog`);
}
