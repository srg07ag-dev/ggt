import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { securityEvent } from "./log";

export class RateLimitError extends Error {
  constructor(public retryAfterSeconds: number) {
    super("Trop de tentatives. Réessayez dans quelques instants.");
    this.name = "RateLimitError";
  }
}

/**
 * Compteur à fenêtre fixe, atomique et partagé entre instances (PostgreSQL).
 * Lève RateLimitError au-delà de `limit` requêtes par fenêtre de `windowSeconds`.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<void> {
  const rows = await db.execute<{ count: number; window_start: Date }>(sql`
    insert into app_rate_limit (key, window_start, count) values (${key}, now(), 1)
    on conflict (key) do update set
      window_start = case when app_rate_limit.window_start < now() - make_interval(secs => ${windowSeconds}) then now() else app_rate_limit.window_start end,
      count = case when app_rate_limit.window_start < now() - make_interval(secs => ${windowSeconds}) then 1 else app_rate_limit.count + 1 end
    returning count, window_start`);
  const row = rows[0]!;
  if (row.count > limit) {
    const elapsed = (Date.now() - new Date(row.window_start).getTime()) / 1000;
    securityEvent("rate_limited", { bucket: key.split(":")[0] });
    throw new RateLimitError(Math.max(1, Math.ceil(windowSeconds - elapsed)));
  }
  // nettoyage opportuniste des compteurs périmés (1 requête sur 200)
  if (Math.random() < 0.005) await db.execute(sql`delete from app_rate_limit where window_start < now() - interval '1 day'`);
}
