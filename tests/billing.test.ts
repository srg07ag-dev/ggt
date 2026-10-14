import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql as dsql } from "drizzle-orm";
import { sql as rawSql, db, schema } from "@/db/client";
import { adminMarkInvoicePaid, adminOverview, adminVoidInvoice, extendTrial, getCompanyAdmin, grantComplimentary, listCompaniesAdmin, listPlatformAudit, setSuspended } from "@/modules/billing/admin";
import { markInvoicePaid } from "@/modules/billing/invoices";
import { runBillingJob } from "@/modules/billing/jobs";
import { archivePlan, createPlan, listPlansAdmin, updatePlan } from "@/modules/billing/plans";
import { assertPlatformAdmin, savePlatformSettings } from "@/modules/billing/platform";
import { cancelSubscription, getBillingView, requestPlan, resumeSubscription } from "@/modules/billing/subscriptions";
import { processWebhookEvent, signWebhook, verifyWebhook } from "@/modules/billing/webhook";
import { createCompany } from "@/modules/core/companies";
import { clearAccessCache, loadAccess, PlanRestrictionError } from "@/modules/core/entitlements";
import { BusinessRuleError } from "@/modules/core/errors";
import { acceptInvitation, createInvitation } from "@/modules/core/members";
import { ForbiddenError, requireMembership, withTenant } from "@/modules/core/tenant";
import { createContact, listContacts } from "@/modules/crm/contacts";
import { addAttachment, createAccount, createEntry } from "@/modules/finance/finance";
import { listAccounts } from "@/modules/finance/finance";
import { setNumbering } from "@/modules/core/settings";
import { addLine, createDraft, issueDocument } from "@/modules/sales/documents";
import { buildExport, parsePeriod } from "@/modules/finance/reports";

const DAY = 86_400_000;
const ALL = ["crm", "sales", "finance", "accounting", "tax"] as const;
const dbError = async (p: Promise<unknown>) => {
  const e = await p.then(() => null, (x: { cause?: { message?: string }; message: string }) => x);
  expect(e, "une erreur de la base était attendue").not.toBeNull();
  return String(e!.cause?.message ?? e!.message);
};
const PDF = Buffer.from("%PDF-1.4\n%test\n");
const mkUser = (id: string, o: { admin?: boolean; twoFactor?: boolean } = {}) =>
  db.transaction(async (tx) => {
    await tx.execute(dsql`select set_config('app.platform_admin_op', ${o.admin ? "on" : "off"}, true)`);
    await tx.insert(schema.user).values({ id, name: id, email: `${id}@t.dev`, isPlatformAdmin: !!o.admin, twoFactorEnabled: o.twoFactor ?? false });
  });

/** Recule les périodes facturées dans le temps (le déclencheur d'immutabilité est suspendu le temps de la manipulation de test). */
const shiftInvoices = async (companyId: string, days: number) => {
  await rawSql`alter table billing_invoice disable trigger billing_invoice_guard`;
  await rawSql`update billing_invoice set period_start = period_start - make_interval(days => ${days}), period_end = period_end - make_interval(days => ${days}) where company_id = ${companyId}`;
  await rawSql`alter table billing_invoice enable trigger billing_invoice_guard`;
};

let admin = "admin", free: { id: string }, basic: { id: string }, pro: { id: string }, hidden: { id: string };
const company = async (owner: string, name = "Co") => (await createCompany(owner, { name: `${name} SARL`, country: "TG", currency: "EUR" })).id;
const planInput = (code: string, o: Record<string, unknown> = {}) => ({ code, name: code.toUpperCase(), currency: "EUR", price: "0", interval: "month" as const, modules: [...ALL], ...o });

beforeAll(async () => {
  await rawSql`truncate "user", company, app_rate_limit, plan, platform_audit_log, billing_event, platform_counter cascade`;
  await rawSql`update platform_settings set billing_enabled = false, grace_days = 7`;
  clearAccessCache();
  await mkUser("admin", { admin: true, twoFactor: true });
  for (const u of ["alice", "bob", "carol", "dave", "noadmin"]) await mkUser(u);
  await mkUser("admin-no2fa", { admin: true, twoFactor: false });
});
afterAll(async () => {
  await rawSql`update platform_settings set billing_enabled = false`;
  clearAccessCache();
  await rawSql.end();
});

