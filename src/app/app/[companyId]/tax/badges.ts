import type { ObligationState } from "@/modules/tax/obligations";

export const STATE_BADGES: Record<ObligationState, ["neutral" | "accent" | "success" | "warning" | "danger", string]> = {
  todo: ["neutral", "À venir"],
  due_soon: ["warning", "Bientôt"],
  overdue: ["danger", "En retard"],
  filed: ["accent", "Déclarée"],
  paid: ["success", "Payée"],
  not_applicable: ["neutral", "Non applicable"],
};
