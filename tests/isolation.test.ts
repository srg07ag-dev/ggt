import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql as rawSql, db, schema } from "@/db/client";
import { createCompany } from "@/modules/core/companies";
import { createContact, listContacts } from "@/modules/crm/contacts";
import { ForbiddenError, requireMembership, withTenant } from "@/modules/core/tenant";
import { can } from "@/modules/core/permissions";
import { eq } from "drizzle-orm";

const mkUser = async (id: string) =>
  db.insert(schema.user).values({ id, name: id, email: `${id}@test.dev` });

let a: { id: string }, b: { id: string };

beforeAll(async () => {
  await rawSql`truncate "user", company cascade`;
  await mkUser("alice");
  await mkUser("bob");
  a = await createCompany("alice", { name: "Alice SARL", country: "TG", currency: "XOF" });
  b = await createCompany("bob", { name: "Bob Ltd", country: "GB", currency: "GBP" });
  await createContact("alice", a.id, { name: "Client A" });
  await createContact("bob", b.id, { name: "Client B" });
});
afterAll(async () => {
  await rawSql.end();
});

describe("isolation entre entreprises", () => {
  it("chaque entreprise ne voit que ses contacts", async () => {
    expect((await listContacts("alice", a.id)).map((c) => c.name)).toEqual(["Client A"]);
    expect((await listContacts("bob", b.id)).map((c) => c.name)).toEqual(["Client B"]);
  });

  it("un non-membre est refusé côté serveur", async () => {
    await expect(listContacts("alice", b.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createContact("alice", b.id, { name: "intrus" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(requireMembership("alice", "00000000-0000-0000-0000-000000000000")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("la RLS bloque la lecture inter-entreprises même avec une requête non filtrée", async () => {
    const ctx = { userId: "alice", companyId: a.id, role: "owner" as const };
    const rows = await withTenant(ctx, (tx) => tx.select().from(schema.contact));
    expect(rows.every((r) => r.companyId === a.id)).toBe(true);
    expect(rows).toHaveLength(1);
  });

  it("la RLS bloque l'écriture dans une autre entreprise", async () => {
    const ctx = { userId: "alice", companyId: a.id, role: "owner" as const };
    await expect(
      withTenant(ctx, (tx) => tx.insert(schema.contact).values({ companyId: b.id, name: "injection" })),
    ).rejects.toThrow();
  });

  it("sans contexte d'entreprise, aucune ligne n'est visible", async () => {
    const rows = await db.transaction((tx) => tx.select().from(schema.contact));
    expect(rows).toHaveLength(0);
  });

  it("le journal d'audit est en ajout seul et isolé", async () => {
    const ctx = { userId: "alice", companyId: a.id, role: "owner" as const };
    const logs = await withTenant(ctx, (tx) => tx.select().from(schema.auditLog));
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((l) => l.companyId === a.id)).toBe(true);
    await expect(
      withTenant(ctx, (tx) => tx.delete(schema.auditLog).where(eq(schema.auditLog.companyId, a.id))),
    ).rejects.toThrow();
  });
});

describe("permissions par rôle", () => {
  it("un lecteur ne peut pas écrire dans le CRM", async () => {
    await mkUser("carol");
    await db.insert(schema.membership).values({ companyId: a.id, userId: "carol", role: "viewer" });
    await expect(createContact("carol", a.id, { name: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listContacts("carol", a.id)).length).toBe(1);
  });

  it("un même utilisateur a un rôle différent selon l'entreprise", async () => {
    await db.insert(schema.membership).values({ companyId: b.id, userId: "alice", role: "accountant" });
    expect((await requireMembership("alice", a.id)).role).toBe("owner");
    expect((await requireMembership("alice", b.id)).role).toBe("accountant");
    expect(can("accountant", "crm:write")).toBe(false);
  });
});
