import { sql } from "drizzle-orm";
import { db } from "@/db/client";

export const dynamic = "force-dynamic";

/** Sonde de santé pour l'hébergeur et la supervision : ne divulgue aucun détail interne. */
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ status: "ok" }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
