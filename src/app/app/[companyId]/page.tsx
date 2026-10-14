import Link from "next/link";
import { FileText, Users } from "lucide-react";
import { Card, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { listContacts } from "@/modules/core/contacts";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Vue d'ensemble" };

export default async function Dashboard({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const user = await requireUser();
  const contacts = await listContacts(user.id, companyId);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Vue d&apos;ensemble</h1>
        <p className="text-sm text-muted">Votre activité en un coup d&apos;œil.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Contacts actifs" value={String(contacts.length)} />
        <StatCard label="Chiffre d'affaires" value={null} emptyHint="Apparaît après votre première facture" featured />
        <StatCard label="Factures impayées" value={null} emptyHint="Aucune facture enregistrée" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardTitle hint="Contacts actifs de cette entreprise">Clients et prospects</CardTitle>
          {contacts.length === 0 ? (
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
            <p className="num text-3xl font-semibold">{contacts.length}</p>
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
