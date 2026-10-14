import { verifyWebhook, processWebhookEvent } from "@/modules/billing/webhook";

export const dynamic = "force-dynamic";

const STATUS = { processed: 200, duplicate: 200, ignored: 200, mismatch: 422, unknown_invoice: 404, invalid: 400 } as const;

/** Réception des paiements d'un prestataire. Le secret est propre à chaque prestataire : BILLING_WEBHOOK_SECRET_<NOM>. */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!/^[a-z0-9_-]{2,30}$/.test(provider)) return new Response("Introuvable", { status: 404 });
  const secret = process.env[`BILLING_WEBHOOK_SECRET_${provider.toUpperCase().replace(/-/g, "_")}`];
  if (!secret) return new Response("Introuvable", { status: 404 }); // prestataire non configuré
  const raw = await req.text();
  if (raw.length > 100_000) return new Response("Trop volumineux", { status: 413 });
  if (!verifyWebhook(secret, raw, req.headers.get("x-signature"))) return new Response("Signature invalide", { status: 401 });
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return new Response("JSON invalide", { status: 400 });
  }
  const result = await processWebhookEvent(provider, json);
  return Response.json({ result }, { status: STATUS[result] });
}
