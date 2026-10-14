import { sql } from "drizzle-orm";
import { schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { currencyExponent } from "@/lib/money";
import { toCsv, type Cell } from "@/lib/csv";
import { audit, requireMembership, withTenant } from "@/modules/core/tenant";
import { listAccounts } from "./finance";

export interface Period {
  from: string;
  to: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export function parsePeriod(from?: string, to?: string, today = new Date().toISOString().slice(0, 10)): Period {
  const y = today.slice(0, 4);
  const f = from && DATE.test(from) ? from : `${y}-01-01`;
  const t = to && DATE.test(to) ? to : `${y}-12-31`;
  return f <= t ? { from: f, to: t } : { from: t, to: f };
}

/**
 * Rapport de gestion. Chaque chiffre est défini séparément et n'est jamais mélangé :
 * chiffre d'affaires (factures émises), encaissements (paiements enregistrés), dépenses, résultat indicatif.
 * Ce n'est pas un état comptable ni fiscal.
 */
export async function financialReport(userId: string, companyId: string, period: Period) {
  const ctx = await requireMembership(userId, companyId, "finance:read");
  const { from, to } = period;
  const data = await withTenant(ctx, async (tx) => {
    const [co] = await tx.select({ currency: schema.company.currency }).from(schema.company).where(eq(schema.company.id, companyId));
    const [docs] = await tx.execute<{ inv_net: number; inv_tax: number; inv_total: number; cn_net: number; cn_tax: number; cn_total: number }>(sql`
      select
        coalesce(sum(subtotal_minor) filter (where type = 'invoice'), 0)::float8 as inv_net,
        coalesce(sum(tax_minor) filter (where type = 'invoice'), 0)::float8 as inv_tax,
        coalesce(sum(total_minor) filter (where type = 'invoice'), 0)::float8 as inv_total,
        coalesce(sum(subtotal_minor) filter (where type = 'credit_note'), 0)::float8 as cn_net,
        coalesce(sum(tax_minor) filter (where type = 'credit_note'), 0)::float8 as cn_tax,
        coalesce(sum(total_minor) filter (where type = 'credit_note'), 0)::float8 as cn_total
      from sales_document where status = 'issued' and issue_date between ${from}::date and ${to}::date`);
    const [pay] = await tx.execute<{ received: number; unassigned: number }>(sql`
      select coalesce(sum(amount_minor), 0)::float8 as received,
             coalesce(sum(amount_minor) filter (where account_id is null), 0)::float8 as unassigned
      from payment where voided_at is null and paid_on between ${from}::date and ${to}::date`);
    const [inc] = await tx.execute<{ amount: number; tax: number }>(sql`
      select coalesce(sum(amount_minor), 0)::float8 as amount, coalesce(sum(tax_minor), 0)::float8 as tax
      from finance_entry where kind = 'income' and voided_at is null and occurred_on between ${from}::date and ${to}::date`);
    const [exp] = await tx.execute<{ amount: number; tax: number }>(sql`
      select coalesce(sum(amount_minor), 0)::float8 as amount, coalesce(sum(tax_minor), 0)::float8 as tax
      from finance_entry where kind = 'expense' and voided_at is null and occurred_on between ${from}::date and ${to}::date`);
    const byCategory = await tx.execute<{ name: string; amount: number }>(sql`
      select coalesce(c.name, 'Sans catégorie') as name, sum(e.amount_minor)::float8 as amount
      from finance_entry e left join finance_category c on c.id = e.category_id and c.company_id = e.company_id
      where e.kind = 'expense' and e.voided_at is null and e.occurred_on between ${from}::date and ${to}::date
      group by 1 order by 2 desc`);
    return { currency: co!.currency, docs: docs!, pay: pay!, inc: inc!, exp: exp!, byCategory };
  });
  const accounts = await listAccounts(userId, companyId, period.to);
  const n = Number;
  const revenueNet = n(data.docs.inv_net) - n(data.docs.cn_net);
  const otherIncomeNet = n(data.inc.amount) - n(data.inc.tax);
  const expenseNet = n(data.exp.amount) - n(data.exp.tax);
  return {
    period,
    currency: data.currency,
    invoiced: { netMinor: n(data.docs.inv_net), taxMinor: n(data.docs.inv_tax), totalMinor: n(data.docs.inv_total) },
    credited: { netMinor: n(data.docs.cn_net), taxMinor: n(data.docs.cn_tax), totalMinor: n(data.docs.cn_total) },
    revenueNetMinor: revenueNet,
    cashIn: { paymentsMinor: n(data.pay.received), otherIncomeMinor: n(data.inc.amount), totalMinor: n(data.pay.received) + n(data.inc.amount), unassignedPaymentsMinor: n(data.pay.unassigned) },
    expenses: { totalMinor: n(data.exp.amount), taxMinor: n(data.exp.tax), netMinor: expenseNet, byCategory: data.byCategory.map((r) => ({ name: r.name, amountMinor: n(r.amount) })) },
    indicativeResultMinor: revenueNet + otherIncomeNet - expenseNet,
    accounts: accounts.filter((a) => !a.archived),
    treasuryMinor: accounts.filter((a) => !a.archived).reduce((s, a) => s + a.balanceMinor, 0),
  };
}

/* ---------- Exports CSV pour le comptable ---------- */

export const EXPORT_KINDS = ["invoices", "payments", "expenses", "income"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export async function buildExport(userId: string, companyId: string, kind: ExportKind, period: Period) {
  const ctx = await requireMembership(userId, companyId, "finance:read");
  return withTenant(ctx, async (tx) => {
    const [co] = await tx.select({ currency: schema.company.currency }).from(schema.company).where(eq(schema.company.id, companyId));
    const exp = currencyExponent(co!.currency);
    const m = (v: number | string | null) => (v === null ? null : Number(v) / 10 ** exp);
    const { from, to } = period;
    let headers: string[];
    let rows: Cell[][];

    if (kind === "invoices") {
      headers = ["Type", "Numéro", "Date", "Échéance", "Client", "Total HT", "Taxes", "Total TTC", "Devise", "Réglé", "Avoirs", "Reste dû", "Facture d'origine"];
      const r = await tx.execute<Record<string, string | number | null>>(sql`
        select d.type, d.number, d.issue_date::text as issue_date, d.due_date::text as due_date, c.name as customer,
               d.subtotal_minor::float8 as net, d.tax_minor::float8 as tax, d.total_minor::float8 as total, d.currency,
               coalesce((select sum(p.amount_minor) from payment p where p.invoice_id = d.id and p.voided_at is null), 0)::float8 as paid,
               coalesce((select sum(k.total_minor) from sales_document k where k.related_id = d.id and k.type = 'credit_note' and k.status = 'issued'), 0)::float8 as credited,
               o.number as origin
          from sales_document d
          join contact c on c.id = d.contact_id and c.company_id = d.company_id
          left join sales_document o on o.id = d.related_id and o.company_id = d.company_id
         where d.status = 'issued' and d.type in ('invoice', 'credit_note') and d.issue_date between ${from}::date and ${to}::date
         order by d.issue_date, d.number`);
      rows = r.map((x) => [
        x.type === "invoice" ? "Facture" : "Avoir", x.number as string, x.issue_date as string, x.due_date as string | null, x.customer as string,
        m(x.net as number), m(x.tax as number), m(x.total as number), x.currency as string,
        x.type === "invoice" ? m(x.paid as number) : null, x.type === "invoice" ? m(x.credited as number) : null,
        x.type === "invoice" ? m(Math.max(0, Number(x.total) - Number(x.paid) - Number(x.credited))) : null, x.origin as string | null,
      ]);
    } else if (kind === "payments") {
      headers = ["Date", "Facture", "Client", "Montant", "Devise", "Moyen", "Référence", "Compte", "Annulé"];
      const r = await tx.execute<Record<string, string | number | boolean | null>>(sql`
        select p.paid_on::text as date, d.number, c.name as customer, p.amount_minor::float8 as amount, d.currency, p.method::text as method,
               p.reference, a.name as account, (p.voided_at is not null) as voided
          from payment p join sales_document d on d.id = p.invoice_id and d.company_id = p.company_id
          join contact c on c.id = d.contact_id and c.company_id = d.company_id
          left join finance_account a on a.id = p.account_id and a.company_id = p.company_id
         where p.paid_on between ${from}::date and ${to}::date order by p.paid_on, p.created_at`);
      rows = r.map((x) => [x.date as string, x.number as string, x.customer as string, m(x.amount as number), x.currency as string, x.method as string, x.reference as string | null, x.account as string | null, x.voided ? "Oui" : "Non"]);
    } else {
      const k = kind === "expenses" ? "expense" : "income";
      headers = ["Date", "Description", "Catégorie", k === "expense" ? "Fournisseur" : "Client", "Compte", "Montant TTC", "Dont taxe", "Montant HT", "Devise", "Référence", "Justificatifs", "Annulé"];
      const r = await tx.execute<Record<string, string | number | boolean | null>>(sql`
        select e.occurred_on::text as date, e.description, cat.name as category, coalesce(s.name, ct.name) as party, a.name as account,
               e.amount_minor::float8 as amount, e.tax_minor::float8 as tax, e.reference, (e.voided_at is not null) as voided,
               (select count(*) from attachment t where t.entry_id = e.id)::int as files
          from finance_entry e
          join finance_account a on a.id = e.account_id and a.company_id = e.company_id
          left join finance_category cat on cat.id = e.category_id and cat.company_id = e.company_id
          left join supplier s on s.id = e.supplier_id and s.company_id = e.company_id
          left join contact ct on ct.id = e.contact_id and ct.company_id = e.company_id
         where e.kind = ${k}::entry_kind and e.occurred_on between ${from}::date and ${to}::date order by e.occurred_on, e.created_at`);
      rows = r.map((x) => [x.date as string, x.description as string, x.category as string | null, x.party as string | null, x.account as string, m(x.amount as number), m(x.tax as number), m(Number(x.amount) - Number(x.tax)), co!.currency, x.reference as string | null, x.files as number, x.voided ? "Oui" : "Non"]);
    }
    await audit(tx, ctx, "export.generated", "export", kind, { from, to, rows: rows.length });
    return { filename: `${kind}_${from}_${to}.csv`, csv: toCsv(headers, rows) };
  });
}
