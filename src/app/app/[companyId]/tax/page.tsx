import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUser } from "@/lib/session";
import { todayIn } from "@/lib/dates";
import { withAccess } from "@/lib/with-access";
import { can } from "@/modules/core/permissions";
import { getCompanyProfile } from "@/modules/core/settings";
import { requireMembership } from "@/modules/core/tenant";
import { getTaxProfile, listObligations } from "@/modules/tax/obligations";
import { estimateTax, listValidatedRulesets } from "@/modules/tax/rules";
import { STATE_BADGES } from "./badges";
import { ObligationForm, ProfileForm } from "./forms";

export const metadata = { title: "Fiscalité" };

async function Tax({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const user = await requireUser();
  const ctx = await requireMembership(user.id, companyId, "tax:read");
  const company = await getCompanyProfile(user.id, companyId);
  const [{ profile }, obligations, rulesets, estimate] = await Promise.all([
    getTaxProfile(user.id, companyId),
    listObligations(user.id, companyId),
    listValidatedRulesets(company.country),
    estimateTax(company.country, todayIn(company.timezone)),
  ]);
  const canWrite = can(ctx.role, "tax:write");
  const open = obligations.filter((o) => o.status === "todo");
  const done = obligations.filter((o) => o.status !== "todo");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Fiscalité</h1>
        <p className="text-sm text-muted">Pays : <strong className="text-text">{company.country}</strong> · Devise : {company.currency}</p>
      </div>

      <Card className="border-warning">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
          <div className="space-y-1 text-sm">
            <p className="font-medium">{rulesets.length === 0 ? `Aucune règle fiscale validée pour ${company.country}` : `${rulesets.length} règle(s) validée(s) pour ${company.country}`}</p>
            <p className="text-muted">{estimate.status === "unavailable" ? estimate.reason : "Estimation disponible."}</p>
            <p className="text-muted">Les taux, obligations et estimations ne sont jamais déduits automatiquement tant qu&apos;un expert n&apos;a pas validé les règles de votre pays (source citée, version et dates de validité). En attendant, suivez vos échéances et conservez l&apos;historique de vos déclarations et paiements ci-dessous.</p>
          </div>
        </div>
      </Card>

      <Card>
        <CardTitle hint="Calendrier saisi par vous ou votre comptable.">Échéances à venir</CardTitle>
        {open.length === 0 ? (
          <EmptyState title="Aucune échéance à suivre" description="Ajoutez vos échéances fiscales pour être alerté avant la date limite." />
        ) : (
          <ul className="divide-y divide-border text-sm">
            {open.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span><Link className="font-medium hover:text-accent" href={`/app/${companyId}/tax/${o.id}`}>{o.title}</Link><span className="block text-xs text-muted">{[o.authority, o.periodLabel].filter(Boolean).join(" · ")}</span></span>
                <span className="flex items-center gap-3"><span className="num text-muted">{o.dueDate}</span><Badge tone={STATE_BADGES[o.state][0]}>{STATE_BADGES[o.state][1]}</Badge></span>
              </li>
            ))}
          </ul>
        )}
        {canWrite && <details className="mt-4 border-t border-border pt-4"><summary className="cursor-pointer text-sm font-medium text-accent">+ Nouvelle échéance</summary><div className="pt-4"><ObligationForm companyId={companyId} /></div></details>}
      </Card>

      {done.length > 0 && (
        <Card>
          <CardTitle hint="Historique des déclarations et paiements">Échéances traitées</CardTitle>
          <ul className="divide-y divide-border text-sm">
            {done.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <Link className="font-medium hover:text-accent" href={`/app/${companyId}/tax/${o.id}`}>{o.title}<span className="ml-2 text-xs font-normal text-muted">{o.periodLabel}</span></Link>
                <span className="flex items-center gap-3"><span className="num text-muted">{o.dueDate}</span><Badge tone={STATE_BADGES[o.state][0]}>{STATE_BADGES[o.state][1]}</Badge></span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardTitle hint="Informations déclaratives : elles ne déclenchent aucun calcul.">Profil fiscal</CardTitle>
        {canWrite ? <ProfileForm companyId={companyId} profile={profile} /> : <p className="text-sm text-muted">{profile?.regimeLabel ?? "Non renseigné"}</p>}
      </Card>
    </div>
  );
}

export default withAccess(Tax);
