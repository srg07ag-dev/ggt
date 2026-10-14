import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@/db/client";
import { addDays, todayIn } from "@/lib/dates";
import { toMinor } from "@/lib/money";
import { audit, ForbiddenError, requireMembership, withTenant, type TenantContext, type TenantTx } from "@/modules/core/tenant";
import { computeLine, computeTotals, parseQuantity } from "./calc";
import { nextNumber, type DocType } from "./numbering";

export class BusinessRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BusinessRuleError";
  }
}
const rule = (m: string) => new BusinessRuleError(m);
const fail = (path: string, message: string) => new z.ZodError([{ code: "custom", path: [path], message }]);

type Doc = typeof schema.salesDocument.$inferSelect;

/* ---------- Lecture ---------- */

export interface Settlement {
  paidMinor: number;
  creditedMinor: number;
  outstandingMinor: number;
  /** « paid » uniquement si des paiements enregistrés couvrent le total. */
  state: "unpaid" | "partial" | "paid" | "overdue" | "settled_by_credit";
}

export function settlement(doc: Pick<Doc, "totalMinor" | "dueDate" | "status">, paidMinor: number, creditedMinor: number, today: string): Settlement {
  const outstandingMinor = Math.max(0, doc.totalMinor - paidMinor - creditedMinor);
  let state: Settlement["state"] = "unpaid";
  if (doc.status === "issued") {
    if (outstandingMinor === 0) state = creditedMinor > 0 && paidMinor + creditedMinor >= doc.totalMinor && paidMinor < doc.totalMinor ? "settled_by_credit" : "paid";
    else if (paidMinor > 0) state = doc.dueDate && doc.dueDate < today ? "overdue" : "partial";
    else state = doc.dueDate && doc.dueDate < today ? "overdue" : "unpaid";
  }
  return { paidMinor, creditedMinor, outstandingMinor, state };
}

async function companyInfo(tx: TenantTx, companyId: string) {
  const [c] = await tx.select().from(schema.company).where(eq(schema.company.id, companyId));
  return c!;
}

export async function getDocument(userId: string, companyId: string, id: string) {
  const ctx = await requireMembership(userId, companyId, "sales:read");
  return withTenant(ctx, async (tx) => {
    const [doc] = await tx.select().from(schema.salesDocument).where(eq(schema.salesDocument.id, id));
    if (!doc) return null;
    const co = await companyInfo(tx, companyId);
    const [lines, payments, [contact], related, credits] = await Promise.all([
      tx.select().from(schema.salesLine).where(eq(schema.salesLine.documentId, id)).orderBy(asc(schema.salesLine.position)),
      tx.select().from(schema.payment).where(eq(schema.payment.invoiceId, id)).orderBy(asc(schema.payment.paidOn), asc(schema.payment.createdAt)),
      tx.select().from(schema.contact).where(eq(schema.contact.id, doc.contactId)),
      doc.relatedId ? tx.select().from(schema.salesDocument).where(eq(schema.salesDocument.id, doc.relatedId)) : Promise.resolve([]),
      doc.type === "invoice"
        ? tx
            .select()
            .from(schema.salesDocument)
            .where(and(eq(schema.salesDocument.relatedId, id), eq(schema.salesDocument.type, "credit_note")))
        : Promise.resolve([]),
    ]);
    const paid = payments.filter((p) => !p.voidedAt).reduce((n, p) => n + p.amountMinor, 0);
    const credited = credits.filter((c) => c.status === "issued").reduce((n, c) => n + c.totalMinor, 0);
    return {
      doc,
      lines,
      payments,
      contact: contact!,
      related: related[0] ?? null,
      credits,
      company: co,
      settlement: settlement(doc, paid, credited, todayIn(co.timezone)),
    };
  });
}

export async function listDocuments(userId: string, companyId: string, type: DocType) {
  const ctx = await requireMembership(userId, companyId, "sales:read");
  return withTenant(ctx, async (tx) => {
    const co = await companyInfo(tx, companyId);
    const rows = await tx
      .select({
        id: schema.salesDocument.id,
        type: schema.salesDocument.type,
        number: schema.salesDocument.number,
        status: schema.salesDocument.status,
        issueDate: schema.salesDocument.issueDate,
        dueDate: schema.salesDocument.dueDate,
        totalMinor: schema.salesDocument.totalMinor,
        currency: schema.salesDocument.currency,
        contactId: schema.salesDocument.contactId,
        contactName: schema.contact.name,
        paid: sql<number>`coalesce((select sum(p.amount_minor) from payment p where p.invoice_id = ${schema.salesDocument.id} and p.voided_at is null), 0)::float8`,
        credited: sql<number>`coalesce((select sum(c.total_minor) from sales_document c where c.related_id = ${schema.salesDocument.id} and c.type = 'credit_note' and c.status = 'issued'), 0)::float8`,
      })
      .from(schema.salesDocument)
      .innerJoin(
        schema.contact,
        and(eq(schema.contact.id, schema.salesDocument.contactId), eq(schema.contact.companyId, schema.salesDocument.companyId)),
      )
      .where(eq(schema.salesDocument.type, type))
      .orderBy(desc(schema.salesDocument.createdAt));
    const today = todayIn(co.timezone);
    return rows.map((r) => ({ ...r, settlement: settlement(r, Number(r.paid), Number(r.credited), today) }));
  });
}

