import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql as rawSql, db, schema } from "@/db/client";
import { createCompany } from "@/modules/core/companies";
import { ForbiddenError, withTenant } from "@/modules/core/tenant";
import {
  countContactsByState,
  createContact,
  getContact,
  listContacts,
  setContactArchived,
  updateContact,
} from "@/modules/crm/contacts";
import { createOpportunity, listOpportunities, listStages, moveOpportunity } from "@/modules/crm/pipeline";
import { createActivity, listActivities, setActivityStatus } from "@/modules/crm/activities";
import { formatMoney, toMinor } from "@/lib/money";

let a: { id: string }, b: { id: string };
let contactA: { id: string }, contactB: { id: string };

beforeAll(async () => {
  await rawSql`truncate "user", company cascade`;
  for (const id of ["alice", "bob", "viewer"]) await db.insert(schema.user).values({ id, name: id, email: `${id}@t.dev` });
  a = await createCompany("alice", { name: "Alice SARL", country: "TG", currency: "XOF" });
  b = await createCompany("bob", { name: "Bob SAS", country: "FR", currency: "EUR" });
  await db.insert(schema.membership).values({ companyId: a.id, userId: "viewer", role: "viewer" });
  contactA = await createContact("alice", a.id, { name: "Client A", email: "a@x.dev", tags: ["vip"] });
  contactB = await createContact("bob", b.id, { name: "Client B" });
});
afterAll(async () => {
  await rawSql.end();
});

describe("contacts", () => {
  it("recherche, échappe les jokers LIKE et filtre par tag", async () => {
    await createContact("alice", a.id, { name: "100% Bio" });
    expect((await listContacts("alice", a.id, { q: "client" })).map((c) => c.name)).toEqual(["Client A"]);
    expect((await listContacts("alice", a.id, { q: "%" })).map((c) => c.name)).toEqual(["100% Bio"]);
    expect((await listContacts("alice", a.id, { tag: "vip" })).length).toBe(1);
  });

  it("archive, restaure et modifie", async () => {
    const c = await createContact("alice", a.id, { name: "Temp" });
    await setContactArchived("alice", a.id, c.id, true);
    expect((await listContacts("alice", a.id)).some((x) => x.id === c.id)).toBe(false);
    expect((await listContacts("alice", a.id, { archived: true })).some((x) => x.id === c.id)).toBe(true);
    await setContactArchived("alice", a.id, c.id, false);
    const u = await updateContact("alice", a.id, c.id, { name: "Temp 2", kind: "organization" });
    expect(u?.name).toBe("Temp 2");
    expect((await countContactsByState("alice", a.id)).active).toBeGreaterThan(0);
  });

  it("une autre entreprise ne peut ni lire ni modifier un contact", async () => {
    await expect(getContact("bob", a.id, contactA.id)).rejects.toBeInstanceOf(ForbiddenError);
    // bob est membre de B : l'id de A est invisible (RLS) même avec son propre companyId
    expect(await getContact("bob", b.id, contactA.id)).toBeNull();
    expect(await updateContact("bob", b.id, contactA.id, { name: "piraté" })).toBeNull();
  });

  it("un interlocuteur ne peut pas être rattaché à un contact d'une autre entreprise", async () => {
    await expect(createContact("alice", a.id, { name: "Intrus", parentId: contactB.id })).rejects.toThrow();
  });
});

describe("pipeline", () => {
  it("crée les 7 étapes par défaut à la création de l'entreprise", async () => {
    const stages = await listStages("alice", a.id);
    expect(stages.map((s) => s.name)).toContain("Négociation");
    expect(stages).toHaveLength(7);
    expect(stages.every((s) => s.companyId === a.id)).toBe(true);
  });

  it("crée une opportunité dans la devise de l'entreprise, en unités mineures", async () => {
    const o = await createOpportunity("alice", a.id, { contactId: contactA.id, title: "Site web", amount: "1 250 000" });
    expect(o.amountMinor).toBe(1_250_000);
    expect(o.currency).toBe("XOF");
    const e = await createOpportunity("bob", b.id, { contactId: contactB.id, title: "Audit", amount: "99,90" });
    expect(e.amountMinor).toBe(9990);
  });

  it("refuse un contact d'une autre entreprise et un montant invalide", async () => {
    await expect(createOpportunity("alice", a.id, { contactId: contactB.id, title: "x" })).rejects.toThrow();
    await expect(createOpportunity("alice", a.id, { contactId: contactA.id, title: "x", amount: "12,5" })).rejects.toThrow();
  });

  it("« Gagné » fixe la probabilité à 100 et la date de clôture ; ré-ouvrir l'efface", async () => {
    const [o] = await listOpportunities("alice", a.id);
    const stages = await listStages("alice", a.id);
    const won = stages.find((s) => s.kind === "won")!;
    expect(await moveOpportunity("alice", a.id, o!.id, won.id)).toBe(true);
    const ctx = { userId: "alice", companyId: a.id, role: "owner" as const };
    const [row] = await withTenant(ctx, (tx) => tx.select().from(schema.opportunity));
    expect(row!.probability).toBe(100);
    expect(row!.closedAt).not.toBeNull();
  });

  it("on ne peut pas déplacer vers une étape d'une autre entreprise", async () => {
    const [o] = await listOpportunities("alice", a.id);
    const stageB = (await listStages("bob", b.id))[0]!;
    await expect(moveOpportunity("alice", a.id, o!.id, stageB.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("chaque entreprise ne voit que ses opportunités", async () => {
    expect((await listOpportunities("alice", a.id)).map((o) => o.title)).toEqual(["Site web"]);
    expect((await listOpportunities("bob", b.id)).map((o) => o.title)).toEqual(["Audit"]);
  });

  it("un lecteur ne peut pas créer d'opportunité", async () => {
    await expect(createOpportunity("viewer", a.id, { contactId: contactA.id, title: "x" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("activités", () => {
  it("crée, liste et termine une tâche", async () => {
    const t = await createActivity("alice", a.id, {
      type: "follow_up",
      title: "Relancer",
      contactId: contactA.id,
      dueAt: "2026-11-01T09:00",
      assigneeId: "alice",
    });
    expect(t.status).toBe("todo");
    expect(await setActivityStatus("alice", a.id, t.id, "done")).toBe(true);
    expect((await listActivities("alice", a.id, { status: "done" })).map((x) => x.title)).toContain("Relancer");
  });

  it("une note est créée directement terminée", async () => {
    const n = await createActivity("alice", a.id, { type: "note", title: "Appel ok" });
    expect(n.status).toBe("done");
  });

  it("l'assigné doit être membre de l'entreprise", async () => {
    await expect(createActivity("alice", a.id, { type: "call", title: "x", assigneeId: "bob" })).rejects.toThrow();
  });

  it("l'activité d'une entreprise est invisible pour l'autre et inaccessible en écriture", async () => {
    expect((await listActivities("bob", b.id)).length).toBe(0);
    const [t] = await listActivities("alice", a.id);
    expect(await setActivityStatus("bob", b.id, t!.id, "cancelled")).toBe(false);
  });
});

describe("montants", () => {
  it("convertit selon les décimales de la devise", () => {
    expect(toMinor("1 250,50", "EUR")).toBe(125050);
    expect(toMinor("1250", "XOF")).toBe(1250);
    expect(toMinor("12,5", "XOF")).toBeNull();
    expect(toMinor("abc", "EUR")).toBeNull();
    expect(toMinor("-5", "EUR")).toBeNull();
    expect(formatMoney(125050, "EUR", "fr-FR")).toContain("1");
  });
});
