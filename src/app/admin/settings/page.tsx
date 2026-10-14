import { Card, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/session";
import { assertPlatformAdmin, getPlatformSettings } from "@/modules/billing/platform";
import { SettingsForm } from "../forms";

export const metadata = { title: "Réglages" };

export default async function PlatformSettings() {
  const user = await requireUser();
  await assertPlatformAdmin(user.id);
  const s = await getPlatformSettings();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Réglages de la plateforme</h1>
      <Card><CardTitle>Facturation</CardTitle><SettingsForm billingEnabled={s.billingEnabled} paymentInstructions={s.paymentInstructions ?? ""} graceDays={s.graceDays} /></Card>
      <Card>
        <CardTitle>Paiements automatiques</CardTitle>
        <p className="text-sm text-muted">Les paiements se constatent aujourd&apos;hui à la main (virement, mobile money) depuis la fiche de l&apos;entreprise. Un prestataire de paiement pourra notifier les paiements par webhook signé : <code>POST /api/billing/webhook/&lt;prestataire&gt;</code>, secret dans la variable <code>BILLING_WEBHOOK_SECRET_&lt;PRESTATAIRE&gt;</code>.</p>
      </Card>
    </div>
  );
}
