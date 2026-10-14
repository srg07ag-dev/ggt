"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runAction, type ActionState } from "@/lib/action";
import { requireUser } from "@/lib/session";
import {
  addLine,
  convertQuoteToInvoice,
  createCreditNote,
  createDraft,
  deleteDraft,
  issueDocument,
  recordPayment,
  removeLine,
  sendQuote,
  setQuoteDecision,
  updateDraftMeta,
  voidPayment,
} from "@/modules/sales/documents";

const s = (f: FormData, k: string) => String(f.get(k) ?? "");
const refresh = (companyId: string) => revalidatePath(`/app/${companyId}`, "layout");

export async function createDraftAction(companyId: string, type: "quote" | "invoice", _: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  let id = "";
  const res = await runAction(async () => {
    id = (await createDraft(user.id, companyId, { type, contactId: s(f, "contactId") })).id;
  });
  if (res?.ok) redirect(`/app/${companyId}/documents/${id}`);
  return res;
}

export async function addLineAction(companyId: string, docId: string, _: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(async () => {
    await addLine(user.id, companyId, docId, {
      productId: s(f, "productId") || undefined,
      description: s(f, "description"),
      quantity: s(f, "quantity") || "1",
      unitPrice: s(f, "unitPrice"),
      taxRateId: s(f, "taxRateId") || undefined,
    });
  });
  if (res?.ok) refresh(companyId);
  return res;
}

export async function removeLineAction(companyId: string, docId: string, lineId: string) {
  const user = await requireUser();
  await removeLine(user.id, companyId, docId, lineId);
  refresh(companyId);
}

export async function updateMetaAction(companyId: string, docId: string, _: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(() => updateDraftMeta(user.id, companyId, docId, { issueDate: s(f, "issueDate"), dueDate: s(f, "dueDate"), notes: s(f, "notes") }));
  if (res?.ok) refresh(companyId);
  return res;
}

export async function issueAction(companyId: string, docId: string): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(async () => void (await issueDocument(user.id, companyId, docId)));
  if (res?.ok) refresh(companyId);
  return res;
}

export async function sendQuoteAction(companyId: string, docId: string): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(async () => void (await sendQuote(user.id, companyId, docId)));
  if (res?.ok) refresh(companyId);
  return res;
}

export async function quoteDecisionAction(companyId: string, docId: string, decision: "accepted" | "declined"): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(() => setQuoteDecision(user.id, companyId, docId, decision));
  if (res?.ok) refresh(companyId);
  return res;
}

export async function convertAction(companyId: string, docId: string): Promise<ActionState> {
  const user = await requireUser();
  let id = "";
  const res = await runAction(async () => {
    id = (await convertQuoteToInvoice(user.id, companyId, docId)).id;
  });
  if (res?.ok) redirect(`/app/${companyId}/documents/${id}`);
  return res;
}

export async function creditNoteAction(companyId: string, docId: string): Promise<ActionState> {
  const user = await requireUser();
  let id = "";
  const res = await runAction(async () => {
    id = (await createCreditNote(user.id, companyId, docId)).id;
  });
  if (res?.ok) redirect(`/app/${companyId}/documents/${id}`);
  return res;
}

export async function deleteDraftAction(companyId: string, docId: string, back: string): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(() => deleteDraft(user.id, companyId, docId));
  if (res?.ok) redirect(`/app/${companyId}/${back}`);
  return res;
}

export async function paymentAction(companyId: string, invoiceId: string, _: ActionState, f: FormData): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(async () => {
    await recordPayment(user.id, companyId, invoiceId, { amount: s(f, "amount"), paidOn: s(f, "paidOn"), method: s(f, "method"), reference: s(f, "reference"), accountId: s(f, "accountId") || undefined });
  });
  if (res?.ok) refresh(companyId);
  return res;
}

export async function voidPaymentAction(companyId: string, paymentId: string): Promise<ActionState> {
  const user = await requireUser();
  const res = await runAction(() => voidPayment(user.id, companyId, paymentId));
  if (res?.ok) refresh(companyId);
  return res;
}
