import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql as rawSql, db, schema } from "@/db/client";
import { rateLimit, RateLimitError } from "@/lib/rate-limit";
import { createCompany } from "@/modules/core/companies";
import { acceptInvitation, createInvitation } from "@/modules/core/members";
import { buildExport, parsePeriod } from "@/modules/finance/reports";
import { sql } from "drizzle-orm";

beforeAll(async () => {
  await rawSql`truncate "user", company, app_rate_limit cascade`;
});
afterAll(async () => {
  await rawSql.end();
});

describe("limitation de débit applicative", () => {
  it("laisse passer jusqu'à la limite puis refuse, avec un délai d'attente", async () => {
    for (let i = 0; i < 3; i++) await rateLimit("t:basic", 3, 60);
    const err = await rateLimit("t:basic", 3, 60).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.retryAfterSeconds).toBeGreaterThan(0);
    expect(err.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("les clés sont indépendantes", async () => {
    await rateLimit("t:a", 1, 60);
    await expect(rateLimit("t:b", 1, 60)).resolves.toBeUndefined();
    await expect(rateLimit("t:a", 1, 60)).rejects.toBeInstanceOf(RateLimitError);
  });

  it("la fenêtre se réinitialise après expiration", async () => {
    await rateLimit("t:window", 1, 60);
    await expect(rateLimit("t:window", 1, 60)).rejects.toBeInstanceOf(RateLimitError);
    await db.execute(sql`update app_rate_limit set window_start = now() - interval '2 minutes' where key = 't:window'`);
    await expect(rateLimit("t:window", 1, 60)).resolves.toBeUndefined();
  });

  it("reste exact sous requêtes simultanées", async () => {
    const r = await Promise.allSettled(Array.from({ length: 20 }, () => rateLimit("t:burst", 5, 60)));
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(5);
    expect(r.filter((x) => x.status === "rejected")).toHaveLength(15);
  });

  it("freine les essais de jetons d'invitation (10 par 15 minutes et par utilisateur)", async () => {
    await db.insert(schema.user).values({ id: "guesser", name: "g", email: "g@t.dev" });
    const results: string[] = [];
    for (let i = 0; i < 12; i++) {
      results.push(await acceptInvitation("guesser", "g@t.dev", "a".repeat(43)).then(() => "ok", (e: Error) => e.name));
    }
    expect(results.slice(0, 10).every((r) => r === "BusinessRuleError")).toBe(true);
    expect(results.slice(10)).toEqual(["RateLimitError", "RateLimitError"]);
  });

  it("freine la création d'invitations et les exports", async () => {
    await db.insert(schema.user).values({ id: "boss", name: "b", email: "b@t.dev" });
    const c = await createCompany("boss", { name: "Boss SARL", country: "TG", currency: "XOF" });
    for (let i = 0; i < 30; i++) await createInvitation("boss", c.id, { email: `p${i}@t.dev`, role: "viewer" });
    await expect(createInvitation("boss", c.id, { email: "p31@t.dev", role: "viewer" })).rejects.toBeInstanceOf(RateLimitError);
    for (let i = 0; i < 30; i++) await buildExport("boss", c.id, "invoices", parsePeriod());
    await expect(buildExport("boss", c.id, "invoices", parsePeriod())).rejects.toBeInstanceOf(RateLimitError);
  });
});
