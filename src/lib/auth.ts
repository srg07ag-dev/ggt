import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { db, schema } from "@/db/client";
import { getConfig } from "./config";
import { rateLimit, RateLimitError } from "./rate-limit";
import { mails, sendMail } from "./mailer";

const cfg = getConfig();

export const auth = betterAuth({
  baseURL: cfg.baseUrl,
  secret: cfg.authSecret,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    requireEmailVerification: cfg.requireEmailVerification,
    resetPasswordTokenExpiresIn: 60 * 60,
    // un mot de passe réinitialisé déconnecte tous les appareils (un voleur de session est évincé)
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      // pas d'await : le temps de réponse ne doit pas révéler si le compte existe
      void sendMail(mails.reset(user.email, url)).catch((e) => console.error("Échec d'envoi (reset)", e instanceof Error ? e.message : e));
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60,
    sendVerificationEmail: async ({ user, url }) => {
      void sendMail(mails.verify(user.email, url)).catch((e) => console.error("Échec d'envoi (vérification)", e instanceof Error ? e.message : e));
    },
  },
  session: { expiresIn: 60 * 60 * 24 * 14, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60, max: 10 },
      "/request-password-reset": { window: 300, max: 3 },
      "/reset-password": { window: 300, max: 5 },
      "/send-verification-email": { window: 300, max: 3 },
      "/two-factor/verify-totp": { window: 60, max: 5 },
      "/two-factor/verify-backup-code": { window: 60, max: 5 },
    },
  },
  hooks: {
    // Limite par compte (en plus de la limite par IP) : un attaquant qui change d'IP ne peut pas deviner un mot de passe en masse.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-in/email") return;
      const email = String((ctx.body as { email?: unknown } | undefined)?.email ?? "").trim().toLowerCase().slice(0, 254);
      if (!email) return;
      try {
        await rateLimit(`login:${email}`, 20, 900);
      } catch (e) {
        if (e instanceof RateLimitError) throw new APIError("TOO_MANY_REQUESTS", { message: "Trop de tentatives de connexion. Réessayez dans quelques minutes." });
        throw e;
      }
    }),
  },
  advanced: {
    useSecureCookies: cfg.isProduction,
    ipAddress: { ipAddressHeaders: [cfg.ipHeader] },
  },
  plugins: [twoFactor({ issuer: "GGT" }), nextCookies()],
});
