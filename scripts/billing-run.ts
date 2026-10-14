/** Tâche quotidienne de facturation (cron) : factures de renouvellement et statuts. Idempotente. */
import { sql } from "@/db/client";
import { runBillingJob } from "@/modules/billing/jobs";

try {
  const r = await runBillingJob();
  console.log(`Facturation : ${r.invoicesIssued} facture(s) émise(s), ${r.statusUpdated} statut(s) mis à jour, ${r.skipped} déjà émise(s).`);
} finally {
  await sql.end();
}
