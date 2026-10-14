import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { sql as rawSql, db, schema } from "@/db/client";
import { createCompany } from "@/modules/core/companies";
import { BusinessRuleError } from "@/modules/core/errors";
import { acceptInvitation, changeRole, createInvitation, listMembers, previewInvitation, removeMember, revokeInvitation } from "@/modules/core/members";
import { canAssignRole, canManageMember } from "@/modules/core/permissions";
import { ForbiddenError, requireMembership, withTenant } from "@/modules/core/tenant";
import { createContact } from "@/modules/crm/contacts";
import { createActivity } from "@/modules/crm/activities";

let a: { id: string }, b: { id: string };
const mk = (id: string) => db.insert(schema.user).values({ id, name: id, email: `${id}@t.dev` });
const invite = async (actor: string, company: string, who: string, role: string) => (await createInvitation(actor, company, { email: `${who}@t.dev`, role })).token;
const join = async (company: string, who: string, role: string) => {
  const token = await invite("owner1", company, who, role);
  await acceptInvitation(who, `${who}@t.dev`, token);
};

beforeAll(async () => {
  await rawSql`truncate "user", company, app_rate_limit cascade`;
  for (const u of ["owner1", "owner2", "admin1", "mgr", "viewer1", "bob", "newbie", "stranger", "ghost"]) await mk(u);
  a = await createCompany("owner1", { name: "Alice SARL", country: "TG", currency: "XOF" });
  b = await createCompany("bob", { name: "Bob SAS", country: "TG", currency: "XOF" });
  await join(a.id, "admin1", "admin");
  await join(a.id, "mgr", "manager");
  await join(a.id, "viewer1", "viewer");
});
afterAll(async () => {
  await rawSql.end();
});

describe("règles de rôles", () => {
  it("un administrateur ne gère ni les administrateurs ni les propriétaires", () => {
    expect(canAssignRole("admin", "manager")).toBe(true);
    expect(canAssignRole("admin", "admin")).toBe(false);
    expect(canAssignRole("admin", "owner")).toBe(false);
    expect(canManageMember("admin", "admin")).toBe(false);
    expect(canManageMember("admin", "owner")).toBe(false);
    expect(canAssignRole("owner", "owner")).toBe(true);
    expect(canAssignRole("manager", "viewer")).toBe(false);
  });
});

