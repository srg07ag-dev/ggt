import { Badge } from "@/components/ui/badge";
import type { Settlement } from "@/modules/sales/documents";

type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

export function DocStatusBadge({ type, status, settlement }: { type: string; status: string; settlement?: Settlement }) {
  let tone: Tone = "neutral";
  let label = "Brouillon";
  if (type === "quote") {
    const map: Record<string, [Tone, string]> = {
      draft: ["neutral", "Brouillon"],
      sent: ["accent", "Envoyé"],
      accepted: ["success", "Accepté"],
      declined: ["danger", "Refusé"],
      converted: ["success", "Converti en facture"],
    };
    [tone, label] = map[status] ?? ["neutral", status];
  } else if (status === "draft") {
    [tone, label] = ["neutral", "Brouillon"];
  } else if (type === "credit_note") {
    [tone, label] = ["accent", "Émis"];
  } else if (settlement) {
    const map: Record<Settlement["state"], [Tone, string]> = {
      unpaid: ["warning", "À payer"],
      partial: ["accent", "Partiellement payée"],
      paid: ["success", "Payée"],
      overdue: ["danger", "En retard"],
      settled_by_credit: ["success", "Soldée par avoir"],
    };
    [tone, label] = map[settlement.state];
  }
  return <Badge tone={tone}>{label}</Badge>;
}
