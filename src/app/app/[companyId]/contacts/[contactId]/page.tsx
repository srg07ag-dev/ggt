import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { can } from "@/modules/core/permissions";
import { requireMembership } from "@/modules/core/tenant";
import { listActivities } from "@/modules/crm/activities";
import { getContact, listContactOptions } from "@/modules/crm/contacts";
import { listOpportunities, listStages } from "@/modules/crm/pipeline";
import { ActivityForm } from "../../tasks/activity-form";
import { ActivityList } from "../../tasks/activity-list";
import { archiveContactAction } from "../actions";
import { ContactForm } from "../contact-form";

export default async function ContactPage({ params }: { params: Promise<{ companyId: string; contactId: string }> }) {
  const { companyId, contactId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(contactId)) notFound();
  const user = await requireUser();
  const ctx = await requireMembership(user.id, companyId, "crm:read");
  const found = await getContact(user.id, companyId, contactId);
  if (!found) notFound();
  const { contact, people } = found;
  const [activities, opps, stages, parents] = await Promise.all([
    listActivities(user.id, companyId, { contactId }),
    listOpportunities(user.id, companyId),
    listStages(user.id, companyId),
    listContactOptions(user.id, companyId, "organization"),
  ]);
  const mine = opps.filter((o) => o.contactId === contactId);
  const canWrite = can(ctx.role, "crm:write");
  const archived = !!contact.archivedAt;

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/app/${companyId}/contacts`} className="text-sm text-muted hover:text-accent">← Contacts</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{contact.name}</h1>
          <Badge tone="neutral">{contact.kind === "organization" ? "Entreprise" : "Particulier"}</Badge>
          {archived && <Badge tone="warning">Archivé</Badge>}
          {contact.tags.map((t) => <Badge key={t} tone="accent">{t}</Badge>)}
        </div>
        <p className="mt-1 text-sm text-muted">{[contact.email, contact.phone, contact.organization].filter(Boolean).join(" · ") || "Aucune coordonnée"}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Card>
            <CardTitle hint="Tâches, relances, rendez-vous et notes liés à ce contact">Activités</CardTitle>
            {canWrite && !archived && (
              <details className="mb-4">
                <summary className="cursor-pointer text-sm font-medium text-accent">+ Ajouter une activité</summary>
                <div className="pt-4"><ActivityForm companyId={companyId} contactId={contactId} /></div>
              </details>
            )}
            {activities.length === 0 ? <p className="text-sm text-muted">Aucune activité pour ce contact.</p> : <ActivityList companyId={companyId} rows={activities} canWrite={canWrite} />}
          </Card>
          <Card>
            <CardTitle hint="Affaires en cours et conclues">Opportunités</CardTitle>
            {mine.length === 0 ? <p className="text-sm text-muted">Aucune opportunité.</p> : (
              <ul className="divide-y divide-border text-sm">
                {mine.map((o) => (
                  <li key={o.id} className="flex items-center justify-between py-2">
                    <span>{o.title}<span className="ml-2 text-xs text-muted">{stages.find((s) => s.id === o.stageId)?.name}</span></span>
                    <span className="num">{formatMoney(o.amountMinor, o.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardTitle hint="Devis, factures, paiements et créances seront affichés ici avec le module Ventes">Facturation</CardTitle>
            <p className="text-sm text-muted">Aucun document pour l&apos;instant.</p>
          </Card>
        </div>

        <div className="space-y-4">
          {contact.kind === "organization" && (
            <Card>
              <CardTitle>Personnes à contacter</CardTitle>
              {people.length === 0 ? <p className="text-sm text-muted">Aucun interlocuteur. Rattachez un contact à cette entreprise depuis sa fiche.</p> : (
                <ul className="space-y-2 text-sm">
                  {people.map((p) => (
                    <li key={p.id}><Link className="font-medium hover:text-accent" href={`/app/${companyId}/contacts/${p.id}`}>{p.name}</Link><span className="block text-xs text-muted">{p.email ?? p.phone ?? ""}</span></li>
                  ))}
                </ul>
              )}
            </Card>
          )}
          {canWrite && (
            <Card>
              <CardTitle>Informations</CardTitle>
              <ContactForm companyId={companyId} contact={contact} parents={parents} />
              <form action={archiveContactAction.bind(null, companyId, contact.id, !archived)} className="mt-4 border-t border-border pt-4">
                <Button variant="secondary" type="submit">{archived ? "Restaurer le contact" : "Archiver le contact"}</Button>
              </form>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
