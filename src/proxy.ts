import { NextResponse, type NextRequest } from "next/server";

/**
 * En-têtes de sécurité et CSP avec nonce, calculés à chaque requête.
 * Next.js applique automatiquement le nonce à ses propres scripts lorsque l'en-tête CSP de la requête le contient.
 */
export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV !== "production";
  const https = (process.env.BETTER_AUTH_URL ?? "").startsWith("https://");

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'", // styles en ligne générés par Next ; aucun script en ligne n'est toléré
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  const headers = new Headers(request.headers);
  const requestId = request.headers.get("x-request-id")?.match(/^[\w-]{8,64}$/)?.[0] ?? crypto.randomUUID();
  headers.set("x-nonce", nonce);
  headers.set("x-request-id", requestId);
  headers.set("content-security-policy", csp);

  const res = NextResponse.next({ request: { headers } });
  res.headers.set("content-security-policy", csp);
  res.headers.set("x-request-id", requestId);
  res.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.headers.set("cross-origin-opener-policy", "same-origin");
  res.headers.set("x-content-type-options", "nosniff");
  res.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  if (https) res.headers.set("strict-transport-security", "max-age=63072000; includeSubDomains");
  return res;
}

export const config = {
  matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico).*)", missing: [{ type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }] }],
};
