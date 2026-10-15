import type { Instrumentation } from "next";

/** Toute erreur serveur non gérée est journalisée en JSON, avec son résumé Next.js (pas de corps de requête). */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const { log } = await import("@/lib/log");
  const e = err as Error & { digest?: string };
  log("error", "request.error", {
    message: e.message,
    digest: e.digest,
    stack: process.env.NODE_ENV === "production" ? undefined : e.stack,
    method: request.method,
    path: request.path.split("?")[0],
    routeType: context.routeType,
    routePath: context.routePath,
  });
};
