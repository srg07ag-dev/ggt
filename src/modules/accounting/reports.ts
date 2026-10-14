import { sql } from "drizzle-orm";
import { rateLimit } from "@/lib/rate-limit";
import { currencyExponent } from "@/lib/money";
import { toCsv, type Cell } from "@/lib/csv";
import { schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { audit, requireMembership, withTenant } from "@/modules/core/tenant";
import { normalSide, type AccountType } from "./chart";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const day = (v: string | undefined, fallback: string) => (v && DATE.test(v) ? v : fallback);

export interface BalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  openingMinor: number; // solde d'ouverture, positif = débiteur
  debitMinor: number;
  creditMinor: number;
  closingMinor: number; // solde de clôture, positif = débiteur
}

/**
 * Balance : pour chaque compte, solde avant la période, mouvements de la période et solde final.
 * Seules les écritures validées comptent. Soldes en « débit − crédit » (positif = débiteur).
 */
export async function trialBalance(userId: string, companyId: string, range: { from?: string; to?: string }) {
  const ctx = await requireMembership(userId, companyId, "accounting:read");
  const from = day(range.from, "0001-01-01");
  const to = day(range.to, "9999-12-31");
  return withTenant(ctx, async (tx) => {
    const rows = await tx.execute<{ id: string; code: string; name: string; type: AccountType; opening: number; debit: number; credit: number }>(sql`
      select a.id, a.code, a.name, a.type,
        coalesce(sum(l.debit_minor - l.credit_minor) filter (where e.entry_date < ${from}::date), 0)::float8 as opening,
        coalesce(sum(l.debit_minor) filter (where e.entry_date between ${from}::date and ${to}::date), 0)::float8 as debit,
        coalesce(sum(l.credit_minor) filter (where e.entry_date between ${from}::date and ${to}::date), 0)::float8 as credit
      from ledger_account a
      left join journal_line l on l.account_id = a.id and l.company_id = a.company_id
      left join journal_entry e on e.id = l.entry_id and e.company_id = l.company_id and e.status = 'posted' and e.entry_date <= ${to}::date
      group by a.id, a.code, a.name, a.type
      having count(l.id) filter (where e.id is not null) > 0
      order by a.code`);
    const data: BalanceRow[] = rows.map((r) => ({
      accountId: r.id, code: r.code, name: r.name, type: r.type,
      openingMinor: Number(r.opening), debitMinor: Number(r.debit), creditMinor: Number(r.credit),
      closingMinor: Number(r.opening) + Number(r.debit) - Number(r.credit),
    }));
    const totals = data.reduce((t, r) => ({ debitMinor: t.debitMinor + r.debitMinor, creditMinor: t.creditMinor + r.creditMinor, openingMinor: t.openingMinor + r.openingMinor, closingMinor: t.closingMinor + r.closingMinor }), { debitMinor: 0, creditMinor: 0, openingMinor: 0, closingMinor: 0 });
    // invariant de la partie double : mouvements débit = crédit, et la somme des soldes est nulle
    return { rows: data, totals, balanced: totals.debitMinor === totals.creditMinor && totals.closingMinor === 0 && totals.openingMinor === 0 };
  });
}

export interface LedgerLine {
  date: string;
  number: string | null;
  journalCode: string;
  description: string;
  debitMinor: number;
  creditMinor: number;
  runningMinor: number;
  entryId: string;
}

