import { and, eq, sql } from "drizzle-orm";
import { db, schema, type Db } from "@/db/client";
import { checkPermissionAgainstPlan, loadAccess } from "./entitlements";
import { can, type Permission, type Role } from "./permissions";

export class ForbiddenError extends Error {
  constructor(message = "Accès refusé") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export type TenantTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface TenantContext {
  userId: string;
  companyId: string;
  role: Role;
}

/**
 * Résout l'appartenance de l'utilisateur à l'entreprise. Lève ForbiddenError
 * si l'utilisateur n'est pas membre (même message pour « inexistante » et « non membre »,
 * afin de ne pas révéler l'existence d'une entreprise).
 */
export async function requireMembership(
  userId: string,
  companyId: string,
  permission?: Permission,
): Promise<TenantContext> {
  const [row] = await db
    .select({ role: schema.membership.role })
    .from(schema.membership)
    .where(and(eq(schema.membership.userId, userId), eq(schema.membership.companyId, companyId)))
    .limit(1);
  if (!row || (permission && !can(row.role, permission))) throw new ForbiddenError();
  // l'abonnement s'applique après les droits : module inclus, pas d'écriture en lecture seule
  if (permission) checkPermissionAgainstPlan(await loadAccess(companyId), permission, companyId);
  return { userId, companyId, role: row.role };
}

/**
 * Exécute `fn` dans une transaction où la RLS PostgreSQL est liée à l'entreprise.
 * Toute requête sur une table métier ne voit que les lignes de cette entreprise.
 */
export async function withTenant<T>(ctx: TenantContext, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    // set_config(..., true) : valeur locale à la transaction
    await tx.execute(sql`select set_config('app.company_id', ${ctx.companyId}, true)`);
    return fn(tx);
  });
}

export async function audit(
  tx: TenantTx,
  ctx: TenantContext,
  action: string,
  entity: string,
  entityId?: string,
  meta?: unknown,
) {
  await tx.insert(schema.auditLog).values({
    companyId: ctx.companyId,
    actorId: ctx.userId,
    action,
    entity,
    entityId,
    meta: meta ?? null,
  });
}
