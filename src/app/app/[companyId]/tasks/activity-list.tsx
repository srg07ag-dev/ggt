import { Check, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { listActivities } from "@/modules/crm/activities";
import { setActivityStatusAction } from "./actions";
import { TYPE_LABELS } from "./activity-form";

type Row = Awaited<ReturnType<typeof listActivities>>[number];
const PRIORITY = { low: ["neutral", "Basse"], normal: ["accent", "Normale"], high: ["danger", "Haute"] } as const;

export function ActivityList({ companyId, rows, canWrite }: { companyId: string; rows: Row[]; canWrite: boolean }) {
  const fmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });
  return (
    <ul className="divide-y divide-border rounded-[var(--radius-lg)] border border-border bg-surface">
      {rows.map((r) => {
        const overdue = r.status === "todo" && r.dueAt && r.dueAt < new Date();
        const done = r.status === "done";
        return (
          <li key={r.id} className="flex items-center gap-3 px-4 py-3">
            {canWrite && (
              <form action={setActivityStatusAction.bind(null, companyId, r.id, done ? "todo" : "done")}>
                <button
                  aria-label={done ? "Rouvrir la tâche" : "Marquer comme terminée"}
                  className={`flex size-7 items-center justify-center rounded-full border ${done ? "border-mint bg-mint-soft text-mint" : "border-border-strong text-transparent hover:text-muted"}`}
                >
                  {done ? <RotateCcw className="size-3.5" /> : <Check className="size-3.5" />}
                </button>
              </form>
            )}
            <div className="min-w-0 flex-1">
              <p className={`truncate text-sm ${done ? "text-muted line-through" : "font-medium"}`}>{r.title}</p>
              <p className="truncate text-xs text-muted">
                {TYPE_LABELS[r.type]}
                {r.contactName && ` · ${r.contactName}`}
                {r.dueAt && ` · ${fmt.format(r.dueAt)}`}
              </p>
            </div>
            {overdue && <Badge tone="danger">En retard</Badge>}
            <span className="hidden sm:block"><Badge tone={PRIORITY[r.priority][0]}>{PRIORITY[r.priority][1]}</Badge></span>
          </li>
        );
      })}
    </ul>
  );
}
