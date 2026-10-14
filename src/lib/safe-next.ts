/** Redirection post-connexion : uniquement un chemin interne, jamais une URL externe ni « // ». */
export function safeNext(next: string | undefined | null, fallback = "/app"): string {
  if (!next || !/^\/(?![\\/])[A-Za-z0-9\-._~/%]*$/.test(next)) return fallback;
  return next;
}
