import { getSession } from "@/lib/session";
import { PlanRestrictionError } from "@/modules/core/entitlements";
import { RateLimitError } from "@/lib/rate-limit";
import { ForbiddenError } from "@/modules/core/tenant";
import { exportLedgerCsv } from "@/modules/accounting/reports";
import { buildExport, EXPORT_KINDS, parsePeriod, type ExportKind } from "@/modules/finance/reports";

export async function GET(req: Request, { params }: { params: Promise<{ companyId: string; kind: string }> }) {
  const { companyId, kind } = await params;
  const session = await getSession();
  if (!session) return new Response("Non authentifié", { status: 401 });
  if (kind !== "ledger" && !(EXPORT_KINDS as readonly string[]).includes(kind)) return new Response("Introuvable", { status: 404 });
  const url = new URL(req.url);
  try {
    const out = kind === "ledger"
      ? await exportLedgerCsv(session.user.id, companyId, { from: url.searchParams.get("from") ?? undefined, to: url.searchParams.get("to") ?? undefined })
      : await buildExport(session.user.id, companyId, kind as ExportKind, parsePeriod(url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined));
    return new Response(out.csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${out.filename}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return new Response("Introuvable", { status: 404 });
    if (e instanceof PlanRestrictionError) return new Response(e.message, { status: 403 });
    if (e instanceof RateLimitError) return new Response(e.message, { status: 429, headers: { "retry-after": String(e.retryAfterSeconds) } });
    throw e;
  }
}
