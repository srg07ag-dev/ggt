import Link from "next/link";
import { FileText, Users } from "lucide-react";
import { Card, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { countOpenActivities } from "@/modules/crm/activities";
import { countContactsByState } from "@/modules/crm/contacts";
import { listOpportunities, listStages } from "@/modules/crm/pipeline";
import { formatMoney } from "@/lib/money";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Vue d'ensemble" };

export default async function Dashboard({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const user = await requireUser();
  const [counts, tasks, opps, stages] = await Promise.all([
    countContactsByState(user.id, companyId),
    countOpenActivities(user.id, companyId),
    listOpportunities(user.id, companyId),
    listStages(user.id, companyId),
  ]);
  const openStageIds = new Set(stages.filter((s) => s.kind === "open").map((s) => s.id));
  const open = opps.filter((o) => openStageIds.has(o.stageId));
  const currency = open[0]?.currency;
  const pipelineValue = open.reduce((n, o) => n + o.amountMinor, 0);
  const weighted = open.reduce((n, o) => n + Math.round((o.amountMinor * o.probability) / 100), 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Vue d&apos;ensemble</h1>
        <p className="text-sm text-muted">Votre activité en un coup d&apos;œil.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Contacts actifs" value={String(counts.active)} />
        <StatCard
          label="Pipeline ouvert"
          value={currency ? formatMoney(pipelineValue, currency) : null}
          compare={currency ? `Pondéré : ${formatMoney(weighted, currency)}` : undefined}
          emptyHint="Aucune opportunité ouverte"
          featured
        />
        <StatCard
          label="Tâches à faire"
          value={String(tasks.open)}
          delta={tasks.overdue ? `${tasks.overdue} en retard` : undefined}
          deltaTone="danger"
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardTitle hint="Contacts actifs de cette entreprise">Clients et prospects</CardTitle>
          {counts.active === 0 ? (
            <EmptyState
              icon={<Users className="size-6" />}
              title="Aucun contact pour l'instant"
              description="Ajoutez votre premier client ou prospect pour démarrer le suivi commercial."
              action={
                <Link href={`/app/${companyId}/contacts`} className="text-sm font-medium text-accent">
                  Ajouter un contact
                </Link>
              }
            />
          ) : (
            <p className="text-sm text-muted">Consultez la liste pour le détail.</p>
          )}
        </Card>
        <Card>
          <CardTitle hint="Factures impayées et encaissements">Facturation</CardTitle>
          <EmptyState
            icon={<FileText className="size-6" />}
            title="Facturation bientôt disponible"
            description="Aucun chiffre n'est affiché tant que les données ne sont pas réellement enregistrées."
          />
        </Card>
      </div>
    </div>
  );
}