/* ---------- Brouillons et lignes ---------- */

const draftInput = z.object({
  type: z.enum(["quote", "invoice"]),
  contactId: z.string().uuid(),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dueDate: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional().transform((v) => v || undefined),
  notes: z.string().max(2000).optional(),
});

export async function createDraft(userId: string, companyId: string, input: z.input<typeof draftInput>) {
  const data = draftInput.parse(input);
  const ctx = await requireMembership(userId, companyId, "sales:write");
  return withTenant(ctx, async (tx) => {
    const co = await companyInfo(tx, companyId);
    const issueDate = data.issueDate ?? todayIn(co.timezone);
    const [row] = await tx
      .insert(schema.salesDocument)
      .values({
        companyId,
        type: data.type,
        contactId: data.contactId,
        issueDate,
        dueDate: data.dueDate ?? (data.type === "invoice" ? addDays(issueDate, 30) : addDays(issueDate, 30)),
        currency: co.currency,
        notes: data.notes,
        createdBy: userId,
      })
      .returning();
    await audit(tx, ctx, `${data.type}.draft_created`, "sales_document", row!.id);
    return row!;
  });
}

async function loadDraft(tx: TenantTx, id: string) {
  const [doc] = await tx.select().from(schema.salesDocument).where(eq(schema.salesDocument.id, id)).for("update");
  if (!doc) throw new ForbiddenError();
  if (doc.status !== "draft") throw rule("Ce document n'est plus modifiable.");
  return doc;
}

async function recalc(tx: TenantTx, docId: string) {
  const lines = await tx.select().from(schema.salesLine).where(eq(schema.salesLine.documentId, docId));
  await tx.update(schema.salesDocument).set(computeTotals(lines)).where(eq(schema.salesDocument.id, docId));
}

export interface LineForm {
  productId?: string;
  description?: string;
  quantity: string;
  unitPrice?: string;
  taxRateId?: string;
}

export async function addLine(userId: string, companyId: string, docId: string, input: LineForm) {
  const ctx = await requireMembership(userId, companyId, "sales:write");
  return withTenant(ctx, async (tx) => {
    const doc = await loadDraft(tx, docId);
    const quantityMilli = parseQuantity(input.quantity || "1");
    if (quantityMilli === null) throw fail("quantity", "Quantité invalide.");

    let product: typeof schema.product.$inferSelect | undefined;
    if (input.productId) {
      [product] = await tx.select().from(schema.product).where(eq(schema.product.id, input.productId));
      if (!product) throw new ForbiddenError();
    }
    const description = (input.description?.trim() || product?.name || "").slice(0, 400);
    if (!description) throw fail("description", "Description requise.");

    const unitPriceMinor = input.unitPrice?.trim() ? toMinor(input.unitPrice, doc.currency) : (product?.unitPriceMinor ?? 0);
    if (unitPriceMinor === null) throw fail("unitPrice", "Prix invalide.");

    const taxRateId = input.taxRateId || product?.taxRateId || undefined;
    let taxRateBp = 0;
    let taxName: string | null = null;
    if (taxRateId) {
      const [tr] = await tx.select().from(schema.taxRate).where(eq(schema.taxRate.id, taxRateId));
      if (!tr) throw new ForbiddenError();
      taxRateBp = tr.rateBp;
      taxName = tr.name;
    }

    const [{ max } = { max: 0 }] = await tx
      .select({ max: sql<number>`coalesce(max(${schema.salesLine.position}), 0)::int` })
      .from(schema.salesLine)
      .where(eq(schema.salesLine.documentId, docId));
    const amounts = computeLine({ quantityMilli, unitPriceMinor, taxRateBp });
    await tx.insert(schema.salesLine).values({
      companyId,
      documentId: docId,
      position: max + 1,
      productId: product?.id,
      description,
      quantityMilli,
      unitPriceMinor,
      taxName,
      taxRateBp,
      ...amounts,
    });
    await recalc(tx, docId);
    await audit(tx, ctx, "document.line_added", "sales_document", docId);
  });
}