describe("invitations", () => {
  it("ne stocke jamais le jeton en clair et n'accepte qu'un usage", async () => {
    const { token, invitation } = await createInvitation("owner1", a.id, { email: "Newbie@T.dev ", role: "member" });
    expect(invitation.email).toBe("newbie@t.dev");
    expect(invitation.tokenHash).not.toBe(token);
    const all = JSON.stringify(await db.select().from(schema.invitation));
    expect(all).not.toContain(token);

    expect(await previewInvitation(token)).toMatchObject({ status: "ok", companyName: "Alice SARL", role: "member" });
    const { companyId } = await acceptInvitation("newbie", "newbie@t.dev", token);
    expect(companyId).toBe(a.id);
    expect((await requireMembership("newbie", a.id)).role).toBe("member");
    await expect(acceptInvitation("newbie", "newbie@t.dev", token)).rejects.toThrow(/déjà été utilisée/);
    expect((await previewInvitation(token)).status).toBe("used");
  });

  it("refuse un autre e-mail, un jeton inventé et un jeton mal formé", async () => {
    const token = await invite("owner1", a.id, "stranger", "viewer");
    await expect(acceptInvitation("ghost", "ghost@t.dev", token)).rejects.toThrow(/destinée à stranger@t.dev/);
    await expect(requireMembership("ghost", a.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await previewInvitation("a".repeat(43))).status).toBe("invalid");
    expect((await previewInvitation("../../etc")).status).toBe("invalid");
    // le bon destinataire peut toujours l'utiliser après la tentative ratée
    await acceptInvitation("stranger", "STRANGER@t.dev", token);
    expect((await requireMembership("stranger", a.id)).role).toBe("viewer");
  });

  it("une invitation expirée ou révoquée est refusée", async () => {
    const { token, invitation } = await createInvitation("owner1", a.id, { email: "late@t.dev", role: "viewer" });
    await db.update(schema.invitation).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.invitation.id, invitation.id));
    await expect(acceptInvitation("ghost", "late@t.dev", token)).rejects.toThrow(/expiré/);

    const second = await createInvitation("owner1", a.id, { email: "gone@t.dev", role: "viewer" });
    await revokeInvitation("owner1", a.id, second.invitation.id);
    await expect(acceptInvitation("ghost", "gone@t.dev", second.token)).rejects.toThrow(/annulée/);
  });

  it("une nouvelle invitation remplace l'ancienne pour le même e-mail", async () => {
    const first = await createInvitation("owner1", a.id, { email: "dup@t.dev", role: "viewer" });
    const second = await createInvitation("owner1", a.id, { email: "dup@t.dev", role: "member" });
    expect((await previewInvitation(first.token)).status).toBe("revoked");
    expect((await previewInvitation(second.token)).status).toBe("ok");
  });

  it("refuse d'inviter un membre existant ou avec un rôle non autorisé", async () => {
    await expect(createInvitation("owner1", a.id, { email: "viewer1@t.dev", role: "viewer" })).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(createInvitation("owner1", a.id, { email: "x@t.dev", role: "owner" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createInvitation("admin1", a.id, { email: "x@t.dev", role: "admin" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createInvitation("mgr", a.id, { email: "x@t.dev", role: "viewer" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createInvitation("owner1", a.id, { email: "pas-un-mail", role: "viewer" })).rejects.toThrow();
    await expect(createInvitation("admin1", a.id, { email: "ok@t.dev", role: "manager" })).resolves.toBeDefined();
  });

  it("une invitation de l'entreprise A ne donne jamais accès à B, et B ne gère pas A", async () => {
    await expect(createInvitation("bob", a.id, { email: "x@t.dev", role: "viewer" })).rejects.toBeInstanceOf(ForbiddenError);
    const pending = (await listMembers("owner1", a.id)).invitations[0]!;
    await expect(revokeInvitation("bob", b.id, pending.id)).rejects.toBeInstanceOf(ForbiddenError); // id d'une autre entreprise
    await expect(listMembers("bob", a.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("un membre non gestionnaire ne voit pas les invitations en attente", async () => {
    expect((await listMembers("viewer1", a.id)).invitations).toEqual([]);
    expect((await listMembers("owner1", a.id)).invitations.length).toBeGreaterThan(0);
  });
});

describe("gestion des membres", () => {
  it("l'administrateur gère les rôles inférieurs mais pas ses pairs, les propriétaires ni lui-même", async () => {
    await changeRole("admin1", a.id, "viewer1", "member");
    expect((await requireMembership("viewer1", a.id)).role).toBe("member");
    await expect(changeRole("admin1", a.id, "mgr", "admin")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(changeRole("admin1", a.id, "owner1", "viewer")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(changeRole("admin1", a.id, "admin1", "owner")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(removeMember("admin1", a.id, "owner1")).rejects.toBeInstanceOf(ForbiddenError);
    await changeRole("owner1", a.id, "viewer1", "viewer");
  });

  it("un manager ou un lecteur ne peut ni changer des rôles ni retirer quelqu'un", async () => {
    await expect(changeRole("mgr", a.id, "viewer1", "member")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(removeMember("viewer1", a.id, "mgr")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("le nouveau rôle prend effet immédiatement", async () => {
    await createContact("owner1", a.id, { name: "C" });
    await expect(createContact("viewer1", a.id, { name: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await changeRole("owner1", a.id, "viewer1", "member");
    await expect(createContact("viewer1", a.id, { name: "x" })).resolves.toBeDefined();
    await changeRole("owner1", a.id, "viewer1", "viewer");
  });

  it("le dernier propriétaire ne peut ni se rétrograder ni partir", async () => {
    await expect(changeRole("owner1", a.id, "owner1", "admin")).rejects.toThrow(/au moins un propriétaire/);
    await expect(removeMember("owner1", a.id, "owner1")).rejects.toThrow(/dernier propriétaire/);
  });

  it("deux propriétaires qui se rétrogradent simultanément laissent toujours un propriétaire", async () => {
    await join(a.id, "owner2", "admin");
    await changeRole("owner1", a.id, "owner2", "owner");
    await Promise.allSettled([changeRole("owner1", a.id, "owner2", "viewer"), changeRole("owner2", a.id, "owner1", "viewer")]);
    const owners = (await listMembers("owner2", a.id).catch(() => listMembers("owner1", a.id))).members.filter((m) => m.role === "owner");
    expect(owners.length).toBeGreaterThanOrEqual(1);
    // remise en état : owner1 propriétaire seul
    const roles = Object.fromEntries((await listMembers("owner1", a.id).catch(() => listMembers("owner2", a.id))).members.map((m) => [m.userId, m.role]));
    const survivor = roles.owner1 === "owner" ? "owner1" : "owner2";
    const other = survivor === "owner1" ? "owner2" : "owner1";
    await changeRole(survivor, a.id, other, "owner");
    await changeRole(survivor, a.id, other, "admin");
    if (survivor === "owner2") await changeRole("owner2", a.id, "owner1", "owner");
  });

  it("retirer un membre lui coupe l'accès et désassigne ses tâches ; l'historique reste", async () => {
    const c = await createContact("owner1", a.id, { name: "Tâches" });
    const t = await createActivity("owner1", a.id, { type: "call", title: "Appeler", contactId: c.id, assigneeId: "mgr" });
    await removeMember("owner1", a.id, "mgr");
    await expect(requireMembership("mgr", a.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createContact("mgr", a.id, { name: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    const [row] = await withTenant({ userId: "owner1", companyId: a.id, role: "owner" }, (tx) => tx.select().from(schema.activity).where(eq(schema.activity.id, t.id)));
    expect(row!.assigneeId).toBeNull();
    expect(row!.title).toBe("Appeler");
  });

  it("un membre peut quitter l'entreprise, puis ne voit plus rien", async () => {
    await removeMember("viewer1", a.id, "viewer1");
    await expect(listMembers("viewer1", a.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("l'audit trace invitations et changements de rôle", async () => {
    const logs = await withTenant({ userId: "owner1", companyId: a.id, role: "owner" }, (tx) => tx.select().from(schema.auditLog));
    const actions = new Set(logs.map((l) => l.action));
    for (const x of ["invitation.created", "invitation.accepted", "invitation.revoked", "member.role_changed", "member.removed", "member.left"]) expect(actions.has(x)).toBe(true);
  });
});
