import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { Card, CardTitle } from "@/components/ui/card";
import { db, schema } from "@/db/client";
import { requireUser } from "@/lib/session";
import { assertPlatformAdmin } from "@/modules/billing/platform";
import type { Limits } from "@/modules/core/entitlements";
import { PlanForm } from "../../forms";

export const metadata = { title: "Modifier une offre" };

export default async function EditPlan({ params }: { params: Promise<{ planId: string }> }) {
  const { planId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(planId)) notFound();
  const user = await requireUser();
  await assertPlatformAdmin(user.id);
  const [p] = await db.select().from(schema.plan).where(eq(schema.plan.id, planId));
  if (!p) notFound();
  const l = p.limits as Limits;
  const exp = p.currency === "XOF" ? 0 : 2;
  return (
    <div className="space-y-6">
      <div><Link href="/admin/plans" className="text-sm text-muted hover:text-accent">← Offres</Link><h1 className="mt-2 text-2xl font-semibold tracking-tight">{p.name}</h1></div>
      <Card>
        <CardTitle hint="La devise et la périodicité ne changent plus dès qu'il y a des abonnés.">Modifier l&apos;offre</CardTitle>
        <PlanForm planId={p.id} defaults={{ code: p.code, name: p.name, description: p.description ?? "", currency: p.currency, price: (p.priceMinor / 10 ** exp).toFixed(exp).replace(".", ","), interval: p.interval, trialDays: p.trialDays, members: l.members == null ? "" : String(l.members), invoicesPerMonth: l.invoicesPerMonth == null ? "" : String(l.invoicesPerMonth), storageMb: l.storageMb == null ? "" : String(l.storageMb), modules: p.modules, isPublic: p.isPublic, isDefault: p.isDefault }} />
      </Card>
    </div>
  );
}
