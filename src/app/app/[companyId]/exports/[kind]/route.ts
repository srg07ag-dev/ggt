import { getSession } from "@/lib/session";
import { ForbiddenError } from "@/modules/core/tenant";
import { buildExport, EXPORT_KINDS, parsePeriod, type ExportKind } from "@/modules/finance/reports";

export async function GET(req: Request, { params }: { params: Promise<{ companyId: string; kind: string }> }) {
  const { companyId, kind } = await params;
  const session = await getSession();
  if (!session) return new Response("Non authentifié", { status: 401 });
  if (!(EXPORT_KINDS as readonly string[]).includes(kind)) return new Response("Introuvable", { status: 404 });
  const url = new URL(req.url);
  try {
    const out = await buildExport(session.user.id, companyId, kind as ExportKind, parsePeriod(url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined));
    return new Response(out.csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${out.filename}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return new Response("Introuvable", { status: 404 });
    throw e;
  }
}
