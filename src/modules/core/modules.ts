/** Modules commercialisables et libellés : module pur, importable côté client. */
export const MODULES = ["crm", "sales", "finance", "accounting", "tax"] as const;
export type Module = (typeof MODULES)[number];
export const MODULE_LABELS: Record<Module, string> = { crm: "CRM", sales: "Ventes", finance: "Finances", accounting: "Comptabilité", tax: "Fiscalité" };

export interface Limits {
  members?: number | null;
  invoicesPerMonth?: number | null;
  storageMb?: number | null;
}
