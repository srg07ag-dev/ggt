import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql as rawSql, db, schema } from "@/db/client";
import { ACTION_LABELS, listAudit, PAGE_SIZE } from "@/modules/core/audit";
import { createCompany } from "@/modules/core/companies";
import { ForbiddenError, audit, withTenant } from "@/modules/core/tenant";
import { createContact } from "@/modules/crm/contacts";

let a: { id: string }, b: { id: string };
beforeAll(async () => {
  await rawSql`truncate "user", company, app_rate_limit cascade`;
  for (const id of ["owner", "bob", "viewer", "acct", "mgr"]) await db.insert(schema.user).values({ id, name: id, email: `${id}@t.dev` });
  a = await createCompany("owner", { name: "Alice SARL", country: "TG", currency: "XOF" });
  b = await createCompany("bob", { name: "Bob SAS", country: "TG", currency: "XOF" });
  await db.insert(schema.membership).values([
    { companyId: a.id, userId: "viewer", role: "viewer" },
    { companyId: a.id, userId: "acct", role: "accountant" },
    { companyId: a.id, userId: "mgr", role: "manager" },
  ]);
  const ctx = { userId: "owner", companyId: a.id, role: "owner" as const };
  await withTenant(ctx, async (tx) => {
    for (let i = 0; i < PAGE_SIZE + 20; i++) await audit(tx, ctx, "contact.created", "contact", String(i));
  });
  await createContact("bob", b.id, { name: "Secret B" });
});
afterAll(async () => {
  await rawSql.end();
});

describe("journal d'audit", () => {
  it("réservé aux rôles autorisés", async () => {
    await expect(listAudit("owner", a.id)).resolves.toBeDefined();
    await expect(listAudit("acct", a.id)).resolves.toBeDefined();
    await expect(listAudit("viewer", a.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listAudit("mgr", a.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listAudit("bob", a.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("est isolé par entreprise", async () => {
    const { rows } = await listAudit("bob", b.id);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.entity !== "contact" || r.entityId !== "0")).toBe(true);
    const mine = await listAudit("owner", a.id);
    expect(mine.rows.some((r) => r.actorName === "bob")).toBe(false);
  });

  it("pagine sans doublon ni trou, du plus récent au plus ancien", async () => {
    const seen = new Set<string>();
    let cursor: string | undefined;
    let total = 0;
    for (let i = 0; i < 10; i++) {
      const { rows, next } = await listAudit("owner", a.id, { before: cursor });
      for (const r of rows) {
        expect(seen.has(r.id)).toBe(false);
        seen.add(r.id);
      }
      total += rows.length;
      if (!next) break;
      cursor = next;
    }
    const all = await withTenant({ userId: "owner", companyId: a.id, role: "owner" }, (tx) => tx.select().from(schema.auditLog));
    expect(total).toBe(all.length);
  });

  it("filtre par famille et ignore un curseur ou une famille falsifiés", async () => {
    const { rows } = await listAudit("owner", a.id, { family: "contact." });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.action.startsWith("contact."))).toBe(true);
    const none = await listAudit("owner", a.id, { family: "member." });
    expect(none.rows).toHaveLength(0);
    await expect(listAudit("owner", a.id, { family: "%", before: "n'importe quoi|'; drop table x;--" })).resolves.toBeDefined();
  });

  it("chaque action tracée dans le code a un libellé", async () => {
    const { execSync } = await import("node:child_process");
    const out = execSync(`grep -rhoE 'audit\\(tx, ctx, [^,]+' src/modules | sed -E 's/audit\\(tx, ctx, //'`).toString().trim().split("\n");
    const literals = out.filter((x) => /^"[a-z_.]+"$/.test(x)).map((x) => x.replace(/"/g, ""));
    const missing = literals.filter((l) => !ACTION_LABELS[l]);
    expect(missing).toEqual([]);
  });
});
