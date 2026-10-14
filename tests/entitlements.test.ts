import { describe, expect, it } from "vitest";
import { checkPermissionAgainstPlan, computeAccess, PlanRestrictionError, type Access } from "@/modules/core/entitlements";
import { addInterval } from "@/modules/billing/platform";

const D = (s: string) => new Date(`${s}T00:00:00Z`);
const plan = (id: string, o: Partial<{ price: number; modules: string[]; limits: object }> = {}) =>
  ({ id, code: id, name: id.toUpperCase(), description: null, currency: "EUR", priceMinor: o.price ?? 1000, interval: "month", trialDays: 0, limits: o.limits ?? {}, modules: o.modules ?? ["crm", "sales"], isPublic: true, isDefault: false, archivedAt: null, createdAt: new Date() }) as never;
const sub = (o: Partial<{ planId: string; trialEndsAt: Date | null; cancel: boolean; suspended: boolean }> = {}) =>
  ({ companyId: "c", planId: o.planId ?? "basic", status: "active", trialEndsAt: o.trialEndsAt ?? null, currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: o.cancel ?? false, suspendedAt: o.suspended ? new Date() : null, suspendedReason: null, createdAt: new Date(), updatedAt: new Date() }) as never;
const inv = (planId: string, start: string, end: string) => ({ planId, periodStart: D(start), periodEnd: D(end) });
const plans = new Map([["basic", plan("basic")], ["pro", plan("pro", { price: 5000, modules: ["crm", "sales", "finance", "accounting"], limits: { members: 10 } })], ["free", plan("free", { price: 0, modules: ["crm"] })]]);
const access = (o: Partial<{ billingEnabled: boolean; sub: unknown; paid: ReturnType<typeof inv>[]; now: string; grace: number }>): Access =>
  computeAccess({ billingEnabled: o.billingEnabled ?? true, sub: ("sub" in o ? o.sub : sub()) as never, plans, paid: o.paid ?? [], graceDays: o.grace ?? 7, now: D(o.now ?? "2026-06-15") });

describe("calcul de l'accès", () => {
  it("facturation inactive ou entreprise sans abonnement : accès complet, non géré", () => {
    expect(access({ billingEnabled: false }).state).toBe("unmanaged");
    expect(access({ sub: null }).state).toBe("unmanaged");
    expect(access({ sub: null }).readOnly).toBe(false);
  });

  it("essai : actif, signale la fin proche, puis expire en lecture seule", () => {
    const s = sub({ trialEndsAt: D("2026-06-30") });
    expect(access({ sub: s, now: "2026-06-15" })).toMatchObject({ state: "trialing", readOnly: false, warn: null });
    expect(access({ sub: s, now: "2026-06-25" })).toMatchObject({ state: "trialing", warn: "trial_ending" });
    expect(access({ sub: s, now: "2026-06-30" })).toMatchObject({ state: "expired", readOnly: true });
  });

  it("période payée : active avec les modules de l'offre facturée", () => {
    const a = access({ paid: [inv("pro", "2026-06-01", "2026-07-01")] });
    expect(a).toMatchObject({ state: "active", readOnly: false, planName: "PRO" });
    expect(a.modules).toContain("accounting");
    expect(a.limits).toEqual({ members: 10 });
  });

  it("après la fin de période : délai de grâce avec accès, puis lecture seule", () => {
    const paid = [inv("basic", "2026-05-01", "2026-06-01")];
    expect(access({ paid, now: "2026-06-05" })).toMatchObject({ state: "past_due", readOnly: false, warn: "grace" });
    expect(access({ paid, now: "2026-06-08" })).toMatchObject({ state: "expired", readOnly: true });
    expect(access({ paid, now: "2026-06-08", grace: 30 }).state).toBe("past_due");
  });

  it("une résiliation supprime le délai de grâce et signale la fin à venir", () => {
    const s = sub({ cancel: true });
    expect(access({ sub: s, paid: [inv("basic", "2026-06-01", "2026-07-01")] })).toMatchObject({ state: "active", warn: "canceling" });
    expect(access({ sub: s, paid: [inv("basic", "2026-05-01", "2026-06-01")], now: "2026-06-02" })).toMatchObject({ state: "expired", readOnly: true });
  });

  it("un renouvellement déjà payé annule l'avertissement de résiliation à venir tant qu'il couvre la suite", () => {
    const paid = [inv("basic", "2026-06-01", "2026-07-01"), inv("basic", "2026-07-01", "2026-08-01")];
    expect(access({ sub: sub({ cancel: false }), paid }).warn).toBeNull();
  });

  it("suspendue : lecture seule, quelle que soit la période payée", () => {
    expect(access({ sub: sub({ suspended: true }), paid: [inv("pro", "2026-06-01", "2026-07-01")] })).toMatchObject({ state: "suspended", readOnly: true });
  });

  it("une offre gratuite est toujours active", () => {
    expect(access({ sub: sub({ planId: "free" }), now: "2030-01-01" })).toMatchObject({ state: "active", readOnly: false, modules: ["crm"] });
  });

  it("un changement d'offre démarré plus récemment prend le relais des périodes payées qui se chevauchent", () => {
    const paid = [inv("basic", "2026-06-01", "2026-07-01"), inv("pro", "2026-06-10", "2026-07-10")];
    expect(access({ paid }).planName).toBe("PRO");
    expect(access({ paid, now: "2026-06-05" }).planName).toBe("BASIC");
  });

  it("sans période ni essai : expirée", () => {
    expect(access({}).state).toBe("expired");
  });
});

