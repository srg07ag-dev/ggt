import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";

import { MODULE_LABELS, MODULES, type Limits, type Module } from "./modules";
export { MODULE_LABELS, MODULES };
export type { Limits, Module };

/** Refus lié à l'abonnement (module absent de l'offre, lecture seule, limite atteinte). Distinct d'un refus de droits. */
export class PlanRestrictionError extends Error {
  constructor(
    public code: "module" | "readonly" | "limit",
    message: string,
    public companyId: string,
  ) {
    super(message);
    this.name = "PlanRestrictionError";
  }
}

export type AccessState = "unmanaged" | "trialing" | "active" | "past_due" | "expired" | "suspended";

export interface Access {
  state: AccessState;
  /** Écritures refusées (abonnement expiré ou suspendu) ; la lecture et l'export restent possibles. */
  readOnly: boolean;
  modules: Module[];
  limits: Limits;
  planId: string | null;
  planName: string | null;
  /** Fin de l'essai, de la période payée ou du délai de grâce, selon l'état. */
  until: Date | null;
  /** Information à afficher à l'utilisateur. */
  warn: "trial_ending" | "grace" | "canceling" | null;
  cancelAtPeriodEnd: boolean;
}

type PlanRow = typeof schema.plan.$inferSelect;
type SubRow = typeof schema.subscription.$inferSelect;
interface PaidInvoice {
  planId: string;
  periodStart: Date;
  periodEnd: Date;
}

const DAY = 86_400_000;
const planModules = (p: PlanRow): Module[] => p.modules.filter((m): m is Module => (MODULES as readonly string[]).includes(m));

const UNMANAGED: Access = { state: "unmanaged", readOnly: false, modules: [...MODULES], limits: {}, planId: null, planName: null, until: null, warn: null, cancelAtPeriodEnd: false };

/**
 * Accès effectif d'une entreprise à `now`. Fonction pure : elle ne dépend que des données, jamais d'une tâche planifiée.
 *  - facturation inactive, ou entreprise sans abonnement (existante avant l'activation) → accès complet (« unmanaged ») ;
 *  - suspendue → lecture seule ;
 *  - offre gratuite → toujours active ;
 *  - sinon : facture payée couvrant `now` → active ; essai en cours → trialing ;
 *    période payée terminée depuis moins de `graceDays` (sans annulation) → past_due, accès conservé ; au-delà → expired (lecture seule).
 */
export function computeAccess(i: { billingEnabled: boolean; sub: SubRow | null; plans: Map<string, PlanRow>; paid: PaidInvoice[]; graceDays: number; now: Date }): Access {
  const { sub, plans, paid, now } = i;
  if (!i.billingEnabled || !sub) return UNMANAGED;
  const current = plans.get(sub.planId);
  const view = (plan: PlanRow | undefined, state: AccessState, readOnly: boolean, until: Date | null, warn: Access["warn"]): Access => ({
    state, readOnly, modules: plan ? planModules(plan) : [], limits: (plan?.limits ?? {}) as Limits, planId: plan?.id ?? null, planName: plan?.name ?? null, until, warn, cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
  });

  if (sub.suspendedAt) return view(current, "suspended", true, null, null);
  if (current && current.priceMinor === 0) return view(current, "active", false, null, null);

  // facture payée couvrant maintenant : la plus récemment commencée l'emporte (un changement d'offre « immédiat » prend le relais)
  const covering = paid.filter((p) => p.periodStart <= now && now < p.periodEnd).sort((a, b) => b.periodStart.getTime() - a.periodStart.getTime())[0];
  if (covering) {
    const plan = plans.get(covering.planId);
    // si une période suivante est déjà payée (ou en cours de renouvellement), l'annulation ne s'applique pas encore
    const renewed = paid.some((p) => p.periodStart.getTime() <= covering.periodEnd.getTime() && p.periodEnd > covering.periodEnd);
    return view(plan, "active", false, covering.periodEnd, sub.cancelAtPeriodEnd && !renewed ? "canceling" : null);
  }
  if (sub.trialEndsAt && now < sub.trialEndsAt) {
    const left = (sub.trialEndsAt.getTime() - now.getTime()) / DAY;
    return view(current, "trialing", false, sub.trialEndsAt, left <= 7 ? "trial_ending" : null);
  }
  // période payée terminée : délai de grâce, sauf si l'abonnement a été annulé
  const last = [...paid].sort((a, b) => b.periodEnd.getTime() - a.periodEnd.getTime())[0];
  if (last && !sub.cancelAtPeriodEnd) {
    const graceEnd = new Date(last.periodEnd.getTime() + i.graceDays * DAY);
    if (now >= last.periodEnd && now < graceEnd) return view(plans.get(last.planId), "past_due", false, graceEnd, "grace");
  }
  return view(current, "expired", true, null, null);
}

const CACHE_MS = 3000;
const cache = new Map<string, { at: number; access: Access }>();
/** À appeler après toute modification d'abonnement, d'offre ou de réglage de facturation (le cache est local au processus). */
export function clearAccessCache(companyId?: string) {
  if (companyId) cache.delete(companyId);
  else cache.clear();
}

/**
 * Charge les données et calcule l'accès d'une entreprise. Un cache de 3 s évite de relire l'abonnement à chaque vérification de droit ;
 * sur plusieurs instances, un changement d'offre est donc effectif en quelques secondes au plus.
 */
