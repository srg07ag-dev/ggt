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
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const all = [...PERMISSIONS] as Permission[];

/** Matrice rôle → permissions. Toute vérification se fait côté serveur. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: all,
  admin: all.filter((p) => p !== "company:manage"),
  manager: ["crm:read", "crm:write", "sales:read", "sales:write", "finance:read"],
  member: ["crm:read", "crm:write", "sales:read"],
  accountant: ["crm:read", "sales:read", "finance:read", "finance:write", "audit:read"],
  viewer: ["crm:read", "sales:read", "finance:read"],
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
