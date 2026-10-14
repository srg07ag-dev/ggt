import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@/db/client";
import { todayIn } from "@/lib/dates";
import { BusinessRuleError } from "@/modules/core/errors";
import { audit, requireMembership, withTenant, type TenantContext, type TenantTx } from "@/modules/core/tenant";
import { createAndPostTx, reverseEntryTx, type LineSpec } from "./entries";
import { periodForDate } from "./periods";

type Settings = typeof schema.accountingSettings.$inferSelect;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const rule = (m: string) => new BusinessRuleError(m);

/* ---------- Réglages ---------- */

export async function getAccountingSettings(userId: string, companyId: string) {
  const ctx = await requireMembership(userId, companyId, "accounting:read");
  return withTenant(ctx, async (tx) => (await tx.select().from(schema.accountingSettings).where(eq(schema.accountingSettings.companyId, companyId)))[0] ?? null);
}

export interface SettingsInput {
  enabled: boolean;
  enabledFrom?: string;
  receivableAccountId?: string;
  revenueAccountId?: string;
  taxCollectedAccountId?: string;
  taxDeductibleAccountId?: string;
  expenseAccountId?: string;
  otherIncomeAccountId?: string;
  salesJournalId?: string;
  purchasesJournalId?: string;
  treasuryJournalId?: string;
}

const ACCOUNT_RULES: [keyof SettingsInput, string, string][] = [
  ["receivableAccountId", "asset", "Clients (créances)"],
  ["revenueAccountId", "revenue", "Ventes (produits)"],
  ["taxCollectedAccountId", "liability", "Taxe collectée"],
  ["taxDeductibleAccountId", "asset", "Taxe déductible"],
  ["expenseAccountId", "expense", "Dépenses (charges)"],
  ["otherIncomeAccountId", "revenue", "Autres recettes (produits)"],
];
const JOURNAL_RULES: [keyof SettingsInput, string, string][] = [
  ["salesJournalId", "sales", "Journal des ventes"],
  ["purchasesJournalId", "purchases", "Journal des achats"],
  ["treasuryJournalId", "treasury", "Journal de trésorerie"],
];

/**
 * Enregistre les correspondances. L'activation exige une configuration complète et cohérente (types de comptes, types de journaux)
 * et une période ouverte à la date de départ : la comptabilité automatique ne démarre jamais à moitié configurée.
 */
export async function saveAccountingSettings(userId: string, companyId: string, input: SettingsInput) {
  const ctx = await requireMembership(userId, companyId, "accounting:write");
  return withTenant(ctx, async (tx) => {
    const values: Record<string, string | boolean | null> = {};
    for (const [key, type, label] of ACCOUNT_RULES) {
      const id = (input[key] as string | undefined) || null;
      if (id) {
        const [a] = await tx.select().from(schema.ledgerAccount).where(eq(schema.ledgerAccount.id, id));
        if (!a || a.archivedAt) throw rule(`${label} : compte introuvable ou archivé.`);
        if (a.type !== type) throw rule(`${label} : le compte ${a.code} n'est pas du bon type (${type === "asset" ? "actif" : type === "liability" ? "passif" : type === "revenue" ? "produit" : "charge"} attendu).`);
      }
      values[key] = id;
    }
    for (const [key, kind, label] of JOURNAL_RULES) {
      const id = (input[key] as string | undefined) || null;
      if (id) {
        const [j] = await tx.select().from(schema.journal).where(eq(schema.journal.id, id));
        if (!j || j.archivedAt) throw rule(`${label} : journal introuvable ou archivé.`);
        if (j.kind !== kind) throw rule(`${label} : le journal ${j.code} n'est pas de type « ${kind} ».`);
      }
      values[key] = id;
    }
    const from = input.enabledFrom && DATE.test(input.enabledFrom) ? input.enabledFrom : null;
    if (input.enabled) {
      if (!from) throw rule("Indiquez la date de début de la comptabilisation automatique.");
      const missing = [...ACCOUNT_RULES, ...JOURNAL_RULES].filter(([k]) => !values[k]).map(([, , l]) => l);
      if (missing.length) throw rule(`Configuration incomplète : ${missing.join(", ")}.`);
      const p = await periodForDate(tx, from);
      if (!p || p.status !== "open") throw rule(`Aucune période ouverte ne couvre le ${from} : créez-la avant d'activer.`);
    }
    await tx
      .insert(schema.accountingSettings)
      .values({ companyId, enabled: input.enabled, enabledFrom: from, ...values, updatedAt: new Date() })
      .onConflictDoUpdate({ target: schema.accountingSettings.companyId, set: { enabled: input.enabled, enabledFrom: from, ...values, updatedAt: new Date() } });
    await audit(tx, ctx, input.enabled ? "accounting.enabled" : "accounting.settings_saved", "accounting_settings", companyId, { enabledFrom: from });
  });
}

