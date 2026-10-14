import { and, asc, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@/db/client";
import { todayIn } from "@/lib/dates";
import { toMinor } from "@/lib/money";
import { BusinessRuleError } from "@/modules/core/errors";
import { audit, ForbiddenError, requireMembership, withTenant, type TenantContext, type TenantTx } from "@/modules/core/tenant";
import { periodForDate } from "./periods";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const fail = (path: string, message: string) => new z.ZodError([{ code: "custom", path: [path], message }]);

/** Messages levés par les déclencheurs de la base : ils sont écrits pour l'utilisateur et affichés tels quels. */
const DB_MESSAGES = /(Écriture déséquilibrée|au moins deux lignes|montant de l'écriture|période comptable|hors de sa période|compte archivé|Validez ou supprimez)/;
export function mapAccountingError(e: unknown): never {
  const msg = String((e as { cause?: { message?: string } })?.cause?.message ?? "");
  // la base cite des montants en unités mineures : on affiche un message lisible (les totaux sont visibles dans le formulaire)
  if (/Écriture déséquilibrée/.test(msg)) throw new BusinessRuleError("Écriture déséquilibrée : le total des débits doit être égal au total des crédits.");
  if (DB_MESSAGES.test(msg)) throw new BusinessRuleError(msg);
  throw e;
}

export interface LineSpec {
  accountId: string;
  debitMinor?: number;
  creditMinor?: number;
  description?: string | null;
  contactId?: string | null;
  supplierId?: string | null;
}

/** Fusionne les lignes identiques (même compte, même tiers, même sens) pour garder des écritures lisibles. */
export function mergeLines(lines: LineSpec[]): LineSpec[] {
  const map = new Map<string, LineSpec>();
  for (const l of lines) {
    const side = (l.debitMinor ?? 0) > 0 ? "d" : "c";
    const key = [l.accountId, l.contactId ?? "", l.supplierId ?? "", side, l.description ?? ""].join("|");
    const prev = map.get(key);
    if (prev) {
      prev.debitMinor = (prev.debitMinor ?? 0) + (l.debitMinor ?? 0);
      prev.creditMinor = (prev.creditMinor ?? 0) + (l.creditMinor ?? 0);
    } else map.set(key, { ...l });
  }
  return [...map.values()].filter((l) => (l.debitMinor ?? 0) + (l.creditMinor ?? 0) > 0);
}

/** Numéro suivant, sans trou : par journal et par année, atomique, annulé avec la transaction en cas d'échec. */
async function nextEntryNumber(tx: TenantTx, companyId: string, journalId: string, journalCode: string, year: number) {
  const rows = await tx.execute<{ last: number }>(sql`
    insert into entry_counter (company_id, journal_id, year, last) values (${companyId}, ${journalId}, ${year}, 1)
    on conflict (company_id, journal_id, year) do update set last = entry_counter.last + 1
    returning last`);
  return `${journalCode}-${year}-${String(rows[0]!.last).padStart(6, "0")}`;
}

/** Valide une écriture brouillon : période ouverte, numéro, puis contrôle d'équilibre par la base. */
export async function postEntryTx(tx: TenantTx, ctx: TenantContext, entryId: string) {
  const [entry] = await tx.select().from(schema.journalEntry).where(eq(schema.journalEntry.id, entryId)).for("update");
  if (!entry) throw new ForbiddenError();
  if (entry.status !== "draft") throw new BusinessRuleError("Cette écriture est déjà validée.");
  const period = await periodForDate(tx, entry.entryDate);
  if (!period) throw new BusinessRuleError(`Aucune période comptable ne couvre le ${entry.entryDate}. Créez-la d'abord.`);
  if (period.status !== "open") throw new BusinessRuleError(`La période « ${period.name} » est clôturée : l'écriture du ${entry.entryDate} ne peut pas être validée.`);
  const [jr] = await tx.select().from(schema.journal).where(eq(schema.journal.id, entry.journalId));
  if (!jr || jr.archivedAt) throw new BusinessRuleError("Ce journal est archivé.");
  const number = await nextEntryNumber(tx, ctx.companyId, jr.id, jr.code, Number(entry.entryDate.slice(0, 4)));
  try {
    await tx
      .update(schema.journalEntry)
      .set({ status: "posted", number, periodId: period.id, postedAt: new Date(), postedBy: ctx.userId })
      .where(eq(schema.journalEntry.id, entryId));
  } catch (e) {
    mapAccountingError(e);
  }
  await audit(tx, ctx, "entry.posted", "journal_entry", entryId, { number });
  return number;
}

async function insertDraft(
  tx: TenantTx,
  ctx: TenantContext,
  e: { journalId: string; entryDate: string; description: string; sourceType?: string; sourceId?: string; reversalOfId?: string },
  lines: LineSpec[],
) {
  let entry;
  try {
    [entry] = await tx
      .insert(schema.journalEntry)
      .values({ companyId: ctx.companyId, journalId: e.journalId, entryDate: e.entryDate, description: e.description, sourceType: e.sourceType ?? "manual", sourceId: e.sourceId, reversalOfId: e.reversalOfId, createdBy: ctx.userId })
      .returning();
  } catch (err) {
    if (/journal_entry_source_unique/.test(String((err as { cause?: { message?: string } }).cause?.message ?? ""))) {
      throw new BusinessRuleError("Cette opération est déjà comptabilisée.");
    }
    throw err;
  }
  if (lines.length) {
    await tx.insert(schema.journalLine).values(
      lines.map((l, i) => ({ companyId: ctx.companyId, entryId: entry!.id, position: i + 1, accountId: l.accountId, debitMinor: l.debitMinor ?? 0, creditMinor: l.creditMinor ?? 0, description: l.description ?? null, contactId: l.contactId ?? null, supplierId: l.supplierId ?? null })),
    );
  }
  return entry!;
}

/** Crée et valide d'un coup une écriture automatique (facture, paiement…). Idempotent par (type de source, source). */
export async function createAndPostTx(
  tx: TenantTx,
  ctx: TenantContext,
  e: { journalId: string; entryDate: string; description: string; sourceType: string; sourceId: string; reversalOfId?: string },
  lines: LineSpec[],
) {
  const entry = await insertDraft(tx, ctx, e, mergeLines(lines));
  const number = await postEntryTx(tx, ctx, entry.id);
  return { id: entry.id, number };
}

/* ---------- Saisie manuelle ---------- */

export interface ManualLine {
  accountId: string;
  debit?: string;
  credit?: string;
  description?: string;
}

const draftInput = z.object({
  journalId: z.string().uuid("Journal requis"),
  entryDate: z.string().regex(DATE, "Date invalide"),
  description: z.string().trim().min(1, "Libellé requis").max(300),
});

async function toLines(tx: TenantTx, companyId: string, lines: ManualLine[]): Promise<LineSpec[]> {
  const [co] = await tx.select({ currency: schema.company.currency }).from(schema.company).where(eq(schema.company.id, companyId));
  const out: LineSpec[] = [];
  for (const [i, l] of lines.entries()) {
    const d = l.debit?.trim() ? toMinor(l.debit, co!.currency) : 0;
    const c = l.credit?.trim() ? toMinor(l.credit, co!.currency) : 0;
    if (d === null || c === null) throw fail(`lines.${i}`, `Ligne ${i + 1} : montant invalide.`);
    if (d > 0 && c > 0) throw fail(`lines.${i}`, `Ligne ${i + 1} : une ligne est au débit ou au crédit, pas les deux.`);
    if (d === 0 && c === 0) continue; // ligne vide ignorée
    if (!l.accountId) throw fail(`lines.${i}`, `Ligne ${i + 1} : compte requis.`);
    out.push({ accountId: l.accountId, debitMinor: d, creditMinor: c, description: l.description?.trim() || null });
  }
  return out;
}

export async function createDraftEntry(userId: string, companyId: string, input: z.input<typeof draftInput> & { lines: ManualLine[] }) {
  const data = draftInput.parse(input);
  const ctx = await requireMembership(userId, companyId, "accounting:write");
  return withTenant(ctx, async (tx) => {
    const lines = await toLines(tx, companyId, input.lines);
    const entry = await insertDraft(tx, ctx, data, lines);
    await audit(tx, ctx, "entry.draft_created", "journal_entry", entry.id);
    return entry;
  });
}

export async function updateDraftEntry(userId: string, companyId: string, id: string, input: z.input<typeof draftInput> & { lines: ManualLine[] }) {
  const data = draftInput.parse(input);
  const ctx = await requireMembership(userId, companyId, "accounting:write");
  return withTenant(ctx, async (tx) => {
    const [cur] = await tx.select().from(schema.journalEntry).where(eq(schema.journalEntry.id, id)).for("update");
    if (!cur) throw new ForbiddenError();
    if (cur.status !== "draft") throw new BusinessRuleError("Une écriture validée ne se modifie pas : contre-passez-la.");
    if (cur.sourceType !== "manual") throw new BusinessRuleError("Les écritures automatiques ne se modifient pas.");
    const lines = await toLines(tx, companyId, input.lines);
    await tx.delete(schema.journalLine).where(eq(schema.journalLine.entryId, id));
    await tx.update(schema.journalEntry).set(data).where(eq(schema.journalEntry.id, id));
    if (lines.length) {
      await tx.insert(schema.journalLine).values(lines.map((l, i) => ({ companyId, entryId: id, position: i + 1, accountId: l.accountId, debitMinor: l.debitMinor ?? 0, creditMinor: l.creditMinor ?? 0, description: l.description ?? null })));
    }
    await audit(tx, ctx, "entry.draft_updated", "journal_entry", id);
  });
}

export async function deleteDraftEntry(userId: string, companyId: string, id: string) {
  const ctx = await requireMembership(userId, companyId, "accounting:write");
  await withTenant(ctx, async (tx) => {
    const [cur] = await tx.select().from(schema.journalEntry).where(eq(schema.journalEntry.id, id));
    if (!cur) throw new ForbiddenError();
    if (cur.status !== "draft") throw new BusinessRuleError("Une écriture validée ne se supprime pas : contre-passez-la.");
    await tx.delete(schema.journalEntry).where(eq(schema.journalEntry.id, id));
    await audit(tx, ctx, "entry.draft_deleted", "journal_entry", id);
  });
}

export async function postEntry(userId: string, companyId: string, id: string) {
  const ctx = await requireMembership(userId, companyId, "accounting:write");
  return withTenant(ctx, (tx) => postEntryTx(tx, ctx, id));
}

/** Contre-passation : écriture inverse, validée aussitôt, qui annule l'effet de l'originale sans la modifier. */
export async function reverseEntryTx(tx: TenantTx, ctx: TenantContext, entryId: string, opts: { date: string; description?: string }) {
  const [orig] = await tx.select().from(schema.journalEntry).where(eq(schema.journalEntry.id, entryId)).for("update");
  if (!orig) throw new ForbiddenError();
  if (orig.status !== "posted") throw new BusinessRuleError("Seule une écriture validée se contre-passe.");
  if (orig.sourceType === "reversal") throw new BusinessRuleError("Une contre-passation ne se contre-passe pas.");
  const lines = await tx.select().from(schema.journalLine).where(eq(schema.journalLine.entryId, entryId)).orderBy(asc(schema.journalLine.position));
  const res = await createAndPostTx(
    tx,
    ctx,
    { journalId: orig.journalId, entryDate: opts.date, description: opts.description?.trim() || `Contre-passation de ${orig.number}`, sourceType: "reversal", sourceId: orig.id, reversalOfId: orig.id },
    lines.map((l) => ({ accountId: l.accountId, debitMinor: l.creditMinor, creditMinor: l.debitMinor, description: l.description, contactId: l.contactId, supplierId: l.supplierId })),
  ).catch((e) => {
    if (e instanceof BusinessRuleError && /déjà comptabilisée/.test(e.message)) throw new BusinessRuleError("Cette écriture a déjà été contre-passée.");
    throw e;
  });
  await audit(tx, ctx, "entry.reversed", "journal_entry", entryId, { reversalNumber: res.number });
  return res;
}

export async function reverseEntry(userId: string, companyId: string, id: string, input: { date?: string; description?: string } = {}) {
  const ctx = await requireMembership(userId, companyId, "accounting:write");
  return withTenant(ctx, async (tx) => {
    const [co] = await tx.select({ tz: schema.company.timezone }).from(schema.company).where(eq(schema.company.id, companyId));
    const date = input.date && DATE.test(input.date) ? input.date : todayIn(co!.tz);
    return reverseEntryTx(tx, ctx, id, { date, description: input.description });
  });
}

/* ---------- Lecture ---------- */

export async function getEntry(userId: string, companyId: string, id: string) {
  const ctx = await requireMembership(userId, companyId, "accounting:read");
  return withTenant(ctx, async (tx) => {
    const [entry] = await tx
      .select({ e: schema.journalEntry, journalCode: schema.journal.code, journalName: schema.journal.name })
      .from(schema.journalEntry)
      .innerJoin(schema.journal, and(eq(schema.journal.id, schema.journalEntry.journalId), eq(schema.journal.companyId, schema.journalEntry.companyId)))
      .where(eq(schema.journalEntry.id, id));
    if (!entry) return null;
    const lines = await tx
      .select({ l: schema.journalLine, code: schema.ledgerAccount.code, name: schema.ledgerAccount.name })
      .from(schema.journalLine)
      .innerJoin(schema.ledgerAccount, and(eq(schema.ledgerAccount.id, schema.journalLine.accountId), eq(schema.ledgerAccount.companyId, schema.journalLine.companyId)))
      .where(eq(schema.journalLine.entryId, id))
      .orderBy(asc(schema.journalLine.position));
    const reversed = await tx.select({ id: schema.journalEntry.id, number: schema.journalEntry.number }).from(schema.journalEntry).where(eq(schema.journalEntry.reversalOfId, id));
    return { ...entry, lines, reversedBy: reversed[0] ?? null };
  });
}

export interface EntryFilter {
  status?: "draft" | "posted";
  journalId?: string;
  from?: string;
  to?: string;
}

export async function listEntries(userId: string, companyId: string, f: EntryFilter = {}) {
  const ctx = await requireMembership(userId, companyId, "accounting:read");
  const conds: (SQL | undefined)[] = [
    f.status ? eq(schema.journalEntry.status, f.status) : undefined,
    f.journalId ? eq(schema.journalEntry.journalId, f.journalId) : undefined,
    f.from && DATE.test(f.from) ? gte(schema.journalEntry.entryDate, f.from) : undefined,
    f.to && DATE.test(f.to) ? lte(schema.journalEntry.entryDate, f.to) : undefined,
  ];
  return withTenant(ctx, (tx) =>
    tx
      .select({
        id: schema.journalEntry.id,
        number: schema.journalEntry.number,
        entryDate: schema.journalEntry.entryDate,
        description: schema.journalEntry.description,
        status: schema.journalEntry.status,
        sourceType: schema.journalEntry.sourceType,
        journalCode: schema.journal.code,
        totalMinor: sql<number>`coalesce((select sum(l.debit_minor) from journal_line l where l.entry_id = ${schema.journalEntry.id}), 0)::float8`,
      })
      .from(schema.journalEntry)
      .innerJoin(schema.journal, and(eq(schema.journal.id, schema.journalEntry.journalId), eq(schema.journal.companyId, schema.journalEntry.companyId)))
      .where(and(...conds))
      .orderBy(desc(schema.journalEntry.entryDate), desc(schema.journalEntry.createdAt))
      .limit(500),
  );
}
