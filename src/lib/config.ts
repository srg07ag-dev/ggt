import { z } from "zod";

/**
 * Configuration validée au premier usage (pas à l'import, pour ne pas casser `next build`).
 * En production, les réglages dangereux sont refusés au démarrage plutôt que découverts en incident.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET : 32 caractères minimum"),
  BETTER_AUTH_URL: z.string().url(),
  EMAIL_MODE: z.enum(["smtp", "console", "file"]).optional(),
  SMTP_URL: z.string().optional(),
  EMAIL_FROM: z.string().default("GGT <no-reply@localhost>"),
  REQUIRE_EMAIL_VERIFICATION: z.enum(["true", "false"]).optional(),
  TRUSTED_IP_HEADER: z.string().default("x-forwarded-for"),
  /** Réservé aux tests e2e (serveur `next start` en http avec e-mails dans un fichier). Ne jamais définir en production. */
  ALLOW_INSECURE_TEST_CONFIG: z.enum(["true"]).optional(),
});

export interface AppConfig {
  isProduction: boolean;
  authSecret: string;
  baseUrl: string;
  emailMode: "smtp" | "console" | "file";
  smtpUrl?: string;
  emailFrom: string;
  requireEmailVerification: boolean;
  ipHeader: string;
}

const WEAK_SECRET = /change-me|dev-secret|secret123|password|example/i;

export function parseConfig(env: Record<string, string | undefined>): AppConfig {
  const e = schema.parse(env);
  const relaxed = e.ALLOW_INSECURE_TEST_CONFIG === "true";
  if (relaxed) console.warn("[config] ALLOW_INSECURE_TEST_CONFIG actif : règles de production désactivées (tests uniquement).");
  const prod = e.NODE_ENV === "production" && !relaxed;
  const emailMode = e.EMAIL_MODE ?? (prod ? "smtp" : "console");
  const requireEmailVerification = (e.REQUIRE_EMAIL_VERIFICATION ?? (prod ? "true" : "false")) === "true";

  if (prod) {
    if (WEAK_SECRET.test(e.BETTER_AUTH_SECRET)) throw new Error("BETTER_AUTH_SECRET : valeur d'exemple interdite en production (openssl rand -base64 32).");
    if (!e.BETTER_AUTH_URL.startsWith("https://")) throw new Error("BETTER_AUTH_URL doit être en https en production.");
    if (emailMode !== "smtp") throw new Error("EMAIL_MODE doit être « smtp » en production (les modes console et file exposent les liens).");
    if (!requireEmailVerification) throw new Error("REQUIRE_EMAIL_VERIFICATION ne peut pas être désactivé en production.");
  }
  if (emailMode === "smtp" && !e.SMTP_URL) throw new Error("SMTP_URL est requis avec EMAIL_MODE=smtp.");

  return {
    isProduction: prod,
    authSecret: e.BETTER_AUTH_SECRET,
    baseUrl: e.BETTER_AUTH_URL.replace(/\/$/, ""),
    emailMode,
    smtpUrl: e.SMTP_URL,
    emailFrom: e.EMAIL_FROM,
    requireEmailVerification,
    ipHeader: e.TRUSTED_IP_HEADER,
  };
}

let cached: AppConfig | undefined;
export function getConfig(): AppConfig {
  // `next build` charge les modules sans l'environnement de production : on ne valide qu'à l'exécution.
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return parseConfig({ NODE_ENV: "development", DATABASE_URL: "build", BETTER_AUTH_SECRET: "Q7vK2mX9pL4nR8tY3wZ6bF1hJ5cD0gAe", BETTER_AUTH_URL: "http://localhost:3000" });
  }
  return (cached ??= parseConfig(process.env));
}
