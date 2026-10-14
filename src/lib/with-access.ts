import { notFound, redirect } from "next/navigation";
import { PlanRestrictionError } from "@/modules/core/entitlements";
import { ForbiddenError } from "@/modules/core/tenant";

/** Enveloppe une page : un refus d'accès (non-membre, rôle insuffisant) devient un 404 propre, jamais une erreur 500. */
export function withAccess<A extends unknown[], R>(page: (...args: A) => Promise<R>) {
  return async (...args: A): Promise<R> => {
    try {
      return await page(...args);
    } catch (e) {
      if (e instanceof PlanRestrictionError) redirect(`/app/${e.companyId}/billing?reason=${e.code}`);
      if (e instanceof ForbiddenError) notFound();
      throw e;
    }
  };
}
