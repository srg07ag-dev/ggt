"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runAction, type ActionState } from "@/lib/action";
import { requireUser } from "@/lib/session";
import { createLedgerAccount, importChart, parseChartCsv, renameLedgerAccount, setLedgerAccountArchived, type ChartParse } from "@/modules/accounting/chart";
import { createDraftEntry, deleteDraftEntry, postEntry, reverseEntry, updateDraftEntry, type ManualLine } from "@/modules/accounting/entries";
import { createPeriod, closePeriod, reopenPeriod } from "@/modules/accounting/periods";
import { saveAccountingSettings, setLedgerMapping } from "@/modules/accounting/posting";

const s = (f: FormData, k: string) => String(f.get(k) ?? "");
const refresh = (companyId: string) => revalidatePath(`/app/${companyId}`, "layout");

export async function createAccountAction(companyId: string, _: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(async () => void (await createLedgerAccount(user.id, companyId, { code: s(f, "code"), name: s(f, "name"), type: s(f, "type") as "asset" })));
  if (res?.ok) refresh(companyId);
  return res;
}

export async function renameAccountAction(companyId: string, id: string, _: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(() => renameLedgerAccount(user.id, companyId, id, s(f, "name")));
  if (res?.ok) refresh(companyId);
  return res;
}

export async function archiveAccountAction(companyId: string, id: string, archived: boolean): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(() => setLedgerAccountArchived(user.id, companyId, id, archived));
  if (res?.ok) refresh(companyId);
  return res;
}

export type PreviewState = ({ ok?: boolean; error?: string; parsed?: ChartParse; csv?: string; imported?: number }) | undefined;

/** Étape 1 : lecture et contrôle du fichier, sans rien écrire. */
export async function previewChartAction(_: PreviewState, f: FormData): Promise<PreviewState> {
  await requireUser();
  const file = f.get("file");
  const text = file instanceof File && file.size > 0 ? await file.text() : s(f, "csv");
  if (!text.trim()) return { error: "Choisissez un fichier ou collez le contenu." };
  if (text.length > 2_000_000) return { error: "Fichier trop volumineux." };
  return { parsed: parseChartCsv(text), csv: text };
}

/** Étape 2 : import après confirmation de l'aperçu (tout ou rien). */
export async function confirmChartAction(companyId: string, _: PreviewState, f: FormData): Promise<PreviewState> {
  const user = await requireUser();
  let imported = 0;
  const res = await runAction(async () => {
    imported = (await importChart(user.id, companyId, s(f, "csv"))).imported;
  });
  if (res?.ok) refresh(companyId);
  return res?.ok ? { ok: true, imported } : { error: res?.error };
}

export async function createPeriodAction(companyId: string, _: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(async () => void (await createPeriod(user.id, companyId, { name: s(f, "name"), startDate: s(f, "startDate"), endDate: s(f, "endDate") })));
  if (res?.ok) refresh(companyId);
  return res;
}

export async function closePeriodAction(companyId: string, id: string): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(() => closePeriod(user.id, companyId, id));
  if (res?.ok) refresh(companyId);
  return res;
}

export async function reopenPeriodAction(companyId: string, id: string, _: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(() => reopenPeriod(user.id, companyId, id, s(f, "reason")));
  if (res?.ok) refresh(companyId);
  return res;
}

function readLines(f: FormData): ManualLine[] {
  const acc = f.getAll("accountId").map(String);
  const deb = f.getAll("debit").map(String);
  const cre = f.getAll("credit").map(String);
  const des = f.getAll("lineDescription").map(String);
  return acc.map((accountId, i) => ({ accountId, debit: deb[i], credit: cre[i], description: des[i] })).filter((l) => l.accountId || l.debit || l.credit);
}

export async function saveEntryAction(companyId: string, entryId: string | undefined, _: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  let id = entryId ?? "";
  const res = await runAction(async () => {
    const input = { journalId: s(f, "journalId"), entryDate: s(f, "entryDate"), description: s(f, "description"), lines: readLines(f) };
    if (entryId) await updateDraftEntry(user.id, companyId, entryId, input);
    else id = (await createDraftEntry(user.id, companyId, input)).id;
  });
  if (res?.ok) {
    refresh(companyId);
    if (!entryId) redirect(`/app/${companyId}/accounting/entries/${id}`);
  }
  return res;
}

export async function postEntryAction(companyId: string, id: string): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(async () => void (await postEntry(user.id, companyId, id)));
  if (res?.ok) refresh(companyId);
  return res;
}

export async function deleteEntryAction(companyId: string, id: string): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(() => deleteDraftEntry(user.id, companyId, id));
  if (res?.ok) redirect(`/app/${companyId}/accounting/entries`);
  return res;
}

export async function reverseEntryAction(companyId: string, id: string, _: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  let newId = "";
  const res = await runAction(async () => {
    newId = (await reverseEntry(user.id, companyId, id, { date: s(f, "date") || undefined })).id;
  });
  if (res?.ok) {
    refresh(companyId);
    redirect(`/app/${companyId}/accounting/entries/${newId}`);
  }
  return res;
}

export async function saveSettingsAction(companyId: string, _: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const v = (k: string) => s(f, k) || undefined;
  const res = await runAction(() =>
    saveAccountingSettings(user.id, companyId, {
      enabled: s(f, "enabled") === "on",
      enabledFrom: v("enabledFrom"),
      receivableAccountId: v("receivableAccountId"),
      revenueAccountId: v("revenueAccountId"),
      taxCollectedAccountId: v("taxCollectedAccountId"),
      taxDeductibleAccountId: v("taxDeductibleAccountId"),
      expenseAccountId: v("expenseAccountId"),
      otherIncomeAccountId: v("otherIncomeAccountId"),
      salesJournalId: v("salesJournalId"),
      purchasesJournalId: v("purchasesJournalId"),
      treasuryJournalId: v("treasuryJournalId"),
    }),
  );
  if (res?.ok) refresh(companyId);
  return res;
}

export async function setMappingAction(companyId: string, kind: "finance_account" | "tax_rate" | "finance_category" | "product", id: string, _: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(() => setLedgerMapping(user.id, companyId, { kind, id }, s(f, "ledgerAccountId") || null));
  if (res?.ok) refresh(companyId);
  return res;
}
