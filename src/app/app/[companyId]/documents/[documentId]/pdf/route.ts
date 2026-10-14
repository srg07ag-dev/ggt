import { RateLimitError } from "@/lib/rate-limit";
import { ForbiddenError } from "@/modules/core/tenant";
import { getSession } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import { getDocument } from "@/modules/sales/documents";
import { renderDocumentPdf } from "@/modules/sales/pdf";

export async function GET(_: Request, { params }: { params: Promise<{ companyId: string; documentId: string }> }) {
  const { companyId, documentId } = await params;
  const session = await getSession();
  if (!session) return new Response("Non authentifié", { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) return new Response("Introuvable", { status: 404 });
  try {
    await rateLimit(`pdf:${session.user.id}`, 120, 60);
    const d = await getDocument(session.user.id, companyId, documentId);
    if (!d) return new Response("Introuvable", { status: 404 });
    const pdf = await renderDocumentPdf(d);
    const name = (d.doc.number ?? "brouillon").replace(/[^A-Za-z0-9_-]/g, "_");
    return new Response(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${name}.pdf"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return new Response("Introuvable", { status: 404 });
    if (e instanceof RateLimitError) return new Response(e.message, { status: 429, headers: { "retry-after": String(e.retryAfterSeconds) } });
    throw e;
  }
}
