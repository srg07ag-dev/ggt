/**
 * Journal structuré (une ligne JSON par événement) pour que la supervision puisse filtrer et alerter.
 * Ne consigne jamais de mot de passe, jeton, corps de requête ni adresse e-mail : seulement des identifiants techniques.
 */
type Level = "info" | "warn" | "error";

const SENSITIVE = /pass|secret|token|authorization|cookie|email|key/i;

function clean(fields: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = SENSITIVE.test(k) ? "[masqué]" : v;
  return out;
}

export function log(level: Level, event: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...clean(fields) });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.info)(line);
}

/** Événements de sécurité à surveiller : échecs répétés, refus de permission, signatures invalides… */
export const securityEvent = (event: string, fields: Record<string, unknown> = {}) => log("warn", `security.${event}`, fields);
