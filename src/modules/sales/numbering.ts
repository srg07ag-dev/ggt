import { sql } from "drizzle-orm";
import { schema } from "@/db/client";
import type { TenantTx } from "@/modules/core/tenant";

export type DocType = "quote" | "invoice" | "credit_note";

/** Motifs suggérés à la configuration. Ils n'ont aucune valeur légale : à valider selon le pays. */
export const SUGGESTED_PATTERNS: Record<DocType, string> = {
  quote: "DEV-{YYYY}-{NNNN}",
  invoice: "FA-{YYYY}-{NNNN}",
  credit_note: "AV-{YYYY}-{NNNN}",
};

export function validatePattern(pattern: string): string | null {
  if (pattern.length > 40) return "Motif trop long.";
  if (!/\{N{1,10}\}/.test(pattern)) return "Le motif doit contenir un compteur, par exemple {NNNN}.";
  if (!/^[A-Za-z0-9\-_/.{} ]+$/.test(pattern)) return "Caractères autorisés : lettres, chiffres, - _ / . et espaces.";
  const tokens = pattern.match(/\{[^}]*\}/g) ?? [];
  if (tokens.some((t) => t !== "{YYYY}" && !/^\{N{1,10}\}$/.test(t))) return "Jetons autorisés : {YYYY} et {NNNN}.";
  if (tokens.filter((t) => t.startsWith("{N")).length !== 1) return "Un seul compteur est autorisé.";
  return null;
}

export function formatNumber(pattern: string, year: number, n: number): string {
  return pattern
    .replace("{YYYY}", String(year))
    .replace(/\{(N+)\}/, (_, ns: string) => String(n).padStart(ns.length, "0"));
}

/**
 * Attribue le prochain numéro, sans trou : l'incrément est atomique et fait partie de la
 * transaction de l'émission (annulé avec elle en cas d'échec).
 */
export async function nextNumber(tx: TenantTx, companyId: string, type: DocType, issueDate: string): Promise<string> {
  const [cfg] = await tx
    .select({ pattern: schema.numbering.pattern })
    .from(schema.numbering)
    .where(sql`${schema.numbering.docType} = ${type}`);
  if (!cfg) throw new NumberingNotConfiguredError(type);
  const year = Number(issueDate.slice(0, 4));
  const period = cfg.pattern.includes("{YYYY}") ? String(year) : "";
  const rows = await tx.execute<{ last: number }>(sql`
    insert into numbering_counter (company_id, doc_type, period, last)
    values (${companyId}, ${type}, ${period}, 1)
    on conflict (company_id, doc_type, period) do update set last = numbering_counter.last + 1
    returning last`);
  return formatNumber(cfg.pattern, year, rows[0]!.last);
}

export class NumberingNotConfiguredError extends Error {
  constructor(public docType: DocType) {
    super("La numérotation de ce type de document n'est pas configurée (Paramètres).");
    this.name = "NumberingNotConfiguredError";
  }
}