describe("accès à l'administration", () => {
  it("exige le droit d'opérateur et la double authentification", async () => {
    await expect(assertPlatformAdmin("noadmin")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(assertPlatformAdmin("admin-no2fa")).rejects.toThrow(/double authentification/);
    await expect(assertPlatformAdmin("admin")).resolves.toBeDefined();
    await expect(assertPlatformAdmin("inconnu")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("le droit d'administrateur ne s'accorde pas par une requête ordinaire (déclencheur en base)", async () => {
    expect(await dbError(db.update(schema.user).set({ isPlatformAdmin: true }).where(eq(schema.user.id, "noadmin")))).toMatch(/ne peut pas être modifié/);
    expect(await dbError(db.insert(schema.user).values({ id: "x", name: "x", email: "x@t.dev", isPlatformAdmin: true }))).toMatch(/ne peut pas être attribué/);
    const [u] = await db.select().from(schema.user).where(eq(schema.user.id, "noadmin"));
    expect(u!.isPlatformAdmin).toBe(false);
  });

  it("les fonctions d'administration refusent un utilisateur ordinaire", async () => {
    await expect(createPlan("noadmin", planInput("x"))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(adminOverview("alice")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listCompaniesAdmin("alice")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(savePlatformSettings("alice", { billingEnabled: true, graceDays: 7 })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("offres", () => {
  it("valide les offres et refuse les doublons", async () => {
    await expect(createPlan(admin, planInput("Mauvais Code"))).rejects.toThrow();
    await expect(createPlan(admin, planInput("neg", { price: "-5" }))).rejects.toThrow();
    await expect(createPlan(admin, planInput("nomod", { modules: [] }))).rejects.toThrow(/module/);
    await expect(createPlan(admin, planInput("devise", { currency: "EU" }))).rejects.toThrow();
    free = await createPlan(admin, planInput("gratuit", { price: "0", modules: ["crm"], members: 2, isDefault: true }));
    await expect(createPlan(admin, planInput("gratuit"))).rejects.toBeInstanceOf(BusinessRuleError);
    basic = await createPlan(admin, planInput("basique", { price: "10", modules: ["crm", "sales"], members: 3, invoicesPerMonth: 2, storageMb: 1, trialDays: 14 }));
    pro = await createPlan(admin, planInput("pro", { price: "50", modules: [...ALL], members: "", trialDays: 0 }));
    hidden = await createPlan(admin, planInput("sur-mesure", { price: "99", isPublic: false }));
    expect((await listPlansAdmin(admin)).length).toBe(4);
  });

  it("une seule offre par défaut ; l'offre par défaut ne s'archive pas", async () => {
    await updatePlan(admin, basic.id, planInput("basique", { price: "10", modules: ["crm", "sales"], members: 3, invoicesPerMonth: 2, storageMb: 1, trialDays: 14, isDefault: true }));
    const defaults = (await db.select().from(schema.plan)).filter((p) => p.isDefault);
    expect(defaults.map((p) => p.code)).toEqual(["basique"]);
    await expect(archivePlan(admin, basic.id, true)).rejects.toThrow(/par défaut/);
  });

  it("activer la facturation exige une offre par défaut ; le délai de grâce est borné", async () => {
    await expect(savePlatformSettings(admin, { billingEnabled: true, graceDays: 99 })).rejects.toThrow();
    await savePlatformSettings(admin, { billingEnabled: true, graceDays: 7, paymentInstructions: "Virement sur le compte de test" });
    expect((await db.select().from(schema.platformSettings))[0]!.billingEnabled).toBe(true);
  });
});

describe("abonnement d'une nouvelle entreprise", () => {
  it("l'offre par défaut avec essai démarre un essai et donne accès à ses modules seulement", async () => {
    const c = await company("alice", "Alice");
    const a = await loadAccess(c, new Date());
    expect(a.state).toBe("trialing");
    expect(a.modules.sort()).toEqual(["crm", "sales"]);
    expect(a.until!.getTime() - Date.now()).toBeGreaterThan(13 * DAY);
    await expect(requireMembership("alice", c, "crm:write")).resolves.toBeDefined();
    await expect(requireMembership("alice", c, "accounting:read")).rejects.toBeInstanceOf(PlanRestrictionError);
    await expect(requireMembership("alice", c, "finance:write")).rejects.toThrow(/Finances/);
  });

  it("une entreprise existante avant l'activation (sans abonnement) garde l'accès complet", async () => {
    clearAccessCache();
    await rawSql`update platform_settings set billing_enabled = false`;
    const old = await company("bob", "Ancienne");
    await rawSql`update platform_settings set billing_enabled = true`;
    clearAccessCache();
    expect((await db.select().from(schema.subscription).where(eq(schema.subscription.companyId, old))).length).toBe(0);
    expect((await loadAccess(old, new Date())).state).toBe("unmanaged");
    await expect(requireMembership("bob", old, "accounting:write")).resolves.toBeDefined();
  });
});

describe("limites de l'offre", () => {
  let c: string;
  beforeAll(async () => {
    c = await company("carol", "Carol");
    await setNumbering("carol", c, "invoice", "FA-{NNNN}");
  });

  it("limite le nombre de membres (invitations comprises) à l'invitation et à l'acceptation", async () => {
    await createInvitation("carol", c, { email: "m1@t.dev", role: "viewer" });
    await createInvitation("carol", c, { email: "m2@t.dev", role: "viewer" }); // 1 membre + 2 invitations = 3 (limite)
    await expect(createInvitation("carol", c, { email: "m3@t.dev", role: "viewer" })).rejects.toBeInstanceOf(PlanRestrictionError);
    // l'acceptation d'une invitation existante reste possible dans la limite
    const { token } = await createInvitation("carol", c, { email: "m2@t.dev", role: "viewer" }); // remplace la précédente
    await mkUser("m2");
    await expect(acceptInvitation("m2", "m2@t.dev", token)).resolves.toBeDefined();
  });

  it("limite les factures émises par mois", async () => {
    const client = await createContact("carol", c, { name: "Client" });
    const issue = async (day: number) => {
      const d = await createDraft("carol", c, { type: "invoice", contactId: client.id, issueDate: `2026-03-${String(day).padStart(2, "0")}` });
      await addLine("carol", c, d.id, { description: "x", quantity: "1", unitPrice: "10" });
      return issueDocument("carol", c, d.id);
    };
    await issue(1);
    await issue(2);
    await expect(issue(3)).rejects.toBeInstanceOf(PlanRestrictionError);
    // un autre mois n'est pas concerné
    const d = await createDraft("carol", c, { type: "invoice", contactId: client.id, issueDate: "2026-04-01" });
    await addLine("carol", c, d.id, { description: "x", quantity: "1", unitPrice: "10" });
    await expect(issueDocument("carol", c, d.id)).resolves.toMatch(/^FA-/);
  });

  it("le module Finances n'étant pas dans l'offre, le stockage de justificatifs est inaccessible", async () => {
    await expect(createAccount("carol", c, { name: "B", kind: "bank", openingBalance: "0" })).rejects.toBeInstanceOf(PlanRestrictionError);
  });
});

describe("changement d'offre et paiement", () => {
  let c: string;
  beforeAll(async () => {
    c = await company("dave", "Dave");
  });

  it("une offre gratuite s'applique tout de suite ; un usage trop grand la refuse", async () => {
    await expect(requestPlan("noadmin", c, free.id)).rejects.toBeInstanceOf(ForbiddenError); // pas membre
    await mkUser("bigteam");
    const big = await company("bigteam", "Big");
    await db.insert(schema.membership).values([1, 2, 3].map((i) => ({ companyId: big, userId: "noadmin", role: "viewer" as const })).slice(0, 1));
    await db.insert(schema.user).values([1, 2].map((i) => ({ id: `big${i}`, name: `b${i}`, email: `big${i}@t.dev` })));
    await db.insert(schema.membership).values([1, 2].map((i) => ({ companyId: big, userId: `big${i}`, role: "viewer" as const })));
    await expect(requestPlan("bigteam", big, free.id)).rejects.toThrow(/trop petite.*4 membres \(maximum 2\)/);
    const r = await requestPlan("dave", c, free.id);
    expect(r.mode).toBe("immediate");
    expect((await loadAccess(c, new Date())).planName).toBe("GRATUIT");
  });

  it("une offre payante émet une facture ; l'accès ne change qu'au paiement", async () => {
    const r = await requestPlan("dave", c, pro.id);
    expect(r.mode).toBe("invoice");
    expect(r.invoice!.number).toMatch(/^GGT-\d{4}-\d{6}$/);
    expect(r.invoice!.amountMinor).toBe(5000);
    expect((await loadAccess(c, new Date())).planName).toBe("GRATUIT"); // pas d'accès gratuit à l'offre demandée
    await markInvoicePaid(r.invoice!.id, { method: "bank_transfer", reference: "VIR-1" });
    const a = await loadAccess(c, new Date());
    expect(a.state).toBe("active");
    expect(a.planName).toBe("PRO");
    expect(a.modules).toContain("accounting");
    expect(a.limits.members).toBeNull();
  });

  it("le paiement est idempotent ; une facture payée est définitive", async () => {
    const inv = (await db.select().from(schema.billingInvoice).where(eq(schema.billingInvoice.companyId, c)))[0]!;
    expect((await markInvoicePaid(inv.id, { method: "bank_transfer", reference: "VIR-2" })).already).toBe(true);
    const after = (await db.select().from(schema.billingInvoice).where(eq(schema.billingInvoice.id, inv.id)))[0]!;
    expect(after.paymentReference).toBe("VIR-1");
    expect(await dbError(db.update(schema.billingInvoice).set({ status: "open" }).where(eq(schema.billingInvoice.id, inv.id)))).toMatch(/définitive/);
    expect(await dbError(db.update(schema.billingInvoice).set({ amountMinor: 1 }).where(eq(schema.billingInvoice.id, inv.id)))).toMatch(/ne peut pas être modifiée/);
    expect(await dbError(db.delete(schema.billingInvoice).where(eq(schema.billingInvoice.id, inv.id)))).toMatch(/ne peut pas être supprimée/);
  });

  it("une offre non publique, archivée ou identique est refusée ; seul le propriétaire gère l'abonnement", async () => {
    await expect(requestPlan("dave", c, hidden.id)).rejects.toThrow(/pas disponible/);
    await expect(requestPlan("dave", c, pro.id)).rejects.toThrow(/déjà sur cette offre/);
    await db.insert(schema.membership).values({ companyId: c, userId: "noadmin", role: "admin" });
    await expect(requestPlan("noadmin", c, basic.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getBillingView("noadmin", c)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(cancelSubscription("noadmin", c)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("une rétrogradation démarre à la fin de la période payée, sans interrompre l'offre actuelle", async () => {
    const r = await requestPlan("dave", c, basic.id);
    const paid = (await db.select().from(schema.billingInvoice).where(eq(schema.billingInvoice.status, "paid"))).find((i) => i.companyId === c)!;
    expect(r.invoice!.periodStart.getTime()).toBe(paid.periodEnd.getTime());
    expect((await loadAccess(c, new Date())).planName).toBe("PRO"); // jusqu'à la fin de la période
    await markInvoicePaid(r.invoice!.id, { method: "mobile_money", reference: "MM-1" });
    expect((await loadAccess(c, new Date())).planName).toBe("PRO");
    expect((await loadAccess(c, new Date(paid.periodEnd.getTime() + DAY))).planName).toBe("BASIQUE"); // continuité sans trou
  });

  it("un passage à une offre plus chère démarre tout de suite", async () => {
    const c2 = await company("alice", "Upgrade");
    // pendant l'essai, la facture démarre à la fin de l'essai ; une période déjà réglée mais pas commencée ne se remplace pas
    const rt = await requestPlan("alice", c2, basic.id);
    const trialEnd = (await db.select().from(schema.subscription).where(eq(schema.subscription.companyId, c2)))[0]!.trialEndsAt!;
    expect(rt.invoice!.periodStart.getTime()).toBe(trialEnd.getTime());
    await markInvoicePaid(rt.invoice!.id, { method: "cash", reference: "ESP-0" });
    await expect(requestPlan("alice", c2, pro.id)).rejects.toThrow(/déjà réglée à partir du/);
    // essai terminé : la facture démarre tout de suite, puis une offre plus chère démarre immédiatement
    const c3 = await company("alice", "Upgrade2");
    await rawSql`update subscription set trial_ends_at = null where company_id = ${c3}`;
    clearAccessCache();
    const rb = await requestPlan("alice", c3, basic.id);
    await markInvoicePaid(rb.invoice!.id, { method: "cash", reference: "ESP-1" });
    const ru = await requestPlan("alice", c3, pro.id);
    expect(ru.invoice!.periodStart.getTime()).toBeLessThan(Date.now() + 1000); // immédiat, sans attendre la fin de la période payée
    await markInvoicePaid(ru.invoice!.id, { method: "cash", reference: "ESP-2" });
    expect((await loadAccess(c3, new Date())).planName).toBe("PRO");
  });

  it("résilier garde l'accès jusqu'à la fin de la période, puis lecture seule ; reprendre annule la résiliation", async () => {
    const c3 = await company("carol", "Résiliation");
    await rawSql`update subscription set trial_ends_at = null where company_id = ${c3}`; // essai terminé : la facture démarre tout de suite
    clearAccessCache();
    const r = await requestPlan("carol", c3, pro.id);
    await markInvoicePaid(r.invoice!.id, { method: "cash", reference: "ESP-2" });
    await cancelSubscription("carol", c3);
    expect((await loadAccess(c3, new Date())).warn).toBe("canceling");
    const end = r.invoice!.periodEnd;
    const after = await loadAccess(c3, new Date(end.getTime() + DAY));
    expect(after).toMatchObject({ state: "expired", readOnly: true }); // pas de délai de grâce après résiliation
    await resumeSubscription("carol", c3);
    expect((await loadAccess(c3, new Date(end.getTime() + DAY))).state).toBe("past_due");
  });
});

describe("lecture seule : les données restent consultables et exportables", () => {
  it("après expiration, les écritures sont refusées mais pas la lecture ni l'export", async () => {
    const c = await company("alice", "Expire");
    await requestPlan("alice", c, pro.id).then((r) => markInvoicePaid(r.invoice!.id, { method: "cash", reference: "E" }));
    await createContact("alice", c, { name: "Avant" });
    await createAccount("alice", c, { name: "Banque", kind: "bank", openingBalance: "0" });
    // période payée terminée depuis plus que le délai de grâce
    await shiftInvoices(c, 60);
    await rawSql`update subscription set trial_ends_at = null where company_id = ${c}`;
    clearAccessCache();
    expect((await loadAccess(c, new Date())).state).toBe("expired");
    await expect(createContact("alice", c, { name: "Après" })).rejects.toThrow(/lecture seule/);
    expect((await listContacts("alice", c)).map((x) => x.name)).toEqual(["Avant"]);
    await expect(buildExport("alice", c, "invoices", parsePeriod())).resolves.toBeDefined();
    expect((await listAccounts("alice", c)).length).toBe(1);
    await expect(requireMembership("alice", c, "company:manage")).resolves.toBeDefined(); // régulariser reste possible
    // régularisation : une nouvelle offre payée rétablit l'accès
    const r = await requestPlan("alice", c, pro.id);
    await markInvoicePaid(r.invoice!.id, { method: "cash", reference: "E2" });
    await expect(createContact("alice", c, { name: "Rétabli" })).resolves.toBeDefined();
  });
});

describe("tâche de renouvellement", () => {
  it("émet une seule facture par période, même exécutée deux fois ou en parallèle", async () => {
    const c = await company("bob", "Renouvellement");
    const r = await requestPlan("bob", c, pro.id);
    await markInvoicePaid(r.invoice!.id, { method: "cash", reference: "R1" });
    const end = r.invoice!.periodEnd;
    // loin de l'échéance : rien à émettre
    expect((await runBillingJob(new Date())).invoicesIssued).toBe(0);
    // dans la fenêtre de préavis : une facture, une seule (la tâche concerne aussi les autres entreprises de la base)
    const near = new Date(end.getTime() - 3 * DAY);
    await Promise.all([runBillingJob(near), runBillingJob(near), runBillingJob(near)]);
    await runBillingJob(near);
    const invs = (await db.select().from(schema.billingInvoice).where(eq(schema.billingInvoice.companyId, c))).filter((i) => i.status === "open");
    expect(invs).toHaveLength(1);
    expect(invs[0]!.periodStart.getTime()).toBe(end.getTime());
    expect(invs[0]!.amountMinor).toBe(5000);
    // payée avant l'échéance : continuité sans trou
    await markInvoicePaid(invs[0]!.id, { method: "bank_transfer", reference: "R2" });
    expect((await loadAccess(c, new Date(end.getTime() + DAY))).state).toBe("active");
    // numéros de facture consécutifs, sans trou
    const numbers = (await db.select().from(schema.billingInvoice)).map((i) => Number(i.number.split("-")[2])).sort((a, b) => a - b);
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });

  it("n'émet rien pour une entreprise qui résilie, et matérialise les statuts", async () => {
    const c = await company("carol", "Quitte");
    const r = await requestPlan("carol", c, pro.id);
    await markInvoicePaid(r.invoice!.id, { method: "cash", reference: "Q" });
    await cancelSubscription("carol", c);
    const before = (await db.select().from(schema.billingInvoice).where(eq(schema.billingInvoice.companyId, c))).length;
    await runBillingJob(new Date(r.invoice!.periodEnd.getTime() - 2 * DAY));
    expect((await db.select().from(schema.billingInvoice).where(eq(schema.billingInvoice.companyId, c))).length).toBe(before);
    await runBillingJob(new Date(r.invoice!.periodEnd.getTime() + 60 * DAY));
    expect((await db.select().from(schema.subscription).where(eq(schema.subscription.companyId, c)))[0]!.status).toBe("expired");
  });
});

describe("webhook de paiement", () => {
  const secret = "whsec_test_secret_0123456789";
  const body = (o: object) => JSON.stringify(o);
  let invoice: { id: string; number: string; amountMinor: number; currency: string; companyId: string };
  beforeAll(async () => {
    const c = await company("alice", "Webhook");
    await rawSql`update subscription set trial_ends_at = null where company_id = ${c}`;
    clearAccessCache();
    invoice = (await requestPlan("alice", c, pro.id)).invoice!;
  });

  it("vérifie la signature : valide, falsifiée, mauvais secret, corps modifié, trop ancienne, mal formée", () => {
    const raw = body({ a: 1 });
    const now = Date.now();
    expect(verifyWebhook(secret, raw, signWebhook(secret, raw), now)).toBe(true);
    expect(verifyWebhook(secret, raw, signWebhook("autre", raw), now)).toBe(false);
    expect(verifyWebhook(secret, raw + " ", signWebhook(secret, raw), now)).toBe(false);
    expect(verifyWebhook(secret, raw, signWebhook(secret, raw, Math.floor(now / 1000) - 3600), now)).toBe(false); // rejeu d'un vieux message
    expect(verifyWebhook(secret, raw, "t=abc,v1=zz", now)).toBe(false);
    expect(verifyWebhook(secret, raw, null, now)).toBe(false);
    expect(verifyWebhook("", raw, signWebhook("", raw), now)).toBe(false);
  });

  it("traite un paiement une seule fois, contrôle le montant et la devise, ignore les autres types", async () => {
    const ev = (id: string, over: object = {}) => ({ id, type: "invoice.paid", data: { invoiceNumber: invoice.number, amountMinor: invoice.amountMinor, currency: "EUR", reference: "PSP-1", ...over } });
    expect(await processWebhookEvent("psp", ev("evt_1", { amountMinor: 1 }))).toBe("mismatch");
    expect(await processWebhookEvent("psp", ev("evt_2", { currency: "USD" }))).toBe("mismatch");
    expect(await processWebhookEvent("psp", ev("evt_3", { invoiceNumber: "GGT-0000-000000" }))).toBe("unknown_invoice");
    expect(await processWebhookEvent("psp", { ...ev("evt_4"), type: "customer.created" })).toBe("ignored");
    expect(await processWebhookEvent("psp", { n: "x" })).toBe("invalid");
    expect((await db.select().from(schema.billingInvoice).where(eq(schema.billingInvoice.id, invoice.id)))[0]!.status).toBe("open");
    expect(await processWebhookEvent("psp", ev("evt_5"))).toBe("processed");
    expect(await processWebhookEvent("psp", ev("evt_5"))).toBe("duplicate"); // rejeu du même événement
    expect(await processWebhookEvent("psp", ev("evt_6"))).toBe("processed"); // autre événement, facture déjà payée : sans effet
    const inv = (await db.select().from(schema.billingInvoice).where(eq(schema.billingInvoice.id, invoice.id)))[0]!;
    expect(inv.status).toBe("paid");
    expect(inv.provider).toBe("psp");
    expect(inv.paymentReference).toBe("PSP-1");
    expect((await loadAccess(invoice.companyId, new Date())).state).toBe("active");
  });
});

describe("opérations de l'administration", () => {
  let c: string;
  beforeAll(async () => {
    c = await company("dave", "Support");
  });

  it("l'offre gracieuse, la prolongation d'essai et la suspension exigent un motif et sont tracées", async () => {
    await expect(grantComplimentary(admin, c, pro.id, 30, "ok")).rejects.toThrow(/motif/);
    await grantComplimentary(admin, c, pro.id, 30, "Geste commercial après incident");
    const a = await loadAccess(c, new Date());
    expect(a.planName).toBe("PRO");
    expect(a.until!.getTime() - Date.now()).toBeGreaterThan(29 * DAY);
    const inv = (await db.select().from(schema.billingInvoice).where(eq(schema.billingInvoice.companyId, c))).find((i) => i.paymentMethod === "complimentary")!;
    expect(inv.amountMinor).toBe(0);

    await expect(extendTrial(admin, c, 7, "x")).rejects.toThrow(/motif/);
    await extendTrial(admin, c, 7, "Migration en cours chez le client");
    await expect(setSuspended(admin, c, true, "")).rejects.toThrow(/motif/);
    await setSuspended(admin, c, true, "Impayé constaté, contact sans réponse");
    expect((await loadAccess(c, new Date())).state).toBe("suspended");
    await expect(createContact("dave", c, { name: "Bloqué" })).rejects.toThrow(/suspendu/);
    await setSuspended(admin, c, false, "Régularisation reçue");
    await expect(createContact("dave", c, { name: "Débloqué" })).resolves.toBeDefined();
    const log = await listPlatformAudit(admin);
    const actions = log.rows.map((r) => r.action);
    for (const a of ["subscription.complimentary", "subscription.trial_extended", "company.suspended", "company.unsuspended"]) expect(actions).toContain(a);
    expect(log.rows.find((r) => r.action === "company.suspended")!.actor).toBe("admin@t.dev");
  });

  it("le paiement manuel exige une référence ; l'annulation de facture est réservée à une facture ouverte", async () => {
    const r = await requestPlan("dave", c, basic.id).catch(() => null);
    const open = (await db.select().from(schema.billingInvoice).where(eq(schema.billingInvoice.companyId, c))).find((i) => i.status === "open");
    if (r && open) {
      await expect(adminMarkInvoicePaid(admin, open.id, { method: "bank_transfer", reference: "" })).rejects.toThrow(/Référence/);
      await adminMarkInvoicePaid(admin, open.id, { method: "bank_transfer", reference: "VIR-ADMIN-1", paidAt: "2026-06-01" });
      await expect(adminVoidInvoice(admin, open.id)).rejects.toThrow(/ouverte/);
    }
    await expect(adminMarkInvoicePaid("alice", "00000000-0000-0000-0000-000000000000", { method: "cash", reference: "xx" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("le journal d'audit de la plateforme est en ajout seul", async () => {
    expect(await dbError(db.update(schema.platformAuditLog).set({ action: "x" }))).toMatch(/ajout seul/);
    expect(await dbError(db.delete(schema.platformAuditLog))).toMatch(/ajout seul/);
  });

  it("la vue d'ensemble agrège sans exposer de données métier ; la liste est cherchable et paginée", async () => {
    const o = await adminOverview(admin);
    expect(o.companies).toBeGreaterThan(5);
    expect(o.mrr.find((m) => m.currency === "EUR")!.minor).toBeGreaterThan(0);
    expect(o.withoutSubscription).toBeGreaterThanOrEqual(1);
    const list = await listCompaniesAdmin(admin, { q: "support" });
    expect(list.rows.map((r) => r.name)).toEqual(["Support SARL"]);
    expect(Object.keys(list.rows[0]!).sort()).toEqual(["country", "createdAt", "id", "members", "name", "ownerEmail", "planName", "status", "suspendedAt"]);
    expect((await listCompaniesAdmin(admin, { q: "dave@" })).rows.length).toBeGreaterThan(0); // recherche par e-mail du propriétaire
    expect((await listCompaniesAdmin(admin, { q: "%" })).rows).toHaveLength(0); // les jokers sont échappés
    expect((await listCompaniesAdmin(admin, { status: "none" })).rows.length).toBe(o.withoutSubscription);
    const detail = await getCompanyAdmin(admin, c);
    expect(detail!.members.map((m) => m.role)).toContain("owner");
    expect(JSON.stringify(detail)).not.toMatch(/Bloqué|Débloqué|Avant|Après/); // aucune donnée métier (contacts…)
  });

  it("modifier le prix d'une offre ne change pas les factures déjà émises", async () => {
    const c2 = await company("bob", "Prix");
    const r = await requestPlan("bob", c2, pro.id);
    await updatePlan(admin, pro.id, planInput("pro", { price: "80", modules: [...ALL], members: "" }));
    expect((await db.select().from(schema.billingInvoice).where(eq(schema.billingInvoice.id, r.invoice!.id)))[0]!.amountMinor).toBe(5000);
    await updatePlan(admin, pro.id, planInput("pro", { price: "50", modules: [...ALL], members: "" }));
    await expect(updatePlan(admin, pro.id, planInput("pro", { price: "50", currency: "USD", modules: [...ALL] }))).rejects.toThrow(/devise/);
  });
});

describe("cloisonnement", () => {
  it("un propriétaire ne voit ni ne modifie l'abonnement d'une autre entreprise", async () => {
    const a = await company("alice", "A-iso");
    const b = await company("bob", "B-iso");
    await expect(getBillingView("alice", b)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(requestPlan("alice", b, pro.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(cancelSubscription("alice", b)).rejects.toBeInstanceOf(ForbiddenError);
    const view = await getBillingView("alice", a);
    expect(view.invoices.every((i) => i.inv.companyId === a)).toBe(true);
    expect(view.plans.every((p) => p.isPublic && !p.archivedAt)).toBe(true);
    expect(view.paymentInstructions).toMatch(/Virement/);
    void withTenant; void addAttachment; void createEntry;
  });
});
