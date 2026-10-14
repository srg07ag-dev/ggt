import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { BusinessRuleError } from "./errors";
import { canAssignRole, canManageMember, INVITABLE_ROLES, ROLES, type Role } from "./permissions";
import { audit, ForbiddenError, requireMembership, withTenant, type TenantContext, type TenantTx } from "./tenant";

const INVITE_TTL_DAYS = 7;
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
const rule = (m: string) => new BusinessRuleError(m);

/* ---------- Lecture ---------- */

export async function listMembers(userId: string, companyId: string) {
  const ctx = await requireMembership(userId, companyId);
  const members = await db
    .select({ userId: schema.user.id, name: schema.user.name, email: schema.user.email, role: schema.membership.role, joinedAt: schema.membership.createdAt })
    .from(schema.membership)
    .innerJoin(schema.user, eq(schema.user.id, schema.membership.userId))
    .where(eq(schema.membership.companyId, companyId))
    .orderBy(asc(schema.membership.createdAt));
  const canManage = canAssignRole(ctx.role, "viewer");
  const invitations = canManage
    ? await db
        .select({ id: schema.invitation.id, email: schema.invitation.email, role: schema.invitation.role, expiresAt: schema.invitation.expiresAt, createdAt: schema.invitation.createdAt })
        .from(schema.invitation)
        .where(and(eq(schema.invitation.companyId, companyId), isNull(schema.invitation.acceptedAt), isNull(schema.invitation.revokedAt), gt(schema.invitation.expiresAt, new Date())))
        .orderBy(asc(schema.invitation.createdAt))
    : [];
  return { members, invitations, myRole: ctx.role, myUserId: userId };
}

/* ---------- Invitations ---------- */

export async function createInvitation(userId: string, companyId: string, input: { email: string; role: string }) {
  const data = z
    .object({
      email: z.string().trim().toLowerCase().email("E-mail invalide"),
      role: z.enum(ROLES as unknown as [Role, ...Role[]]),
    })
    .parse(input);
  const ctx = await requireMembership(userId, companyId, "members:manage");
  if (!INVITABLE_ROLES.includes(data.role) || !canAssignRole(ctx.role, data.role)) throw new ForbiddenError("Vous ne pouvez pas attribuer ce rôle.");

  return withTenant(ctx, async (tx) => {
    const [existing] = await tx
      .select({ id: schema.membership.id })
      .from(schema.membership)
      .innerJoin(schema.user, eq(schema.user.id, schema.membership.userId))
      .where(and(eq(schema.membership.companyId, companyId), sql`lower(${schema.user.email}) = ${data.email}`));
    if (existing) throw rule("Cette personne est déjà membre de l'entreprise.");

    // une seule invitation en attente par e-mail : la nouvelle remplace l'ancienne
    await tx
      .update(schema.invitation)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.invitation.companyId, companyId), eq(schema.invitation.email, data.email), isNull(schema.invitation.acceptedAt), isNull(schema.invitation.revokedAt)));

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);
    const [row] = await tx
      .insert(schema.invitation)
      .values({ companyId, email: data.email, role: data.role, tokenHash: hashToken(token), invitedBy: userId, expiresAt })
      .returning();
    await audit(tx, ctx, "invitation.created", "invitation", row!.id, { email: data.email, role: data.role });
    return { invitation: row!, token };
  });
}

export async function revokeInvitation(userId: string, companyId: string, id: string) {
  const ctx = await requireMembership(userId, companyId, "members:manage");
  await withTenant(ctx, async (tx) => {
    const [inv] = await tx.select().from(schema.invitation).where(and(eq(schema.invitation.id, id), eq(schema.invitation.companyId, companyId)));
    if (!inv) throw new ForbiddenError();
    if (!canAssignRole(ctx.role, inv.role)) throw new ForbiddenError();
    await tx.update(schema.invitation).set({ revokedAt: new Date() }).where(and(eq(schema.invitation.id, id), isNull(schema.invitation.acceptedAt), isNull(schema.invitation.revokedAt)));
    await audit(tx, ctx, "invitation.revoked", "invitation", id);
  });
}

export type InvitationPreview =
  | { status: "ok"; companyName: string; role: Role; email: string }
  | { status: "invalid" | "expired" | "used" | "revoked" };

/** Aperçu public d'un lien d'invitation (la connaissance du jeton fait foi). */
export async function previewInvitation(token: string): Promise<InvitationPreview> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return { status: "invalid" };
  const [row] = await db
    .select({ inv: schema.invitation, companyName: schema.company.name })
    .from(schema.invitation)
    .innerJoin(schema.company, eq(schema.company.id, schema.invitation.companyId))
    .where(eq(schema.invitation.tokenHash, hashToken(token)));
  if (!row) return { status: "invalid" };
  if (row.inv.acceptedAt) return { status: "used" };
  if (row.inv.revokedAt) return { status: "revoked" };
  if (row.inv.expiresAt <= new Date()) return { status: "expired" };
  return { status: "ok", companyName: row.companyName, role: row.inv.role, email: row.inv.email };
}

