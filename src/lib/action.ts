import { ZodError } from "zod";
import { ForbiddenError } from "@/modules/core/tenant";
import { BusinessRuleError } from "@/modules/sales/documents";
import { NumberingNotConfiguredError } from "@/modules/sales/numbering";

export type ActionState = { error?: string; ok?: boolean } | undefined;

/** Convertit les erreurs métier attendues en message affichable ; relance le reste. */
export async function runAction(fn: () => Promise<void>): Promise<ActionState> {
  try {
    await fn();
    return { ok: true };
  } catch (e) {
    if (e instanceof ZodError) return { error: e.issues[0]?.message ?? "Données invalides." };
    if (e instanceof BusinessRuleError || e instanceof NumberingNotConfiguredError) return { error: e.message };
    if (e instanceof ForbiddenError) return { error: "Vous n'avez pas le droit d'effectuer cette action." };
    // violation de clé étrangère composite : lien vers une autre entreprise ou une donnée inexistante
    if (typeof e === "object" && e && "cause" in e && (e as { cause?: { code?: string } }).cause?.code === "23503")
      return { error: "Élément lié introuvable." };
    throw e;
  }
}
