import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { markInvoicePaid } from "./invoices";

const TOLERANCE_SECONDS = 300;

/**
 * Signature de webhook générique (modèle courant chez les prestataires) : en-tête « t=<horodatage>,v1=<hex> » où
 * v1 = HMAC-SHA256(secret, "<t>.<corps brut>"). L'horodatage borné protège du rejeu ; la comparaison est à temps constant.
 * Le prestataire réel (à choisir) pourra imposer son propre schéma : seule cette fonction change.
 */
export function signWebhook(secret: string, rawBody: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex")}`;
}

export function verifyWebhook(secret: string, rawBody: string, header: string | null, nowMs = Date.now()): boolean {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2) as [string, string]));
  const t = Number(parts.t);
  const sig = parts.v1;
  if (!Number.isFinite(t) || !sig || !/^[0-9a-f]{64}$/.test(sig)) return false;
  if (Math.abs(nowMs / 1000 - t) > TOLERANCE_SECONDS) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  return timingSafeEqual(expected, Buffer.from(sig, "hex"));
}

const eventSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.string(),
  data: z.object({ invoiceNumber: z.string().min(1).max(60), amountMinor: z.number().int().min(0), currency: z.string().length(3), reference: z.string().max(200).optional(), method: z.string().max(60).optional() }),
});

export type WebhookResult = "processed" | "duplicate" | "ignored" | "mismatch" | "unknown_invoice" | "invalid";

/** Traite un événement vérifié : « invoice.paid » marque la facture payée, après contrôle du montant et de la devise. Idempotent par (prestataire, id d'événement). */
export async function processWebhookEvent(provider: string, payload: unknown): Promise<WebhookResult> {
  const parsed = eventSchema.safeParse(payload);
  if (!parsed.success) return "invalid";
  const ev = parsed.data;
  const inserted = await db.insert(schema.billingEvent).values({ provider, eventId: ev.id, payload: payload as object }).onConflictDoNothing().returning({ id: schema.billingEvent.id });
  if (!inserted.length) return "duplicate";
  if (ev.type !== "invoice.paid") return "ignored";
  const [inv] = await db.select().from(schema.billingInvoice).where(eq(schema.billingInvoice.number, ev.data.invoiceNumber));
  if (!inv) return "unknown_invoice";
  if (inv.amountMinor !== ev.data.amountMinor || inv.currency !== ev.data.currency.toUpperCase()) return "mismatch";
  await markInvoicePaid(inv.id, { method: ev.data.method ?? "online", reference: ev.data.reference ?? ev.id, provider });
  return "processed";
}