export async function removeLine(userId: string, companyId: string, docId: string, lineId: string) {
  const ctx = await requireMembership(userId, companyId, "sales:write");
  await withTenant(ctx, async (tx) => {
    await loadDraft(tx, docId);
    await tx.delete(schema.salesLine).where(and(eq(schema.salesLine.id, lineId), eq(schema.salesLine.documentId, docId)));
    await recalc(tx, docId);
    await audit(tx, ctx, "document.line_removed", "sales_document", docId);
  });
}

export async function updateDraftMeta(
  userId: string,
  companyId: string,
  docId: string,
  input: { issueDate: string; dueDate?: string; notes?: string },
) {
  const data = z
    .object({
      issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      dueDate: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional().transform((v) => v || null),
      notes: z.string().max(2000).optional().transform((v) => v || null),
    })
    .parse(input);
  const ctx = await requireMembership(userId, companyId, "sales:write");
  await withTenant(ctx, async (tx) => {
    await loadDraft(tx, docId);
    if (data.dueDate && data.dueDate < data.issueDate) throw fail("dueDate", "L'échéance précède la date d'émission.");
    await tx.update(schema.salesDocument).set(data).where(eq(schema.salesDocument.id, docId));
  });
}

export async function deleteDraft(userId: string, companyId: string, docId: string) {
  const ctx = await requireMembership(userId, companyId, "sales:write");
  await withTenant(ctx, async (tx) => {
    await loadDraft(tx, docId);
    await tx.delete(schema.salesDocument).where(eq(schema.salesDocument.id, docId));
    await audit(tx, ctx, "document.draft_deleted", "sales_document", docId);
  });
}

/* ---------- Émission ---------- */

async function buildSnapshot(tx: TenantTx, doc: Doc) {
  const co = await companyInfo(tx, doc.companyId);
  const [c] = await tx.select().from(schema.contact).where(eq(schema.contact.id, doc.contactId));
  return {
    seller: { name: co.name, country: co.country, address: co.address, taxId: co.taxId, email: co.email, phone: co.phone },
    customer: { name: c!.name, organization: c!.organization, address: c!.address, email: c!.email, phone: c!.phone },
  };
}

async function finalize(tx: TenantTx, ctx: TenantContext, doc: Doc, status: "sent" | "issued") {
  const [{ n } = { n: 0 }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.salesLine)
    .where(eq(schema.salesLine.documentId, doc.id));
  if (n === 0) throw rule("Ajoutez au moins une ligne avant de continuer.");
  if (doc.totalMinor <= 0) throw rule("Le total doit être supérieur à zéro.");
  const number = await nextNumber(tx, ctx.companyId, doc.type, doc.issueDate);
  const snapshot = await buildSnapshot(tx, doc);
  await tx
    .update(schema.salesDocument)
    .set({ status, number, snapshot, issuedAt: new Date() })
    .where(eq(schema.salesDocument.id, doc.id));
  await audit(tx, ctx, `${doc.type}.${status}`, "sales_document", doc.id, { number });
  return number;
}

/** Émet une facture ou un avoir : numéro attribué, identités figées, document verrouillé. */
export async function issueDocument(userId: string, companyId: string, docId: string) {
  const ctx = await requireMembership(userId, companyId, "sales:write");
  return withTenant(ctx, async (tx) => {
    const doc = await loadDraft(tx, docId);
    if (doc.type === "quote") throw rule("Un devis s'envoie, il ne s'émet pas.");
    if (doc.type === "credit_note") {
      const [inv] = await tx.select().from(schema.salesDocument).where(eq(schema.salesDocument.id, doc.relatedId!)).for("update");
      if (!inv || inv.status !== "issued") throw rule("La facture d'origine n'est pas émise.");
      const [{ credited } = { credited: 0 }] = await tx
        .select({ credited: sql<number>`coalesce(sum(total_minor), 0)::float8` })
        .from(schema.salesDocument)
        .where(and(eq(schema.salesDocument.relatedId, inv.id), eq(schema.salesDocument.type, "credit_note"), eq(schema.salesDocument.status, "issued")));
      if (Number(credited) + doc.totalMinor > inv.totalMinor) throw rule("Les avoirs dépasseraient le montant de la facture.");
    }
    return finalize(tx, ctx, doc, "issued");
  });
}

/* ---------- Devis ---------- */

