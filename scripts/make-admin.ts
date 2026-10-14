/**
 * Attribue ou retire le droit d'administrateur de plateforme (opérateurs uniquement).
 *   npx tsx scripts/make-admin.ts personne@exemple.com          # attribue
 *   npx tsx scripts/make-admin.ts personne@exemple.com --revoke # retire
 * La base refuse ce changement hors de ce script (déclencheur), et l'administration exige la double authentification.
 */
import { eq, sql as dsql } from "drizzle-orm";
import { db, schema, sql } from "@/db/client";

const [email, flag] = process.argv.slice(2);
if (!email) {
  console.error("Usage : npx tsx scripts/make-admin.ts <email> [--revoke]");
  process.exit(2);
}
try {
  await db.transaction(async (tx) => {
    await tx.execute(dsql`select set_config('app.platform_admin_op', 'on', true)`);
    const grant = flag !== "--revoke";
    const [u] = await tx.update(schema.user).set({ isPlatformAdmin: grant }).where(eq(schema.user.email, email.toLowerCase())).returning({ id: schema.user.id });
    if (!u) throw new Error(`Aucun utilisateur ${email}`);
    await tx.insert(schema.platformAuditLog).values({ actorId: null, action: grant ? "admin.granted" : "admin.revoked", targetType: "user", targetId: u.id, meta: { via: "script" } });
    console.log(grant ? `${email} est administrateur de la plateforme (la double authentification lui est obligatoire).` : `${email} n'est plus administrateur.`);
  });
} catch (e) {
  console.error(`Échec : ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
