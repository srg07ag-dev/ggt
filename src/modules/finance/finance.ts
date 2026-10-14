import { and, asc, desc, eq, gte, isNull, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@/db/client";
import { toMinor } from "@/lib/money";
import { assertStorage } from "@/modules/core/entitlements";
import { rateLimit } from "@/lib/rate-limit";
import { postFinanceEntry, reverseFinanceEntry } from "@/modules/accounting/posting";
import { deletePrivateFile, getPrivateFile, putPrivateFile, safeFilename } from "@/lib/storage";
import { audit, ForbiddenError, requireMembership, withTenant, type TenantContext, type TenantTx } from "@/modules/core/tenant";
import { BusinessRuleError } from "@/modules/sales/documents";

const fail = (path: string, message: string) => new z.ZodError([{ code: "custom", path: [path], message }]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/* ---------- Catégories (valeurs de départ génériques, modifiables) ---------- */

const DEFAULT_CATEGORIES = [
  ["expense", "Achats de marchandises"],
  ["expense", "Fournitures"],
  ["expense", "Loyer"],
  ["expense", "Transport"],
  ["expense", "Télécommunications"],
  ["expense", "Honoraires"],
  ["expense", "Marketing"],
  ["expense", "Frais bancaires"],
  ["expense", "Autres dépenses"],
  ["income", "Autres recettes"],
] as const;

export async function seedDefaultCategories(tx: TenantTx, ctx: TenantContext) {
  await tx.insert(schema.financeCategory).values(DEFAULT_CATEGORIES.map(([kind, name]) => ({ companyId: ctx.companyId, kind, name })));
}

export async function listCategories(userId: string, companyId: string) {
  const ctx = await requireMembership(userId, companyId, "finance:read");
  return withTenant(ctx, (tx) => tx.select().from(schema.financeCategory).where(isNull(schema.financeCategory.archivedAt)).orderBy(asc(schema.financeCategory.name)));
}

export async function createCategory(userId: string, companyId: string, input: { kind: string; name: string }) {
  const data = z.object({ kind: z.enum(["income", "expense"]), name: z.string().trim().min(1).max(80) }).parse(input);
  const ctx = await requireMembership(userId, companyId, "finance:write");
  return withTenant(ctx, async (tx) => {
    const [row] = await tx.insert(schema.financeCategory).values({ ...data, companyId }).onConflictDoNothing().returning();
    if (!row) throw new BusinessRuleError("Cette catégorie existe déjà.");
    await audit(tx, ctx, "category.created", "finance_category", row.id);
    return row;
  });
}

/* ---------- Comptes de trésorerie ---------- */

export async function createAccount(userId: string, companyId: string, input: { name: string; kind: string; openingBalance: string }) {
  const data = z.object({ name: z.string().trim().min(1).max(80), kind: z.enum(["cash", "bank", "mobile_money", "other"]) }).parse(input);
  const ctx = await requireMembership(userId, companyId, "finance:write");
  return withTenant(ctx, async (tx) => {
    const [co] = await tx.select({ currency: schema.company.currency }).from(schema.company).where(eq(schema.company.id, companyId));
    const neg = input.openingBalance.trim().startsWith("-");
    const abs = toMinor(input.openingBalance.trim().replace(/^-/, "") || "0", co!.currency);
    if (abs === null) throw fail("openingBalance", "Solde initial invalide.");
    const [row] = await tx
      .insert(schema.financeAccount)
      .values({ ...data, companyId, currency: co!.currency, openingBalanceMinor: neg ? -abs : abs })
      .returning();
    await audit(tx, ctx, "account.created", "finance_account", row!.id);
    return row!;
  });
}

export async function archiveAccount(userId: string, companyId: string, id: string) {
  const ctx = await requireMembership(userId, companyId, "finance:write");
  await withTenant(ctx, async (tx) => {
    await tx.update(schema.financeAccount).set({ archivedAt: new Date() }).where(eq(schema.financeAccount.id, id));
    await audit(tx, ctx, "account.archived", "finance_account", id);
  });
}

/** Soldes par compte à la date donnée (incluse) : solde initial + encaissements + recettes − dépenses. Les opérations annulées sont exclues. */
export async function listAccounts(userId: string, companyId: string, asOf?: string) {
  const ctx = await requireMembership(userId, companyId, "finance:read");
  const cutoff = asOf ?? "9999-12-31";
  return withTenant(ctx, async (tx) => {
    const rows = await tx.execute<{ id: string; name: string; kind: string; currency: string; opening: number; payments: number; income: number; expenses: number; archived: boolean }>(sql`
      select a.id, a.name, a.kind, a.currency, a.opening_balance_minor::float8 as opening, (a.archived_at is not null) as archived,
        coalesce((select sum(p.amount_minor) from payment p where p.account_id = a.id and p.voided_at is null and p.paid_on <= ${cutoff}::date), 0)::float8 as payments,
        coalesce((select sum(e.amount_minor) from finance_entry e where e.account_id = a.id and e.kind = 'income' and e.voided_at is null and e.occurred_on <= ${cutoff}::date), 0)::float8 as income,
        coalesce((select sum(e.amount_minor) from finance_entry e where e.account_id = a.id and e.kind = 'expense' and e.voided_at is null and e.occurred_on <= ${cutoff}::date), 0)::float8 as expenses
      from finance_account a order by a.created_at`);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      currency: r.currency,
      archived: r.archived,
      balanceMinor: Number(r.opening) + Number(r.payments) + Number(r.income) - Number(r.expenses),
    }));
  });
}

