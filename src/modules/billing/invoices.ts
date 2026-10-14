import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { clearAccessCache } from "@/modules/core/entitlements";
import { BusinessRuleError } from "@/modules/core/errors";
import { addInterval, nextBillingNumber, platformAudit, type Tx } from "./platform";

type Plan = typeof schema.plan.$inferSelect;
export const PAYMENT_TERM_DAYS = 7;

/** Émet une facture d'abonnement ouverte pour [start, start + périodicité). Montant et devise sont figés à l'émission. */
export async function issueInvoiceTx(tx: Tx, companyId: string, plan: Plan, start: Date, now = new Date()) {
  const number = await nextBillingNumber(tx, now.getUTCFullYear());
  const due = start > now ? start : new Date(now.getTime() + PAYMENT_TERM_DAYS * 86_400_000);
  const [inv] = await tx
    .insert(schema.billingInvoice)
    .values({ companyId, planId: plan.id, number, periodStart: start, periodEnd: addInterval(start, plan.interval), amountMinor: plan.priceMinor, currency: plan.currency, issuedAt: now, dueAt: due })
    .returning();
  return inv!;
}

/** Annule les factures encore ouvertes d'une entreprise (le client a changé d'avis ou d'offre). */
export async function voidOpenInvoicesTx(tx: Tx, companyId: string) {
  await tx.update(schema.billingInvoice).set({ status: "void" }).where(and(eq(schema.billingInvoice.companyId, companyId), eq(schema.billingInvoice.status, "open")));
}

export interface PaymentInfo {
  method: string;
  reference?: string | null;
  provider?: string | null;
  paidAt?: Date;
}

/**
 * Enregistre le paiement d'une facture d'abonnement (virement constaté par un opérateur, ou webhook d'un prestataire).
 * Idempotent : une facture déjà payée n'est pas payée deux fois. L'accès en découle automatiquement (période payée couvrant la date).
 */
export async function markInvoicePaid(invoiceId: string, info: PaymentInfo, actorId: string | null = null) {
  const res = await db.transaction(async (tx) => {
    const [inv] = await tx.select().from(schema.billingInvoice).where(eq(schema.billingInvoice.id, invoiceId)).for("update");
    if (!inv) throw new BusinessRuleError("Facture d'abonnement introuvable.");
    if (inv.status === "paid") return { already: true, companyId: inv.companyId };
    if (inv.status === "void") throw new BusinessRuleError("Cette facture a été annulée.");
    const paidAt = info.paidAt ?? new Date();
    await tx.update(schema.billingInvoice).set({ status: "paid", paidAt, paymentMethod: info.method, paymentReference: info.reference ?? null, provider: info.provider ?? null }).where(eq(schema.billingInvoice.id, invoiceId));
    // l'abonnement facture désormais cette offre (si la période est déjà commencée, elle prend effet tout de suite)
    await tx.update(schema.subscription).set({ status: "active", ...(inv.periodStart <= paidAt ? { planId: inv.planId } : {}), updatedAt: new Date() }).where(eq(schema.subscription.companyId, inv.companyId));
    await platformAudit(tx, actorId, "billing_invoice.paid", "billing_invoice", invoiceId, { number: inv.number, method: info.method, provider: info.provider ?? null });
    return { already: false, companyId: inv.companyId };
  });
  clearAccessCache(res.companyId);
  return res;
}

export async function voidInvoice(invoiceId: string, actorId: string) {
  const companyId = await db.transaction(async (tx) => {
    const [inv] = await tx.select().from(schema.billingInvoice).where(eq(schema.billingInvoice.id, invoiceId)).for("update");
    if (!inv) throw new BusinessRuleError("Facture d'abonnement introuvable.");
    if (inv.status !== "open") throw new BusinessRuleError("Seule une facture ouverte peut être annulée.");
    await tx.update(schema.billingInvoice).set({ status: "void" }).where(eq(schema.billingInvoice.id, invoiceId));
    await platformAudit(tx, actorId, "billing_invoice.voided", "billing_invoice", invoiceId, { number: inv.number });
    return inv.companyId;
  });
  clearAccessCache(companyId);
}

export async function listInvoicesForCompany(companyId: string) {
  return db
    .select({ inv: schema.billingInvoice, planName: schema.plan.name })
    .from(schema.billingInvoice)
    .innerJoin(schema.plan, eq(schema.plan.id, schema.billingInvoice.planId))
    .where(eq(schema.billingInvoice.companyId, companyId))
    .orderBy(desc(schema.billingInvoice.issuedAt));
}

/** Fin de la dernière couverture payée (ou null). */
export async function coverageEnd(tx: Tx | typeof db, companyId: string): Promise<Date | null> {
  const [r] = await tx
    .select({ end: sql<Date | null>`max(${schema.billingInvoice.periodEnd})` })
    .from(schema.billingInvoice)
    .where(and(eq(schema.billingInvoice.companyId, companyId), eq(schema.billingInvoice.status, "paid"), gt(schema.billingInvoice.periodEnd, new Date(0))));
  return r?.end ? new Date(r.end) : null;
}
