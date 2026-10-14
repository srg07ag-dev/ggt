import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, sql } from "./client";

await migrate(db, { migrationsFolder: "./drizzle" });
await sql.end();
console.log("Migrations appliquées.");