/* ---------- Fournisseurs ---------- */

const supplierInput = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.union([z.literal(""), z.string().trim().email()]).optional().transform((v) => v || null),
  phone: z.string().trim().max(40).optional().transform((v) => v || null),
  address: z.string().trim().max(400).optional().transform((v) => v || null),
  taxId: z.string().trim().max(60).optional().transform((v) => v || null),
  notes: z.string().max(2000).optional().transform((v) => v || null),
});

export async function createSupplier(userId: string, companyId: string, input: z.input<typeof supplierInput>) {
  const data = supplierInput.parse(input);
  const ctx = await requireMembership(userId, companyId, "finance:write");
  return withTenant(ctx, async (tx) => {
    const [row] = await tx.insert(schema.supplier).values({ ...data, companyId }).returning();
    await audit(tx, ctx, "supplier.created", "supplier", row!.id);
    return row!;
  });
}

export async function listSuppliers(userId: string, companyId: string) {
  const ctx = await requireMembership(userId, companyId, "finance:read");
  return withTenant(ctx, (tx) => tx.select().from(schema.supplier).where(isNull(schema.supplier.archivedAt)).orderBy(asc(schema.supplier.name)));
}

export async function archiveSupplier(userId: string, companyId: string, id: string) {
  const ctx = await requireMembership(userId, companyId, "finance:write");
  await withTenant(ctx, async (tx) => {
    await tx.update(schema.supplier).set({ archivedAt: new Date() }).where(eq(schema.supplier.id, id));
    await audit(tx, ctx, "supplier.archived", "supplier", id);
  });
}

/* ---------- Opérations (recettes diverses et dépenses) ---------- */

export interface EntryInput {
  kind: "income" | "expense";
  accountId: string;
  amount: string;
  /** Part de taxe comprise dans le montant, saisie telle qu'elle figure sur le justificatif. */
  tax?: string;
  occurredOn: string;
  categoryId?: string;
  supplierId?: string;
  contactId?: string;
  description: string;
  reference?: string;
}