/** Associe des comptes comptables aux objets de gestion (trésorerie, taxes, catégories, produits). */
export async function setLedgerMapping(
  userId: string,
  companyId: string,
  target: { kind: "finance_account" | "tax_rate" | "finance_category" | "product"; id: string },
  ledgerAccountId: string | null,
) {
  z.string().uuid().parse(target.id);
  const ctx = await requireMembership(userId, companyId, "accounting:write");
  await withTenant(ctx, async (tx) => {
    if (ledgerAccountId) {
      const [a] = await tx.select().from(schema.ledgerAccount).where(eq(schema.ledgerAccount.id, ledgerAccountId));
      if (!a || a.archivedAt) throw rule("Compte comptable introuvable ou archivé.");
      const expected = target.kind === "finance_account" ? "asset" : target.kind === "tax_rate" ? "liability" : target.kind === "product" ? "revenue" : null;
      if (expected && a.type !== expected) throw rule(`Le compte ${a.code} n'est pas du bon type pour cette correspondance.`);
    }
    if (target.kind === "finance_account") await tx.update(schema.financeAccount).set({ ledgerAccountId }).where(eq(schema.financeAccount.id, target.id));
    else if (target.kind === "tax_rate") await tx.update(schema.taxRate).set({ ledgerAccountId }).where(eq(schema.taxRate.id, target.id));
    else if (target.kind === "finance_category") await tx.update(schema.financeCategory).set({ ledgerAccountId }).where(eq(schema.financeCategory.id, target.id));
    else await tx.update(schema.product).set({ revenueAccountId: ledgerAccountId }).where(eq(schema.product.id, target.id));
    await audit(tx, ctx, "ledger_mapping.set", target.kind, target.id, { ledgerAccountId });
  });
}

/* ---------- Comptabilisation automatique (appelée dans la transaction de l'opération) ---------- */

/** Réglages applicables à une date : null si la comptabilité n'est pas active ou si la date précède la date de départ. */
async function activeSettings(tx: TenantTx, date: string): Promise<Settings | null> {
  const [s] = await tx.select().from(schema.accountingSettings);
  if (!s || !s.enabled || !s.enabledFrom || date < s.enabledFrom) return null;
  return s;
}

const need = <T,>(v: T | null | undefined, msg: string): T => {
  if (!v) throw rule(msg);
  return v;
};

/** Facture ou avoir émis : débit clients / crédit produits et taxes (sens inverse pour un avoir). */
export async function postIssuedDocument(tx: TenantTx, ctx: TenantContext, doc: { id: string; type: "quote" | "invoice" | "credit_note"; number: string | null; issueDate: string; contactId: string; totalMinor: number }) {
  if (doc.type === "quote") return;
  const s = await activeSettings(tx, doc.issueDate);
  if (!s) return;
  const lines = await tx.select().from(schema.salesLine).where(eq(schema.salesLine.documentId, doc.id));
  const taxRates = await tx.select().from(schema.taxRate);
  const products = await tx.select().from(schema.product);
  const credit = doc.type === "credit_note";
  const spec: LineSpec[] = [];
  for (const l of lines) {
    const revenue = (l.productId && products.find((p) => p.id === l.productId)?.revenueAccountId) || s.revenueAccountId;
    spec.push({ accountId: need(revenue, "Compte de ventes non configuré."), [credit ? "debitMinor" : "creditMinor"]: l.netMinor, description: l.description });
    if (l.taxMinor > 0) {
      const tr = l.taxRateId ? taxRates.find((t) => t.id === l.taxRateId) : undefined;
      spec.push({ accountId: need(tr?.ledgerAccountId ?? s.taxCollectedAccountId, "Compte de taxe collectée non configuré."), [credit ? "debitMinor" : "creditMinor"]: l.taxMinor, description: l.taxName });
    }
  }
  spec.push({ accountId: need(s.receivableAccountId, "Compte clients non configuré."), [credit ? "creditMinor" : "debitMinor"]: doc.totalMinor, contactId: doc.contactId, description: doc.number });
  await createAndPostTx(tx, ctx, { journalId: need(s.salesJournalId, "Journal des ventes non configuré."), entryDate: doc.issueDate, description: `${credit ? "Avoir" : "Facture"} ${doc.number ?? ""}`.trim(), sourceType: doc.type, sourceId: doc.id }, spec);
}