/**
 * Accepte une invitation. Conditions : jeton valide, usage unique, non expiré, et l'utilisateur
 * connecté porte l'e-mail invité. L'usage unique est garanti par un UPDATE conditionnel atomique.
 */
export async function acceptInvitation(userId: string, userEmail: string, token: string) {
  const preview = await previewInvitation(token);
  if (preview.status !== "ok") throw rule(INVALID_MESSAGES[preview.status]);
  if (preview.email !== userEmail.trim().toLowerCase()) throw rule(`Cette invitation est destinée à ${preview.email}. Connectez-vous avec cette adresse.`);

  return db.transaction(async (tx) => {
    const [inv] = await tx
      .update(schema.invitation)
      .set({ acceptedAt: new Date() })
      .where(and(eq(schema.invitation.tokenHash, hashToken(token)), isNull(schema.invitation.acceptedAt), isNull(schema.invitation.revokedAt), gt(schema.invitation.expiresAt, new Date())))
      .returning();
    if (!inv) throw rule(INVALID_MESSAGES.used);
    await tx.insert(schema.membership).values({ companyId: inv.companyId, userId, role: inv.role }).onConflictDoNothing();
    await tx.execute(sql`select set_config('app.company_id', ${inv.companyId}, true)`);
    await tx.insert(schema.auditLog).values({ companyId: inv.companyId, actorId: userId, action: "invitation.accepted", entity: "invitation", entityId: inv.id, meta: { role: inv.role } });
    return { companyId: inv.companyId };
  });
}

const INVALID_MESSAGES = {
  invalid: "Ce lien d'invitation n'est pas valide.",
  expired: "Cette invitation a expiré. Demandez-en une nouvelle.",
  used: "Cette invitation a déjà été utilisée.",
  revoked: "Cette invitation a été annulée.",
} as const;

/* ---------- Membres ---------- */

/** Verrouille l'entreprise pour sérialiser les changements de rôles et empêcher de retirer le dernier propriétaire. */
async function lockCompany(tx: TenantTx, companyId: string) {
  await tx.execute(sql`select id from company where id = ${companyId} for update`);
}

async function ownerCount(tx: TenantTx, companyId: string) {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.membership).where(and(eq(schema.membership.companyId, companyId), eq(schema.membership.role, "owner")));
  return r?.n ?? 0;
}

async function loadTarget(tx: TenantTx, companyId: string, targetUserId: string) {
  const [t] = await tx.select().from(schema.membership).where(and(eq(schema.membership.companyId, companyId), eq(schema.membership.userId, targetUserId)));
  if (!t) throw rule("Ce membre n'existe pas dans l'entreprise.");
  return t;
}

export async function changeRole(userId: string, companyId: string, targetUserId: string, newRole: string) {
  const role = z.enum(ROLES as unknown as [Role, ...Role[]]).parse(newRole);
  const ctx = await requireMembership(userId, companyId, "members:manage");
  await withTenant(ctx, async (tx) => {
    await lockCompany(tx, companyId);
    const target = await loadTarget(tx, companyId, targetUserId);
    if (target.role === role) return;
    const self = targetUserId === userId;
    if (self && ctx.role !== "owner") throw new ForbiddenError("Vous ne pouvez pas modifier votre propre rôle.");
    if (!canManageMember(ctx.role, target.role) || !canAssignRole(ctx.role, role)) throw new ForbiddenError();
    if (target.role === "owner" && role !== "owner" && (await ownerCount(tx, companyId)) <= 1) {
      throw rule("L'entreprise doit garder au moins un propriétaire. Nommez d'abord un autre propriétaire.");
    }
    await tx.update(schema.membership).set({ role }).where(eq(schema.membership.id, target.id));
    await audit(tx, ctx, "member.role_changed", "membership", target.id, { userId: targetUserId, from: target.role, to: role });
  });
}

/** Retire un membre, ou permet à un membre de quitter l'entreprise (targetUserId = soi-même). */
export async function removeMember(userId: string, companyId: string, targetUserId: string) {
  const ctx = await requireMembership(userId, companyId);
  const self = targetUserId === userId;
  if (!self && !canAssignRole(ctx.role, "viewer")) throw new ForbiddenError();
  await withTenant(ctx, async (tx) => {
    await lockCompany(tx, companyId);
    const target = await loadTarget(tx, companyId, targetUserId);
    if (!self && !canManageMember(ctx.role, target.role)) throw new ForbiddenError();
    if (target.role === "owner" && (await ownerCount(tx, companyId)) <= 1) {
      throw rule("Le dernier propriétaire ne peut pas quitter l'entreprise. Nommez d'abord un autre propriétaire.");
    }
    // les tâches assignées à ce membre deviennent non assignées (l'historique reste)
    await tx.update(schema.activity).set({ assigneeId: null }).where(eq(schema.activity.assigneeId, targetUserId));
    await tx.delete(schema.membership).where(eq(schema.membership.id, target.id));
    await audit(tx, ctx, self ? "member.left" : "member.removed", "membership", target.id, { userId: targetUserId, role: target.role });
  });
}

export type { TenantContext };