export async function createEntry(userId: string, companyId: string, input: EntryInput) {
  const data = z
    .object({
      kind: z.enum(["income", "expense"]),
      accountId: z.string().uuid("Compte requis"),
      occurredOn: z.string().regex(DATE, "Date invalide"),
      categoryId: z.string().uuid().optional(),
      supplierId: z.string().uuid().optional(),
      contactId: z.string().uuid().optional(),
      description: z.string().trim().min(1, "Description requise").max(300),
      reference: z.string().trim().max(120).optional().transform((v) => v || null),
    })
    .parse(input);
  const ctx = await requireMembership(userId, companyId, "finance:write");
  return withTenant(ctx, async (tx) => {
    const [co] = await tx.select({ currency: schema.company.currency }).from(schema.company).where(eq(schema.company.id, companyId));
    const amountMinor = toMinor(input.amount, co!.currency);
    if (!amountMinor || amountMinor <= 0) throw fail("amount", "Montant invalide.");
    const taxMinor = input.tax?.trim() ? toMinor(input.tax, co!.currency) : 0;
    if (taxMinor === null) throw fail("tax", "Montant de taxe invalide.");
    if (taxMinor > amountMinor) throw fail("tax", "La taxe dépasse le montant.");
    if (data.kind === "income" && data.supplierId) throw fail("supplierId", "Une recette n'a pas de fournisseur.");
    if (data.kind === "expense" && data.contactId) throw fail("contactId", "Une dépense n'a pas de client.");

    const [acc] = await tx.select().from(schema.financeAccount).where(eq(schema.financeAccount.id, data.accountId));
    if (!acc) throw new ForbiddenError();
    if (acc.archivedAt) throw new BusinessRuleError("Ce compte est archivé.");

    const [row] = await tx.insert(schema.financeEntry).values({ ...data, companyId, amountMinor, taxMinor, createdBy: userId }).returning();
    await audit(tx, ctx, `${data.kind}.recorded`, "finance_entry", row!.id, { amountMinor });
    await postFinanceEntry(tx, ctx, { id: row!.id, kind: data.kind, amountMinor, taxMinor, occurredOn: data.occurredOn, accountId: data.accountId, categoryId: data.categoryId ?? null, description: data.description, supplierId: data.supplierId ?? null, contactId: data.contactId ?? null });
    return row!;
  });
}

export async function voidEntry(userId: string, companyId: string, id: string) {
  const ctx = await requireMembership(userId, companyId, "finance:write");
  await withTenant(ctx, async (tx) => {
    const res = await tx.update(schema.financeEntry).set({ voidedAt: new Date() }).where(and(eq(schema.financeEntry.id, id), isNull(schema.financeEntry.voidedAt))).returning({ id: schema.financeEntry.id });
    if (!res.length) throw new BusinessRuleError("Opération introuvable ou déjà annulée.");
    await audit(tx, ctx, "entry.voided", "finance_entry", id);
    await reverseFinanceEntry(tx, ctx, id);
  });
}

export interface EntryFilter {
  kind: "income" | "expense";
  from?: string;
  to?: string;
  accountId?: string;
}

export async function listEntries(userId: string, companyId: string, f: EntryFilter) {
  const ctx = await requireMembership(userId, companyId, "finance:read");
  const conds: (SQL | undefined)[] = [
    eq(schema.financeEntry.kind, f.kind),
    f.from ? gte(schema.financeEntry.occurredOn, f.from) : undefined,
    f.to ? lte(schema.financeEntry.occurredOn, f.to) : undefined,
    f.accountId ? eq(schema.financeEntry.accountId, f.accountId) : undefined,
  ];
  return withTenant(ctx, (tx) =>
    tx
      .select({
        id: schema.financeEntry.id,
        occurredOn: schema.financeEntry.occurredOn,
        amountMinor: schema.financeEntry.amountMinor,
        taxMinor: schema.financeEntry.taxMinor,
        description: schema.financeEntry.description,
        reference: schema.financeEntry.reference,
        voidedAt: schema.financeEntry.voidedAt,
        categoryName: schema.financeCategory.name,
        supplierName: schema.supplier.name,
        accountName: schema.financeAccount.name,
        attachments: sql<number>`(select count(*) from attachment a where a.entry_id = ${schema.financeEntry.id})::int`,
      })
      .from(schema.financeEntry)
      .innerJoin(schema.financeAccount, and(eq(schema.financeAccount.id, schema.financeEntry.accountId), eq(schema.financeAccount.companyId, schema.financeEntry.companyId)))
      .leftJoin(schema.financeCategory, and(eq(schema.financeCategory.id, schema.financeEntry.categoryId), eq(schema.financeCategory.companyId, schema.financeEntry.companyId)))
      .leftJoin(schema.supplier, and(eq(schema.supplier.id, schema.financeEntry.supplierId), eq(schema.supplier.companyId, schema.financeEntry.companyId)))
      .where(and(...conds))
      .orderBy(desc(schema.financeEntry.occurredOn), desc(schema.financeEntry.createdAt)),
  );
}

