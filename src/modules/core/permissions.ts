export const ROLES = ["owner", "admin", "manager", "member", "accountant", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "company:manage",
  "members:manage",
  "crm:read",
  "crm:write",
  "sales:read",
  "sales:write",
  "finance:read",
  "finance:write",
  "audit:read",
  "accounting:read",
  "accounting:write",
  "tax:read",
  "tax:write",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const all = [...PERMISSIONS] as Permission[];

/** Matrice rôle → permissions. Toute vérification se fait côté serveur. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: all,
  admin: all.filter((p) => p !== "company:manage"),
  manager: ["crm:read", "crm:write", "sales:read", "sales:write", "finance:read"],
  member: ["crm:read", "crm:write", "sales:read"],
  accountant: ["crm:read", "sales:read", "finance:read", "finance:write", "audit:read", "accounting:read", "accounting:write", "tax:read", "tax:write"],
  viewer: ["crm:read", "sales:read", "finance:read"],
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Rôles qu'un administrateur peut attribuer ou gérer ; seul un propriétaire gère les administrateurs et les propriétaires. */
export const ADMIN_MANAGEABLE: readonly Role[] = ["manager", "member", "accountant", "viewer"];

/** Rôles qu'on peut attribuer par invitation (jamais « propriétaire »). */
export const INVITABLE_ROLES: readonly Role[] = ["admin", "manager", "member", "accountant", "viewer"];

export function canAssignRole(actor: Role, role: Role): boolean {
  if (!can(actor, "members:manage")) return false;
  return actor === "owner" ? true : ADMIN_MANAGEABLE.includes(role);
}

/** Peut-on modifier ou retirer un membre ayant ce rôle ? */
export function canManageMember(actor: Role, target: Role): boolean {
  if (!can(actor, "members:manage")) return false;
  return actor === "owner" ? true : ADMIN_MANAGEABLE.includes(target);
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Propriétaire",
  admin: "Administrateur",
  manager: "Responsable",
  member: "Collaborateur",
  accountant: "Comptable",
  viewer: "Lecteur",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: "Contrôle total, y compris les paramètres de l'entreprise et la propriété.",
  admin: "Gère les membres (sauf propriétaires et administrateurs), le CRM, les ventes, les finances, la comptabilité et le suivi fiscal.",
  manager: "CRM et ventes en écriture, finances en lecture.",
  member: "CRM en écriture, ventes en lecture. Pas d'accès aux finances.",
  accountant: "Finances, comptabilité et suivi fiscal en écriture, CRM et ventes en lecture, journal d'audit.",
  viewer: "Consultation du CRM, des ventes et des finances.",
};