export async function sendQuote(userId: string, companyId: string, docId: string) {
  const ctx = await requireMembership(userId, companyId, "sales:write");
  return withTenant(ctx, async (tx) => {
    const doc = await loadDraft(tx, docId);
    if (doc.type !== "quote") throw rule("Ce document n'est pas un devis.");
    return finalize(tx, ctx, doc, "sent");
  });
}

export async function setQuoteDecision(userId: string, companyId: string, docId: string, decision: "accepted" | "declined") {
  const ctx = await requireMembership(userId, companyId, "sales:write");
  await withTenant(ctx, async (tx) => {
    const [doc] = await tx.select().from(schema.salesDocument).where(eq(schema.salesDocument.id, docId)).for("update");
    if (!doc) throw new ForbiddenError();
    if (doc.type !== "quote" || doc.status !== "sent") throw rule("Seul un devis envoyé peut être accepté ou refusé.");
    await tx.update(schema.salesDocument).set({ status: decision }).where(eq(schema.salesDocument.id, docId));
    await audit(tx, ctx, `quote.${decision}`, "sales_document", docId);
  });
}

async function copyLines(tx: TenantTx, fromId: string, toId: string, companyId: string) {
  const lines = await tx.select().from(schema.salesLine).where(eq(schema.salesLine.documentId, fromId)).orderBy(asc(schema.salesLine.position));
  if (lines.length) {
    await tx.insert(schema.salesLine).values(
      lines.map((l) => ({ ...l, id: undefined, companyId, documentId: toId })),
    );
  }
  await recalc(tx, toId);
}

export async function convertQuoteToInvoice(userId: string, companyId: string, quoteId: string) {
  const ctx = await requireMembership(userId, companyId, "sales:write");
  return withTenant(ctx, async (tx) => {
    const [q] = await tx.select().from(schema.salesDocument).where(eq(schema.salesDocument.id, quoteId)).for("update");
    if (!q) throw new ForbiddenError();
    if (q.type !== "quote" || q.status !== "accepted") throw rule("Seul un devis accepté peut être converti en facture.");
    const co = await companyInfo(tx, companyId);
    const issueDate = todayIn(co.timezone);
    const [inv] = await tx
      .insert(schema.salesDocument)
      .values({ companyId, type: "invoice", contactId: q.contactId, relatedId: q.id, issueDate, dueDate: addDays(issueDate, 30), currency: q.currency, notes: q.notes, createdBy: userId })
      .returning();
    await copyLines(tx, q.id, inv!.id, companyId);
    await tx.update(schema.salesDocument).set({ status: "converted" }).where(eq(schema.salesDocument.id, q.id));
    await audit(tx, ctx, "quote.converted", "sales_document", q.id, { invoiceId: inv!.id });
    return inv!;
  });
}

/* ---------- Avoirs ---------- */

/** Crée un avoir brouillon qui reprend les lignes de la facture ; il peut être ajusté avant émission. */
export async function createCreditNote(userId: string, companyId: string, invoiceId: string) {
  const ctx = await requireMembership(userId, companyId, "sales:write");
  return withTenant(ctx, async (tx) => {
    const [inv] = await tx.select().from(schema.salesDocument).where(eq(schema.salesDocument.id, invoiceId));
    if (!inv || inv.type !== "invoice") throw new ForbiddenError();
    if (inv.status !== "issued") throw rule("Seule une facture émise peut faire l'objet d'un avoir.");
    const co = await companyInfo(tx, companyId);
    const [cn] = await tx
      .insert(schema.salesDocument)
      .values({ companyId, type: "credit_note", contactId: inv.contactId, relatedId: inv.id, issueDate: todayIn(co.timezone), currency: inv.currency, createdBy: userId })
      .returning();
    await copyLines(tx, inv.id, cn!.id, companyId);
    await audit(tx, ctx, "credit_note.draft_created", "sales_document", cn!.id, { invoiceId });
    return cn!;
  });
}

/* ---------- Paiements ---------- */

export const PAYMENT_METHODS = ["cash", "bank_transfer", "mobile_money", "card", "cheque", "other"] as const;

