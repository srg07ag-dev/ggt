/**
 * Test de charge des requêtes de lecture sur un jeu de données volumineux (base de TEST uniquement : elle est vidée).
 *   DATABASE_URL=postgres://…/ggt_test npx tsx scripts/loadtest.ts [facteur]
 * Affiche le temps de chaque requête ; sort en erreur si une requête dépasse le budget.
 */
import { db, schema, sql as raw } from "@/db/client";
import { listAudit } from "@/modules/core/audit";
import { createCompany } from "@/modules/core/companies";
import { listActivities } from "@/modules/crm/activities";
import { listContacts } from "@/modules/crm/contacts";
import { listOpportunities } from "@/modules/crm/pipeline";
import { listEntries, listReceipts } from "@/modules/finance/finance";
import { financialReport, parsePeriod } from "@/modules/finance/reports";
import { trialBalance } from "@/modules/accounting/reports";
import { listDocuments, salesSummary } from "@/modules/sales/documents";

if (!/_test\b/.test(process.env.DATABASE_URL ?? "")) {
  console.error("Refus : ce script vide la base. Utilisez une base dont le nom finit par _test.");
  process.exit(2);
}
const F = Number(process.argv[2] ?? 1);
const BUDGET_MS = Number(process.env.BUDGET_MS ?? 1500);

await raw`truncate "user", company, app_rate_limit cascade`;
await db.insert(schema.user).values({ id: "load", name: "Load", email: "load@t.dev" });
const company = (await createCompany("load", { name: "Charge SARL", country: "TG", currency: "XOF" })).id;

const N = { contacts: 20000 * F, activities: 30000 * F, docs: 8000 * F, entries: 20000 * F, audit: 50000 * F };
const t0 = Date.now();
await raw.begin(async (tx) => {
  await tx`select set_config('app.company_id', ${company}, true)`;
  await tx`insert into contact (company_id, name, email, kind) select ${company}, 'Contact ' || g, 'c' || g || '@t.dev', 'person' from generate_series(1, ${N.contacts}) g`;
  await tx`insert into sales_document (company_id, type, status, contact_id, issue_date, due_date, currency, created_at)
           select ${company}, 'invoice', 'draft', (select id from contact where company_id = ${company} order by random() limit 1), date '2026-01-01' + (g % 300), date '2026-02-01' + (g % 300), 'XOF', now() - (g || ' minutes')::interval from generate_series(1, ${N.docs}) g`;
  await tx`insert into sales_line (company_id, document_id, position, description, quantity_milli, unit_price_minor, tax_rate_bp, net_minor, tax_minor)
           select ${company}, id, 1, 'Ligne', 1000, 10000, 0, 10000, 0 from sales_document where company_id = ${company}`;
  await tx`update sales_document set subtotal_minor = 10000, tax_minor = 0, total_minor = 10000, status = 'issued', number = 'FA-' || row_number_fix.n, issued_at = now() from (select id, row_number() over () as n from sales_document where company_id = ${company}) row_number_fix where sales_document.id = row_number_fix.id`;
  await tx`insert into finance_account (company_id, name, kind, currency) values (${company}, 'Banque', 'bank', 'XOF')`;
  await tx`insert into payment (company_id, invoice_id, amount_minor, paid_on, method, account_id)
           select ${company}, d.id, 5000, d.issue_date, 'cash', (select id from finance_account where company_id = ${company} limit 1) from sales_document d where d.company_id = ${company} and random() < 0.5`;
  await tx`insert into finance_entry (company_id, account_id, kind, amount_minor, occurred_on, description)
           select ${company}, (select id from finance_account where company_id = ${company} limit 1), case when g % 3 = 0 then 'income'::entry_kind else 'expense'::entry_kind end, 1000 + g, date '2026-01-01' + (g % 300), 'Opération ' || g from generate_series(1, ${N.entries}) g`;
  await tx`insert into activity (company_id, type, title, status, due_at) select ${company}, 'call', 'Tâche ' || g, case when g % 4 = 0 then 'done'::activity_status else 'todo'::activity_status end, now() + (g % 90 || ' days')::interval from generate_series(1, ${N.activities}) g`;
  await tx`insert into pipeline_stage (company_id, name, position, kind) select ${company}, 'Étape ' || g, g + 20, 'open' from generate_series(1, 1) g`;
  await tx`insert into audit_log (company_id, actor_id, action, entity, entity_id) select ${company}, 'load', 'contact.created', 'contact', g::text from generate_series(1, ${N.audit}) g`;
});
await raw`analyze contact, sales_document, sales_line, payment, finance_entry, activity, audit_log`;
console.log(`Jeu de données créé en ${((Date.now() - t0) / 1000).toFixed(1)} s : ${Object.entries(N).map(([k, v]) => `${v} ${k}`).join(", ")}`);

const results: [string, number, number][] = [];
async function time<T>(label: string, fn: () => Promise<T>, size?: (r: T) => number) {
  const s = performance.now();
  const r = await fn();
  results.push([label, Math.round(performance.now() - s), size ? size(r) : 0]);
}
const period = parsePeriod("2026-01-01", "2026-12-31");
await time("contacts : liste", () => listContacts("load", company), (r) => r.length);
await time("contacts : recherche", () => listContacts("load", company, { q: "Contact 19" }), (r) => r.length);
await time("factures : liste", () => listDocuments("load", company, "invoice"), (r) => r.length);
await time("tâches : liste", () => listActivities("load", company, { status: "todo" }), (r) => r.length);
await time("opportunités : liste", () => listOpportunities("load", company), (r) => r.length);
await time("dépenses : liste", () => listEntries("load", company, { kind: "expense" }), (r) => r.length);
await time("recettes : liste", () => listReceipts("load", company), (r) => r.length);
await time("synthèse des ventes", () => salesSummary("load", company));
await time("rapport financier", () => financialReport("load", company, period));
await time("balance comptable", () => trialBalance("load", company, {}));
await time("audit : 1re page", () => listAudit("load", company), (r) => r.rows.length);

console.log("\nRequête".padEnd(28), "ms".padStart(7), "lignes".padStart(9));
for (const [l, ms, n] of results) console.log(l.padEnd(28), String(ms).padStart(7), (n ? String(n) : "").padStart(9), ms > BUDGET_MS ? "  ⚠ trop lent" : "");
const slow = results.filter(([, ms]) => ms > BUDGET_MS);
await raw.end();
if (slow.length) {
  console.error(`\n${slow.length} requête(s) au-dessus du budget de ${BUDGET_MS} ms.`);
  process.exit(1);
}
console.log(`\nToutes les requêtes sont sous le budget de ${BUDGET_MS} ms.`);
