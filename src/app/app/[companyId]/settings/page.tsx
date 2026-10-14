import { Card, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/session";
import { can } from "@/modules/core/permissions";
import { getCompanyProfile, getNumbering } from "@/modules/core/settings";
import { requireMembership } from "@/modules/core/tenant";
import { SUGGESTED_PATTERNS } from "@/modules/sales/numbering";
import { NumberingForm, ProfileForm } from "./forms";
import { withAccess } from "@/lib/with-access";

export const metadata = { title: "Paramètres" };

async function Settings({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const user = await requireUser();
  const ctx = await requireMembership(user.id, companyId, "sales:read");
  const [profile, numbering] = await Promise.all([getCompanyProfile(user.id, companyId), getNumbering(user.id, companyId)]);
  const manage = can(ctx.role, "company:manage");
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Paramètres</h1>
      <Card>
        <CardTitle hint={`Pays : ${profile.country} · Devise : ${profile.currency}`}>Entreprise</CardTitle>
        {manage ? <ProfileForm companyId={companyId} profile={profile} /> : <p className="text-sm text-muted">Seul le propriétaire peut modifier ces informations.</p>}
      </Card>
      <Card>
        <CardTitle hint="Le motif s'applique aux prochains documents. Les numéros déjà attribués ne changent jamais.">Numérotation</CardTitle>
        {manage ? (
          <NumberingForm companyId={companyId} current={numbering} suggestions={SUGGESTED_PATTERNS} />
        ) : (
          <ul className="text-sm text-muted">{Object.entries(numbering).map(([k, v]) => <li key={k}>{k} : {v}</li>)}</ul>
        )}
      </Card>
    </div>
  );
}

export default withAccess(Settings);
