import { describe, expect, it } from "vitest";
import { parseConfig } from "@/lib/config";

const base = { DATABASE_URL: "postgres://x", BETTER_AUTH_SECRET: "a-very-long-random-secret-value-0123456789", BETTER_AUTH_URL: "https://app.example.com" };

describe("configuration", () => {
  it("accepte une configuration de production saine", () => {
    const c = parseConfig({ ...base, NODE_ENV: "production", SMTP_URL: "smtps://u:p@smtp.example.com" });
    expect(c.emailMode).toBe("smtp");
    expect(c.requireEmailVerification).toBe(true);
  });
  it("refuse en production : secret faible, http, e-mail console, vérification désactivée, SMTP absent", () => {
    const prod = { ...base, NODE_ENV: "production", SMTP_URL: "smtps://u:p@smtp.example.com" };
    expect(() => parseConfig({ ...prod, BETTER_AUTH_SECRET: "change-me-with-openssl-rand-base64-32" })).toThrow(/exemple/);
    expect(() => parseConfig({ ...prod, BETTER_AUTH_SECRET: "court" })).toThrow();
    expect(() => parseConfig({ ...prod, BETTER_AUTH_URL: "http://app.example.com" })).toThrow(/https/);
    expect(() => parseConfig({ ...prod, EMAIL_MODE: "console" })).toThrow(/smtp/);
    expect(() => parseConfig({ ...prod, EMAIL_MODE: "file" })).toThrow(/smtp/);
    expect(() => parseConfig({ ...prod, REQUIRE_EMAIL_VERIFICATION: "false" })).toThrow(/vérification|VERIFICATION/i);
    expect(() => parseConfig({ ...base, NODE_ENV: "production" })).toThrow(/SMTP_URL/);
  });
  it("développement : e-mail console et vérification facultative par défaut", () => {
    const c = parseConfig({ ...base, BETTER_AUTH_URL: "http://localhost:3000", NODE_ENV: "development" });
    expect(c.emailMode).toBe("console");
    expect(c.requireEmailVerification).toBe(false);
  });
});

describe("interrupteur de test", () => {
  it("désactive les règles de production uniquement quand il est explicitement demandé", () => {
    const env = { ...base, BETTER_AUTH_URL: "http://localhost:3100", NODE_ENV: "production", EMAIL_MODE: "file", REQUIRE_EMAIL_VERIFICATION: "true" };
    expect(() => parseConfig(env)).toThrow();
    const c = parseConfig({ ...env, ALLOW_INSECURE_TEST_CONFIG: "true" });
    expect(c.isProduction).toBe(false);
    expect(c.emailMode).toBe("file");
    expect(() => parseConfig({ ...env, ALLOW_INSECURE_TEST_CONFIG: "1" })).toThrow();
  });
});