export async function loadAccess(companyId: string, now?: Date): Promise<Access> {
  if (!now) {
    const hit = cache.get(companyId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.access;
  }
  const access = await computeFromDb(companyId, now ?? new Date());
  if (!now) cache.set(companyId, { at: Date.now(), access });
  return access;
}

async function computeFromDb(companyId: string, now: Date): Promise<Access> {
  const [settings] = await db.select().from(schema.platformSettings).where(eq(schema.platformSettings.id, 1));
  if (!settings?.billingEnabled) return UNMANAGED;
  const [sub] = await db.select().from(schema.subscription).where(eq(schema.subscription.companyId, companyId));
  if (!sub) return UNMANAGED;
  const paidRows = await db
    .select({ planId: schema.billingInvoice.planId, periodStart: schema.billingInvoice.periodStart, periodEnd: schema.billingInvoice.periodEnd })
    .from(schema.billingInvoice)
    .where(and(eq(schema.billingInvoice.companyId, companyId), eq(schema.billingInvoice.status, "paid")))
    .orderBy(asc(schema.billingInvoice.periodStart));
  const planIds = [...new Set([sub.planId, ...paidRows.map((p) => p.planId)])];
  const planRows = await db.select().from(schema.plan).where(inArray(schema.plan.id, planIds));
  return computeAccess({ billingEnabled: true, sub, plans: new Map(planRows.map((p) => [p.id, p])), paid: paidRows, graceDays: settings.graceDays, now });
}

/* ---------- Application ---------- */

const PERMISSION_MODULE: Record<string, Module> = { crm: "crm", sales: "sales", finance: "finance", accounting: "accounting", tax: "tax" };

/** Contrôle une permission au regard de l'abonnement : module inclus, et pas d'écriture en lecture seule. */
export function checkPermissionAgainstPlan(access: Access, permission: string, companyId: string): void {
  if (access.state === "unmanaged") return;
  const [area, action] = permission.split(":");
  const mod = PERMISSION_MODULE[area!];
  if (mod && !access.modules.includes(mod)) {
    throw new PlanRestrictionError("module", `Le module « ${MODULE_LABELS[mod]} » n'est pas inclus dans votre abonnement.`, companyId);
  }
  // la gestion de l'entreprise et de l'abonnement reste possible : il faut pouvoir régulariser
  const writes = action === "write" || permission === "members:manage";
  if (access.readOnly && writes) {
    const why = access.state === "suspended" ? "Votre compte est suspendu" : "Votre abonnement a expiré";
    throw new PlanRestrictionError("readonly", `${why} : l'entreprise est en lecture seule. Vos données restent consultables et exportables.`, companyId);
  }
}

/* ---------- Limites ---------- */

const MB = 1024 * 1024;

export async function usageOf(companyId: string, now = new Date(), excludeEmail?: string) {
  const [members] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.membership).where(eq(schema.membership.companyId, companyId));
  const [pending] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.invitation)
    .where(and(eq(schema.invitation.companyId, companyId), isNull(schema.invitation.acceptedAt), isNull(schema.invitation.revokedAt), gt(schema.invitation.expiresAt, now), excludeEmail ? sql`${schema.invitation.email} <> ${excludeEmail}` : undefined));
  return { members: members?.n ?? 0, pendingInvitations: pending?.n ?? 0 };
}

const limitError = (what: string, limit: number, companyId: string) =>
  new PlanRestrictionError("limit", `Limite de votre offre atteinte : ${what} (${limit} maximum). Passez à une offre supérieure dans Abonnement.`, companyId);

/** Membres + invitations en attente ne doivent pas dépasser la limite. */
export async function assertCanAddMember(companyId: string, opts: { counting?: "invite" | "accept"; email?: string } = {}) {
  const access = await loadAccess(companyId);
  const max = access.limits.members;
  if (access.state === "unmanaged" || max == null) return;
  // une nouvelle invitation pour une adresse déjà invitée remplace l'ancienne : elle ne compte pas deux fois
  const u = await usageOf(companyId, new Date(), opts.email);
  // à l'acceptation, l'invitation acceptée est déjà comptée dans « en attente »
  const used = opts.counting === "accept" ? u.members : u.members + u.pendingInvitations;
  if (used >= max) throw limitError("nombre de membres", max, companyId);
}

/** Dans une transaction d'entreprise : factures émises ce mois-ci (UTC) < limite. */
export async function assertCanIssueInvoice(tx: { execute: typeof db.execute }, companyId: string, issueDate: string) {
  const access = await loadAccess(companyId);
  const max = access.limits.invoicesPerMonth;
  if (access.state === "unmanaged" || max == null) return;
  const month = issueDate.slice(0, 7);
  const rows = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from sales_document where type = 'invoice' and status = 'issued' and to_char(issue_date, 'YYYY-MM') = ${month}`)) as unknown as { n: number }[];
  if ((rows[0]?.n ?? 0) >= max) throw limitError(`factures émises en ${month}`, max, companyId);
}

export async function assertStorage(tx: { execute: typeof db.execute }, companyId: string, addBytes: number) {
  const access = await loadAccess(companyId);
  const max = access.limits.storageMb;
  if (access.state === "unmanaged" || max == null) return;
  const rows = (await tx.execute<{ total: number }>(sql`select coalesce(sum(size_bytes), 0)::float8 as total from attachment`)) as unknown as { total: number }[];
  if (Number(rows[0]?.total ?? 0) + addBytes > max * MB) throw limitError("espace de stockage des justificatifs", max, companyId);
}
