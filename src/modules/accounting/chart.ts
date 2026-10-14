import { asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@/db/client";
import { BusinessRuleError } from "@/modules/core/errors";
import { audit, requireMembership, withTenant } from "@/modules/core/tenant";

export const ACCOUNT_TYPES = ["asset", "liability", "equity", "revenue", "expense"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const TYPE_LABELS: Record<AccountType, string> = {
  asset: "Actif",
  liability: "Passif",
  equity: "Capitaux propres",
  revenue: "Produit",
  expense: "Charge",
};

/** Sens normal du solde : débit pour l'actif et les charges, crédit pour le reste. */
export const normalSide = (t: AccountType): "debit" | "credit" => (t === "asset" || t === "expense" ? "debit" : "credit");

const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/;
const fail = (path: string, message: string) => new z.ZodError([{ code: "custom", path: [path], message }]);

const accountInput = z.object({
  code: z.string().trim().regex(CODE_RE, "Code : 1 à 20 caractères (lettres, chiffres, . _ -)"),
  name: z.string().trim().min(1, "Libellé requis").max(160),
  type: z.enum(ACCOUNT_TYPES),
});

export async function listLedgerAccounts(userId: string, companyId: string, opts: { includeArchived?: boolean } = {}) {
  const ctx = await requireMembership(userId, companyId, "accounting:read");
  return withTenant(ctx, (tx) =>
    tx.select().from(schema.ledgerAccount).where(opts.includeArchived ? undefined : isNull(schema.ledgerAccount.archivedAt)).orderBy(asc(schema.ledgerAccount.code)),
  );
}

export async function createLedgerAccount(userId: string, companyId: string, input: z.input<typeof accountInput>) {
  const data = accountInput.parse(input);
  const ctx = await requireMembership(userId, companyId, "accounting:write");
  return withTenant(ctx, async (tx) => {
    const [row] = await tx.insert(schema.ledgerAccount).values({ ...data, companyId }).onConflictDoNothing().returning();
    if (!row) throw new BusinessRuleError(`Le compte ${data.code} existe déjà.`);
    await audit(tx, ctx, "ledger_account.created", "ledger_account", row.id, { code: data.code });
    return row;
  });
}

/** Seul le libellé se modifie : le code et le type sont figés (protégés aussi par la base). */
export async function renameLedgerAccount(userId: string, companyId: string, id: string, name: string) {
  const n = z.string().trim().min(1).max(160).parse(name);
  const ctx = await requireMembership(userId, companyId, "accounting:write");
  await withTenant(ctx, async (tx) => {
    await tx.update(schema.ledgerAccount).set({ name: n }).where(eq(schema.ledgerAccount.id, id));
    await audit(tx, ctx, "ledger_account.renamed", "ledger_account", id);
  });
}

export async function setLedgerAccountArchived(userId: string, companyId: string, id: string, archived: boolean) {
  const ctx = await requireMembership(userId, companyId, "accounting:write");
  await withTenant(ctx, async (tx) => {
    await tx.update(schema.ledgerAccount).set({ archivedAt: archived ? new Date() : null }).where(eq(schema.ledgerAccount.id, id));
    await audit(tx, ctx, archived ? "ledger_account.archived" : "ledger_account.restored", "ledger_account", id);
  });
}

/* ---------- Import CSV du plan de comptes (fourni par le comptable) ---------- */

export interface ChartRow {
  line: number;
  code: string;
  name: string;
  type: AccountType;
}
export interface ChartParse {
  rows: ChartRow[];
  errors: { line: number; message: string }[];
}

const TYPE_ALIASES: Record<string, AccountType> = {
  asset: "asset", actif: "asset",
  liability: "liability", passif: "liability",
  equity: "equity", capitaux: "equity", "capitaux propres": "equity",
  revenue: "revenue", produit: "revenue", produits: "revenue",
  expense: "expense", charge: "expense", charges: "expense",
};

/** Découpe une ligne CSV (séparateur « ; » ou « , »), guillemets doubles acceptés. */
function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

/**
 * Lit un plan de comptes « code;libellé;type » (en-tête facultatif). Pure fonction : rien n'est écrit tant que
 * l'utilisateur n'a pas confirmé l'aperçu. Les doublons et les lignes invalides sont signalés, jamais corrigés en silence.
 */
export function parseChartCsv(text: string, maxRows = 5000): ChartParse {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const rows: ChartRow[] = [];
  const errors: ChartParse["errors"] = [];
  const seen = new Map<string, number>();
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    if (!raw.trim()) continue;
    const sep = raw.includes(";") ? ";" : ",";
    const [code = "", name = "", typeRaw = ""] = splitCsvLine(raw, sep);
    const type = TYPE_ALIASES[typeRaw.trim().toLowerCase()];
    if (count === 0 && !type && /^(code|compte|account)/i.test(code)) { count++; continue; } // en-tête
    count++;
    if (count > maxRows) { errors.push({ line: i + 1, message: `Trop de lignes (maximum ${maxRows}).` }); break; }
    if (!CODE_RE.test(code)) { errors.push({ line: i + 1, message: `Code invalide : « ${code.slice(0, 30)} »` }); continue; }
    if (!name) { errors.push({ line: i + 1, message: `Libellé manquant pour ${code}` }); continue; }
    if (name.length > 160) { errors.push({ line: i + 1, message: `Libellé trop long pour ${code}` }); continue; }
    if (!type) { errors.push({ line: i + 1, message: `Type inconnu pour ${code} : « ${typeRaw} » (actif, passif, capitaux, produit, charge)` }); continue; }
    if (seen.has(code)) { errors.push({ line: i + 1, message: `Code ${code} en double (déjà ligne ${seen.get(code)})` }); continue; }
    seen.set(code, i + 1);
    rows.push({ line: i + 1, code, name, type });
  }
  return { rows, errors };
}

/** Importe le plan : tout ou rien, et jamais d'écrasement d'un compte existant (les codes déjà présents sont refusés). */
export async function importChart(userId: string, companyId: string, csv: string) {
  const parsed = parseChartCsv(csv);
  if (parsed.errors.length) throw new BusinessRuleError(`Import refusé : ${parsed.errors.length} ligne(s) invalide(s). Corrigez le fichier d'abord.`);
  if (!parsed.rows.length) throw new BusinessRuleError("Le fichier ne contient aucun compte.");
  const ctx = await requireMembership(userId, companyId, "accounting:write");
  return withTenant(ctx, async (tx) => {
    const existing = await tx.select({ code: schema.ledgerAccount.code }).from(schema.ledgerAccount);
    const have = new Set(existing.map((e) => e.code));
    const clash = parsed.rows.filter((r) => have.has(r.code)).map((r) => r.code);
    if (clash.length) throw new BusinessRuleError(`Comptes déjà existants : ${clash.slice(0, 5).join(", ")}${clash.length > 5 ? "…" : ""}. Rien n'a été importé.`);
    await tx.insert(schema.ledgerAccount).values(parsed.rows.map((r) => ({ companyId, code: r.code, name: r.name, type: r.type })));
    await audit(tx, ctx, "ledger_account.imported", "ledger_account", undefined, { count: parsed.rows.length });
    return { imported: parsed.rows.length };
  });
}