describe("application des droits au regard de l'abonnement", () => {
  const a = (o: Partial<Access>): Access => ({ state: "active", readOnly: false, modules: ["crm"], limits: {}, planId: "x", planName: "X", until: null, warn: null, cancelAtPeriodEnd: false, ...o });
  it("refuse un module absent de l'offre, en lecture comme en écriture", () => {
    expect(() => checkPermissionAgainstPlan(a({}), "accounting:read", "c")).toThrow(PlanRestrictionError);
    expect(() => checkPermissionAgainstPlan(a({}), "finance:write", "c")).toThrow(/Finances/);
    expect(() => checkPermissionAgainstPlan(a({}), "crm:write", "c")).not.toThrow();
  });
  it("en lecture seule : lecture et export permis, écritures et invitations refusées, gestion de l'entreprise permise", () => {
    const ro = a({ state: "expired", readOnly: true, modules: ["crm", "sales", "finance"] });
    expect(() => checkPermissionAgainstPlan(ro, "crm:read", "c")).not.toThrow();
    expect(() => checkPermissionAgainstPlan(ro, "finance:read", "c")).not.toThrow();
    expect(() => checkPermissionAgainstPlan(ro, "crm:write", "c")).toThrow(/lecture seule/);
    expect(() => checkPermissionAgainstPlan(ro, "members:manage", "c")).toThrow(/lecture seule/);
    expect(() => checkPermissionAgainstPlan(ro, "company:manage", "c")).not.toThrow(); // il faut pouvoir régulariser
    expect(() => checkPermissionAgainstPlan(ro, "audit:read", "c")).not.toThrow();
  });
  it("ne contraint rien quand la facturation est inactive", () => {
    expect(() => checkPermissionAgainstPlan(a({ state: "unmanaged", modules: [] }), "accounting:write", "c")).not.toThrow();
  });
});

describe("périodicité", () => {
  it("ajoute un mois ou un an en conservant le jour quand c'est possible", () => {
    expect(addInterval(D("2026-01-15"), "month").toISOString().slice(0, 10)).toBe("2026-02-15");
    expect(addInterval(D("2026-01-31"), "month").toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(addInterval(D("2028-01-31"), "month").toISOString().slice(0, 10)).toBe("2028-02-29");
    expect(addInterval(D("2026-12-31"), "month").toISOString().slice(0, 10)).toBe("2027-01-31");
    expect(addInterval(D("2028-02-29"), "year").toISOString().slice(0, 10)).toBe("2029-02-28");
  });
});