/** Encaissements = paiements de factures + recettes diverses, sur une même liste. */
export async function listReceipts(userId: string, companyId: string, f: { from?: string; to?: string } = {}) {
  const ctx = await requireMembership(userId, companyId, "finance:read");
  const from = f.from ?? "0001-01-01";
  const to = f.to ?? "9999-12-31";
  return withTenant(ctx, async (tx) => {
    const rows = await tx.execute<{ source: string; id: string; date: string; amount: number; label: string; account: string | null; voided: boolean; doc_id: string | null }>(sql`
      select 'payment' as source, p.id, p.paid_on::text as date, p.amount_minor::float8 as amount,
             coalesce(d.number, 'Facture') || ' · ' || c.name as label, a.name as account, (p.voided_at is not null) as voided, d.id as doc_id
        from payment p
        join sales_document d on d.id = p.invoice_id and d.company_id = p.company_id
        join contact c on c.id = d.contact_id and c.company_id = d.company_id
        left join finance_account a on a.id = p.account_id and a.company_id = p.company_id
       where p.paid_on between ${from}::date and ${to}::date
      union all
      select 'entry', e.id, e.occurred_on::text, e.amount_minor::float8, e.description, a.name, (e.voided_at is not null), null
        from finance_entry e join finance_account a on a.id = e.account_id and a.company_id = e.company_id
       where e.kind = 'income' and e.occurred_on between ${from}::date and ${to}::date
      order by 3 desc`);
    return rows.map((r) => ({ source: r.source as "payment" | "entry", id: r.id, date: r.date, amountMinor: Number(r.amount), label: r.label, account: r.account, voided: r.voided, docId: r.doc_id }));
  });
}

/* ---------- Justificatifs ---------- */

export async function addAttachment(userId: string, companyId: string, entryId: string, file: { name: string; data: Buffer }) {
  const ctx = await requireMembership(userId, companyId, "finance:write");
  await rateLimit(`upload:${userId}`, 100, 3600);
  const stored = await putPrivateFile(companyId, file.data);
  try {
    return await withTenant(ctx, async (tx) => {
      const [entry] = await tx.select({ id: schema.financeEntry.id }).from(schema.financeEntry).where(eq(schema.financeEntry.id, entryId));
      if (!entry) throw new ForbiddenError();
      await assertStorage(tx, companyId, stored.sizeBytes);
      const [row] = await tx
        .insert(schema.attachment)
        .values({ companyId, entryId, filename: safeFilename(file.name, stored.ext), contentType: stored.type, sizeBytes: stored.sizeBytes, sha256: stored.sha256, storageKey: stored.key, uploadedBy: userId })
        .returning();
      await audit(tx, ctx, "attachment.added", "attachment", row!.id, { entryId, sha256: stored.sha256 });
      return row!;
    });
  } catch (e) {
    await deletePrivateFile(stored.key); // pas de fichier orphelin si l'enregistrement échoue
    throw e;
  }
}

export async function listAttachments(userId: string, companyId: string, entryId: string) {
  const ctx = await requireMembership(userId, companyId, "finance:read");
  return withTenant(ctx, (tx) => tx.select().from(schema.attachment).where(eq(schema.attachment.entryId, entryId)).orderBy(asc(schema.attachment.createdAt)));
}

export async function readAttachment(userId: string, companyId: string, id: string) {
  const ctx = await requireMembership(userId, companyId, "finance:read");
  const row = await withTenant(ctx, async (tx) => {
    const [r] = await tx.select().from(schema.attachment).where(eq(schema.attachment.id, id));
    if (r) await audit(tx, ctx, "attachment.downloaded", "attachment", id);
    return r;
  });
  if (!row) return null;
  return { row, data: await getPrivateFile(row.storageKey) };
}

export async function deleteAttachment(userId: string, companyId: string, id: string) {
  const ctx = await requireMembership(userId, companyId, "finance:write");
  const key = await withTenant(ctx, async (tx) => {
    const [r] = await tx.delete(schema.attachment).where(eq(schema.attachment.id, id)).returning();
    if (!r) return null;
    await audit(tx, ctx, "attachment.deleted", "attachment", id, { sha256: r.sha256 });
    return r.storageKey;
  });
  if (key) await deletePrivateFile(key);
  return !!key;
}