async function treasuryAccountFor(tx: TenantTx, financeAccountId: string | null | undefined) {
  if (!financeAccountId) throw rule("Choisissez le compte de trésorerie : la comptabilité automatique est active.");
  const [fa] = await tx.select().from(schema.financeAccount).where(eq(schema.financeAccount.id, financeAccountId));
  return need(fa?.ledgerAccountId, `Associez un compte comptable au compte de trésorerie « ${fa?.name ?? ""} » (Comptabilité › Correspondances).`);
}

/** Encaissement d'une facture : débit trésorerie / crédit clients. */
export async function postPayment(tx: TenantTx, ctx: TenantContext, p: { id: string; invoiceId: string; amountMinor: number; paidOn: string; accountId: string | null }) {
  const s = await activeSettings(tx, p.paidOn);
  if (!s) return;
  const [inv] = await tx.select().from(schema.salesDocument).where(eq(schema.salesDocument.id, p.invoiceId));
  const treasury = await treasuryAccountFor(tx, p.accountId);
  await createAndPostTx(
    tx,
    ctx,
    { journalId: need(s.treasuryJournalId, "Journal de trésorerie non configuré."), entryDate: p.paidOn, description: `Encaissement ${inv?.number ?? ""}`.trim(), sourceType: "payment", sourceId: p.id },
    [
      { accountId: treasury, debitMinor: p.amountMinor },
      { accountId: need(s.receivableAccountId, "Compte clients non configuré."), creditMinor: p.amountMinor, contactId: inv?.contactId },
    ],
  );
}

async function reverseBySource(tx: TenantTx, ctx: TenantContext, sourceType: string, sourceId: string) {
  const [orig] = await tx.select().from(schema.journalEntry).where(and(eq(schema.journalEntry.sourceType, sourceType), eq(schema.journalEntry.sourceId, sourceId)));
  if (!orig) return; // jamais comptabilisé (avant la date de départ, ou comptabilité inactive)
  const [co] = await tx.select({ tz: schema.company.timezone }).from(schema.company).where(eq(schema.company.id, ctx.companyId));
  await reverseEntryTx(tx, ctx, orig.id, { date: todayIn(co!.tz), description: `Annulation : ${orig.description}` });
}

export const reversePayment = (tx: TenantTx, ctx: TenantContext, paymentId: string) => reverseBySource(tx, ctx, "payment", paymentId);
export const reverseFinanceEntry = (tx: TenantTx, ctx: TenantContext, entryId: string) => reverseBySource(tx, ctx, "finance_entry", entryId);

/** Dépense : débit charge (+ taxe déductible) / crédit trésorerie. Recette : débit trésorerie / crédit produit. */
export async function postFinanceEntry(
  tx: TenantTx,
  ctx: TenantContext,
  e: { id: string; kind: "income" | "expense"; amountMinor: number; taxMinor: number; occurredOn: string; accountId: string; categoryId: string | null; description: string; supplierId: string | null; contactId: string | null },
) {
  const s = await activeSettings(tx, e.occurredOn);
  if (!s) return;
  const treasury = await treasuryAccountFor(tx, e.accountId);
  const [cat] = e.categoryId ? await tx.select().from(schema.financeCategory).where(eq(schema.financeCategory.id, e.categoryId)) : [];
  if (e.kind === "expense") {
    const net = e.amountMinor - e.taxMinor;
    const spec: LineSpec[] = [{ accountId: need(cat?.ledgerAccountId ?? s.expenseAccountId, "Compte de charges non configuré."), debitMinor: net, supplierId: e.supplierId, description: e.description }];
    if (e.taxMinor > 0) spec.push({ accountId: need(s.taxDeductibleAccountId, "Compte de taxe déductible non configuré."), debitMinor: e.taxMinor, description: "Taxe déductible" });
    spec.push({ accountId: treasury, creditMinor: e.amountMinor });
    await createAndPostTx(tx, ctx, { journalId: need(s.purchasesJournalId, "Journal des achats non configuré."), entryDate: e.occurredOn, description: e.description, sourceType: "finance_entry", sourceId: e.id }, spec);
  } else {
    await createAndPostTx(
      tx,
      ctx,
      { journalId: need(s.treasuryJournalId, "Journal de trésorerie non configuré."), entryDate: e.occurredOn, description: e.description, sourceType: "finance_entry", sourceId: e.id },
      [
        { accountId: treasury, debitMinor: e.amountMinor },
        { accountId: need(cat?.ledgerAccountId ?? s.otherIncomeAccountId, "Compte d'autres recettes non configuré."), creditMinor: e.amountMinor, contactId: e.contactId, description: e.description },
      ],
    );
  }
}