export async function recordPayment(
  userId: string,
  companyId: string,
  invoiceId: string,
  input: { amount: string; paidOn: string; method: string; reference?: string; accountId?: string },
) {
  const data = z
    .object({
      accountId: z.string().uuid().optional(),
      paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide"),
      method: z.enum(PAYMENT_METHODS),
      reference: z.string().trim().max(120).optional().transform((v) => v || null),
    })
    .parse(input);
  const ctx = await requireMembership(userId, companyId, "sales:write");
  return withTenant(ctx, async (tx) => {
    // verrou : deux paiements simultanés ne peuvent pas dépasser le solde
    const [inv] = await tx.select().from(schema.salesDocument).where(eq(schema.salesDocument.id, invoiceId)).for("update");
    if (!inv) throw new ForbiddenError();
    if (inv.type !== "invoice" || inv.status !== "issued") throw rule("Les paiements s'enregistrent sur une facture émise.");
    const amountMinor = toMinor(input.amount, inv.currency);
    if (!amountMinor || amountMinor <= 0) throw fail("amount", "Montant invalide.");
    const [{ paid } = { paid: 0 }] = await tx
      .select({ paid: sql<number>`coalesce(sum(amount_minor), 0)::float8` })
      .from(schema.payment)
      .where(and(eq(schema.payment.invoiceId, invoiceId), sql`voided_at is null`));
    const [{ credited } = { credited: 0 }] = await tx
      .select({ credited: sql<number>`coalesce(sum(total_minor), 0)::float8` })
      .from(schema.salesDocument)
      .where(and(eq(schema.salesDocument.relatedId, invoiceId), eq(schema.salesDocument.type, "credit_note"), eq(schema.salesDocument.status, "issued")));
    const outstanding = inv.totalMinor - Number(paid) - Number(credited);
    if (amountMinor > outstanding) throw rule("Le paiement dépasse le solde restant dû.");
    if (data.accountId) {
      const [acc] = await tx.select().from(schema.financeAccount).where(eq(schema.financeAccount.id, data.accountId));
      if (!acc) throw new ForbiddenError();
      if (acc.archivedAt) throw rule("Ce compte est archivé.");
    }
    const [row] = await tx
      .insert(schema.payment)
      .values({ companyId, invoiceId, amountMinor, paidOn: data.paidOn, accountId: data.accountId, method: data.method, reference: data.reference, createdBy: userId })
      .returning();
    await audit(tx, ctx, "payment.recorded", "payment", row!.id, { invoiceId, amountMinor });
    return row!;
  });
}

export async function voidPayment(userId: string, companyId: string, paymentId: string) {
  const ctx = await requireMembership(userId, companyId, "sales:write");
  await withTenant(ctx, async (tx) => {
    const res = await tx
      .update(schema.payment)
      .set({ voidedAt: new Date() })
      .where(and(eq(schema.payment.id, paymentId), sql`voided_at is null`))
      .returning({ id: schema.payment.id });
    if (!res.length) throw rule("Paiement introuvable ou déjà annulé.");
    await audit(tx, ctx, "payment.voided", "payment", paymentId);
  });
}

/* ---------- Indicateurs ---------- */

/** Chiffres de gestion issus uniquement de documents émis et de paiements enregistrés. */
export async function salesSummary(userId: string, companyId: string) {
  const ctx = await requireMembership(userId, companyId, "sales:read");
  return withTenant(ctx, async (tx) => {
    const co = await companyInfo(tx, companyId);
    const today = todayIn(co.timezone);
    const [r] = await tx.execute<{ invoiced: number; credited: number; received: number; outstanding: number; overdue: number; overdue_count: number; invoices: number }>(sql`
      with inv as (
        select d.id, d.total_minor, d.due_date,
          coalesce((select sum(p.amount_minor) from payment p where p.invoice_id = d.id and p.voided_at is null), 0) as paid,
          coalesce((select sum(c.total_minor) from sales_document c where c.related_id = d.id and c.type = 'credit_note' and c.status = 'issued'), 0) as credited
        from sales_document d where d.type = 'invoice' and d.status = 'issued')
      select
        coalesce(sum(total_minor), 0)::float8 as invoiced,
        coalesce(sum(credited), 0)::float8 as credited,
        coalesce(sum(paid), 0)::float8 as received,
        coalesce(sum(greatest(total_minor - paid - credited, 0)), 0)::float8 as outstanding,
        coalesce(sum(greatest(total_minor - paid - credited, 0)) filter (where due_date < ${today}::date), 0)::float8 as overdue,
        (count(*) filter (where total_minor - paid - credited > 0 and due_date < ${today}::date))::int as overdue_count,
        count(*)::int as invoices
      from inv`);
    return {
      currency: co.currency,
      invoices: r!.invoices,
      invoicedMinor: Number(r!.invoiced),
      creditedMinor: Number(r!.credited),
      receivedMinor: Number(r!.received),
      outstandingMinor: Number(r!.outstanding),
      overdueMinor: Number(r!.overdue),
      overdueCount: r!.overdue_count,
    };
  });
}
