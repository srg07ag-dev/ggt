import { Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireUser } from "@/lib/session";
import { listContacts } from "@/modules/core/contacts";
import { ContactForm } from "./contact-form";

export const metadata = { title: "Contacts" };

export default async function Contacts({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const user = await requireUser();
  const contacts = await listContacts(user.id, companyId);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
      <Card><ContactForm companyId={companyId} /></Card>
      {contacts.length === 0 ? (
        <EmptyState icon={<Users className="size-6" />} title="Aucun contact" description="Les contacts que vous ajoutez apparaîtront ici." />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-muted">
              <tr><th className="px-4 py-3 font-medium">Nom</th><th className="px-4 py-3 font-medium">E-mail</th></tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">{c.name}</td>
                  <td className="px-4 py-3 text-muted">{c.email ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
