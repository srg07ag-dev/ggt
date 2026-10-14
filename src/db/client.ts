import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL manquant");

const globalForDb = globalThis as unknown as { sql?: ReturnType<typeof postgres> };
export const sql = (globalForDb.sql ??= postgres(url, { max: 10 }));
export const db = drizzle(sql, { schema });
export type Db = typeof db;
export { schema };