/** Grand livre d'un compte : report d'ouverture, mouvements dans l'ordre et solde cumulé. */
export async function generalLedger(userId: string, companyId: string, accountId: string, range: { from?: string; to?: string }) {
  const ctx = await requireMembership(userId, companyId, "accounting:read");
  const from = day(range.from, "0001-01-01");
  const to = day(range.to, "9999-12-31");
  return withTenant(ctx, async (tx) => {
    const [account] = await tx.select().from(schema.ledgerAccount).where(eq(schema.ledgerAccount.id, accountId));
    if (!account) return null;
    const [open] = await tx.execute<{ opening: number }>(sql`
      select coalesce(sum(l.debit_minor - l.credit_minor), 0)::float8 as opening
      from journal_line l join journal_entry e on e.id = l.entry_id and e.company_id = l.company_id
      where l.account_id = ${accountId} and e.status = 'posted' and e.entry_date < ${from}::date`);
    const rows = await tx.execute<{ date: string; number: string | null; journal: string; description: string; debit: number; credit: number; entry_id: string }>(sql`
      select e.entry_date::text as date, e.number, j.code as journal, coalesce(l.description, e.description) as description,
             l.debit_minor::float8 as debit, l.credit_minor::float8 as credit, e.id as entry_id
      from journal_line l
      join journal_entry e on e.id = l.entry_id and e.company_id = l.company_id
      join journal j on j.id = e.journal_id and j.company_id = e.company_id
      where l.account_id = ${accountId} and e.status = 'posted' and e.entry_date between ${from}::date and ${to}::date
      order by e.entry_date, e.number, l.position`);
    let running = Number(open!.opening);
    const lines: LedgerLine[] = rows.map((r) => {
      running += Number(r.debit) - Number(r.credit);
      return { date: r.date, number: r.number, journalCode: r.journal, description: r.description, debitMinor: Number(r.debit), creditMinor: Number(r.credit), runningMinor: running, entryId: r.entry_id };
    });
    return { account, side: normalSide(account.type), openingMinor: Number(open!.opening), lines, closingMinor: running };
  });
}

/** Export CSV de toutes les lignes validées de la période (journal, date, numéro, compte, libellés, débit, crédit, pièce). */
export async function exportLedgerCsv(userId: string, companyId: string, range: { from?: string; to?: string }) {
  const ctx = await requireMembership(userId, companyId, "accounting:read");
  await rateLimit(`export:${userId}`, 30, 3600);
  const from = day(range.from, "0001-01-01");
  const to = day(range.to, "9999-12-31");
  return withTenant(ctx, async (tx) => {
    const [co] = await tx.select({ currency: schema.company.currency }).from(schema.company).where(eq(schema.company.id, companyId));
    const exp = currencyExponent(co!.currency);
    const m = (v: number) => (v === 0 ? null : v / 10 ** exp);
    const rows = await tx.execute<{ journal: string; date: string; number: string; code: string; account: string; description: string; line: string | null; debit: number; credit: number; source: string; tiers: string | null }>(sql`
      select j.code as journal, e.entry_date::text as date, e.number, a.code, a.name as account, e.description, l.description as line,
             l.debit_minor::float8 as debit, l.credit_minor::float8 as credit, e.source_type as source, coalesce(c.name, s.name) as tiers
      from journal_line l
      join journal_entry e on e.id = l.entry_id and e.company_id = l.company_id
      join journal j on j.id = e.journal_id and j.company_id = e.company_id
      join ledger_account a on a.id = l.account_id and a.company_id = l.company_id
      left join contact c on c.id = l.contact_id and c.company_id = l.company_id
      left join supplier s on s.id = l.supplier_id and s.company_id = l.company_id
      where e.status = 'posted' and e.entry_date between ${from}::date and ${to}::date
      order by e.entry_date, j.code, e.number, l.position`);
    const headers = ["Journal", "Date", "Numéro d'écriture", "Compte", "Libellé du compte", "Libellé de l'écriture", "Libellé de la ligne", "Tiers", "Débit", "Crédit", "Origine", "Devise"];
    const cells: Cell[][] = rows.map((r) => [r.journal, r.date, r.number, r.code, r.account, r.description, r.line, r.tiers, m(Number(r.debit)), m(Number(r.credit)), r.source, co!.currency]);
    await audit(tx, ctx, "export.generated", "export", "ledger", { from, to, rows: cells.length });
    return { filename: `ecritures_${from}_${to}.csv`, csv: toCsv(headers, cells) };
  });
}
