import { CheckSquare } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PillTabs } from "@/components/ui/pill-tabs";
import { requireUser } from "@/lib/session";
import { can } from "@/modules/core/permissions";
import { requireMembership } from "@/modules/core/tenant";
import { listActivities } from "@/modules/crm/activities";
import { listContactOptions } from "@/modules/crm/contacts";
import { ActivityForm } from "./activity-form";
import { ActivityList } from "./activity-list";

export const metadata = { title: "Tâches" };

export default async function Tasks({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { companyId } = await params;
  const { status } = await searchParams;
  const user = await requireUser();
  const ctx = await requireMembership(user.id, companyId, "crm:read");
  const current = status === "done" ? "done" : "todo";
  const [rows, contacts] = await Promise.all([
    listActivities(user.id, companyId, { status: current }),
    listContactOptions(user.id, companyId),
  ]);
  const canWrite = can(ctx.role, "crm:write");
  const base = `/app/${companyId}/tasks`;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Tâches et activités</h1>
      {canWrite && (
        <details className="rounded-[var(--radius-lg)] border border-border bg-surface">
          <summary className="cursor-pointer list-none px-5 py-4 text-sm font-medium text-accent">+ Nouvelle tâche</summary>
          <div className="border-t border-border p-5"><ActivityForm companyId={companyId} contacts={contacts} /></div>
        </details>
      )}
      <PillTabs
        label="Statut"
        tabs={[
          { href: base, label: "À faire", active: current === "todo" },
          { href: `${base}?status=done`, label: "Terminées", active: current === "done" },
        ]}
      />
      {rows.length === 0 ? (
        <EmptyState icon={<CheckSquare className="size-6" />} title={current === "todo" ? "Rien à faire" : "Aucune tâche terminée"} description="Créez des relances et des rendez-vous pour ne rien oublier." />
      ) : (
        <ActivityList companyId={companyId} rows={rows} canWrite={canWrite} />
      )}
    </div>
  );
}
