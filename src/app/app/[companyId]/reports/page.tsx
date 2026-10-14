import { Download } from "lucide-react";
import { Card, CardTitle } from "@/components/ui/card";
import { PillTabs } from "@/components/ui/pill-tabs";
import { todayIn } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { getCompanyProfile } from "@/modules/core/settings";
import { financialReport, parsePeriod } from "@/modules/finance/reports";
import { salesSummary } from "@/modules/sales/documents";

export const metadata = { title: "Rapports" };

function presets(today: string) {
  const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  const pad = (n: number) => String(n).padStart(2, "0");
  const last = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const q0 = Math.floor((m - 1) / 3) * 3 + 1;
  return [
    { key: "month", label: "Ce mois", from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${last(y, m)}` },
    { key: "quarter", label: "Ce trimestre", from: `${y}-${pad(q0)}-01`, to: `${y}-${pad(q0 + 2)}-${last(y, q0 + 2)}` },
    { key: "year", label: "Cette année", from: `${y}-01-01`, to: `${y}-12-31` },
  ];
}

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 py-1.5 text-sm ${strong ? "border-t border-border pt-2 font-semibold" : ""} ${muted ? "text-muted" : ""}`}>
      <dt>{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}

export default async function Reports({ params, searchParams }: { params: Promise<{ companyId: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const { companyId } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const profile = await getCompanyProfile(user.id, companyId);
  const today = todayIn(profile.timezone);
  const period = parsePeriod(sp.from, sp.to, today);
  const [r, sales] = await Promise.all([financialReport(user.id, companyId, period), salesSummary(user.id, companyId)]);
  const money = (n: number) => formatMoney(n, r.currency);
  const ps = presets(today);
  const base = `/app/${companyId}/reports`;
  const q = `from=${period.from}&to=${period.to}`;


  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Rapports de gestion</h1>
        <p className="text-sm text-muted">Période : {period.from} → {period.to}. Ces chiffres sont des indicateurs de gestion, pas des états comptables ou fiscaux.</p>
      </div>
      <PillTabs label="Période" tabs={ps.map((p) => ({ href: `${base}?from=${p.from}&to=${p.to}`, label: p.label, active: p.from === period.from && p.to === period.to }))} />
      <form className="flex flex-wrap items-end gap-3" role="search">
        <label className="space-y-1 text-sm font-medium">Du<input type="date" name="from" defaultValue={period.from} className="mt-1 block h-10 rounded-[var(--radius-sm)] border border-border-strong bg-surface px-3 text-sm" /></label>
        <label className="space-y-1 text-sm font-medium">Au<input type="date" name="to" defaultValue={period.to} className="mt-1 block h-10 rounded-[var(--radius-sm)] border border-border-strong bg-surface px-3 text-sm" /></label>
        <button className="h-10 rounded-[var(--radius-sm)] border border-border-strong bg-surface px-4 text-sm font-medium hover:bg-surface-2">Appliquer</button>
      </form>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardTitle hint={`Au ${period.to}`}>Trésorerie disponible</CardTitle>
          <p className="num mb-3 text-3xl font-semibold tracking-tight">{r.accounts.length ? money(r.treasuryMinor) : "—"}</p>
          <dl>{r.accounts.map((a) => <Row key={a.id} label={a.name} value={money(a.balanceMinor)} muted />)}</dl>
          {r.accounts.length === 0 && <p className="text-sm text-muted">Aucun compte de trésorerie.</p>}
        </Card>
        <Card>
          <CardTitle hint="Factures émises sur la période, nettes des avoirs émis">Chiffre d&apos;affaires</CardTitle>
          <dl>
            <Row label="Facturé HT" value={money(r.invoiced.netMinor)} />
            <Row label="Avoirs HT" value={money(r.credited.netMinor ? -r.credited.netMinor : 0)} />
            <Row label="Chiffre d'affaires net HT" value={money(r.revenueNetMinor)} strong />
            <Row label="Taxes facturées (nettes d'avoirs)" value={money(r.invoiced.taxMinor - r.credited.taxMinor)} muted />
          </dl>
        </Card>
        <Card>
          <CardTitle hint="Argent réellement reçu sur la période (paiements enregistrés et autres recettes)">Encaissements</CardTitle>
          <dl>
            <Row label="Paiements de factures" value={money(r.cashIn.paymentsMinor)} />
            <Row label="Autres recettes" value={money(r.cashIn.otherIncomeMinor)} />
            <Row label="Total encaissé" value={money(r.cashIn.totalMinor)} strong />
            {r.cashIn.unassignedPaymentsMinor > 0 && <Row label="Dont non affecté à un compte" value={money(r.cashIn.unassignedPaymentsMinor)} muted />}
          </dl>
        </Card>
        <Card>
          <CardTitle hint="État actuel de toutes les factures émises">Créances clients</CardTitle>
          <dl>
            <Row label="À encaisser" value={money(sales.outstandingMinor)} strong />
            <Row label={`Dont en retard (${sales.overdueCount})`} value={money(sales.overdueMinor)} muted />
          </dl>
        </Card>
        <Card>
          <CardTitle hint="Dépenses enregistrées sur la période, hors opérations annulées">Dépenses</CardTitle>
          <dl>
            <Row label="Total TTC" value={money(r.expenses.totalMinor)} />
            <Row label="Dont taxes" value={money(r.expenses.taxMinor)} muted />
            <Row label="Total HT" value={money(r.expenses.netMinor)} strong />
          </dl>
          {r.expenses.byCategory.length > 0 && (
            <div className="mt-3 border-t border-border pt-3"><dl>{r.expenses.byCategory.map((c) => <Row key={c.name} label={c.name} value={money(c.amountMinor)} muted />)}</dl></div>
          )}
        </Card>
        <Card>
          <CardTitle hint="Chiffre d'affaires net + autres recettes − dépenses, hors taxes">Résultat de gestion (indicatif)</CardTitle>
          <p className={`num text-3xl font-semibold tracking-tight ${r.indicativeResultMinor < 0 ? "text-danger" : ""}`}>{money(r.indicativeResultMinor)}</p>
          <p className="mt-3 text-xs text-muted">Impôts estimés et impôts dus : non calculés. Ils seront disponibles avec l&apos;assistant fiscal, une fois les règles de votre pays validées.</p>
        </Card>
      </div>

      <Card>
        <CardTitle hint="CSV compatible Excel (séparateur « ; », UTF-8). La période affichée est appliquée.">Exports pour votre comptable</CardTitle>
        <div className="flex flex-wrap gap-2">
          {[["invoices", "Factures et avoirs"], ["payments", "Paiements"], ["expenses", "Dépenses"], ["income", "Autres recettes"]].map(([k, l]) => (
            <a key={k} href={`/app/${companyId}/exports/${k}?${q}`} className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-border-strong bg-surface px-4 text-sm font-medium hover:bg-surface-2">
              <Download className="size-4" aria-hidden /> {l}
            </a>
          ))}
        </div>
      </Card>
    </div>
  );
}
