import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { clearAccessCache, computeAccess } from "@/modules/core/entitlements";
import { issueInvoiceTx } from "./invoices";
import { getPlatformSettings } from "./platform";

const DAY = 86_400_000;
/** Une facture de renouvellement est émise cette durée avant la fin de la période couverte. */
export const RENEWAL_NOTICE_DAYS = 5;

/**
 * Tâche planifiée (à lancer chaque jour : `npx tsx scripts/billing-run.ts`). Idempotente.
 *  1. émet les factures de renouvellement à venir (une par entreprise et par période : garanti par un index unique) ;
 *  2. matérialise le statut calculé, pour l'administration.
 * L'accès des entreprises, lui, ne dépend pas de cette tâche : il se déduit des dates.
 */
export async function runBillingJob(now = new Date()) {
  const settings = await getPlatformSettings();
  const summary = { invoicesIssued: 0, statusUpdated: 0, skipped: 0 };
  if (!settings.billingEnabled) return summary;

  const subs = await db.select().from(schema.subscription);
  const plans = new Map((await db.select().from(schema.plan)).map((p) => [p.id, p]));
  const paidAll = await db.select().from(schema.billingInvoice).where(eq(schema.billingInvoice.status, "paid"));
  const openAll = await db.select({ companyId: schema.billingInvoice.companyId }).from(schema.billingInvoice).where(eq(schema.billingInvoice.status, "open"));
  const hasOpen = new Set(openAll.map((o) => o.companyId));

  for (const sub of subs) {
    const paid = paidAll.filter((p) => p.companyId === sub.companyId).map((p) => ({ planId: p.planId, periodStart: p.periodStart, periodEnd: p.periodEnd }));
    // le renouvellement suit l'offre de la dernière période payée (la dernière offre choisie et réglée), à défaut l'offre de l'abonnement
    const lastPaid = [...paid].sort((a, b) => b.periodEnd.getTime() - a.periodEnd.getTime())[0];
    const plan = plans.get(lastPaid?.planId ?? sub.planId);
    if (!plan) continue;

    // 1. renouvellement
    if (plan.priceMinor > 0 && !sub.cancelAtPeriodEnd && !sub.suspendedAt && !hasOpen.has(sub.companyId)) {
      const lastEnd = paid.reduce<Date | null>((m, p) => (!m || p.periodEnd > m ? p.periodEnd : m), null);
      const base = lastEnd ?? sub.trialEndsAt;
      const start = base && base > now ? base : base ? now : null;
      const due = start && (start.getTime() - now.getTime()) / DAY <= RENEWAL_NOTICE_DAYS;
      if (start && due) {
        try {
          await db.transaction((tx) => issueInvoiceTx(tx, sub.companyId, plan, start, now));
          summary.invoicesIssued++;
        } catch (e) {
          // déjà émise (index unique, tâche concurrente) : rien à faire
          if (!/billing_invoice_period_unique/.test(String((e as { cause?: { message?: string } }).cause?.message ?? ""))) throw e;
          summary.skipped++;
        }
      }
    }

    // 2. statut matérialisé
    const access = computeAccess({ billingEnabled: true, sub, plans, paid, graceDays: settings.graceDays, now });
    const status = access.state === "suspended" || access.state === "unmanaged" ? sub.status : access.state;
    if (status !== sub.status) {
      await db.update(schema.subscription).set({ status, updatedAt: now }).where(eq(schema.subscription.companyId, sub.companyId));
      summary.statusUpdated++;
    }
    clearAccessCache(sub.companyId);
  }
  return summary;
}
