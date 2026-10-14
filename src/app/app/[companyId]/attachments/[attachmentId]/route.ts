import { getSession } from "@/lib/session";
import { ForbiddenError } from "@/modules/core/tenant";
import { readAttachment } from "@/modules/finance/finance";

/** Téléchargement protégé : session + appartenance à l'entreprise, jamais d'URL publique. */
export async function GET(_: Request, { params }: { params: Promise<{ companyId: string; attachmentId: string }> }) {
  const { companyId, attachmentId } = await params;
  const session = await getSession();
  if (!session) return new Response("Non authentifié", { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(attachmentId)) return new Response("Introuvable", { status: 404 });
  try {
    const file = await readAttachment(session.user.id, companyId, attachmentId);
    if (!file) return new Response("Introuvable", { status: 404 });
    return new Response(new Uint8Array(file.data), {
      headers: {
        "content-type": file.row.contentType,
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.row.filename)}`,
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return new Response("Introuvable", { status: 404 });
    throw e;
  }
}
