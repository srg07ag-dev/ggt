import Link from "next/link";
import { Search, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PillTabs } from "@/components/ui/pill-tabs";
import { requireUser } from "@/lib/session";
import { can } from "@/modules/core/permissions";
import { requireMembership } from "@/modules/core/tenant";
import { countContactsByState, listContactOptions, listContacts } from "@/modules/crm/contacts";
import { ContactForm } from "./contact-form";
import { withAccess } from "@/lib/with-access";

export const metadata = { title: "Contacts" };

async function Contacts({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ q?: string; kind?: string; archived?: string; tag?: string }>;
}) {
  const { companyId } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const canWrite = can((await requireMembership(user.id, companyId, "crm:read")).role, "crm:write");
  const archived = sp.archived === "1";
  const kind = sp.kind === "person" || sp.kind === "organization" ? sp.kind : undefined;
  const [contacts, counts, parents] = await Promise.all([
    listContacts(user.id, companyId, { q: sp.q, kind, archived, tag: sp.tag }),
    countContactsByState(user.id, companyId),
    listContactOptions(user.id, companyId, "organization"),
  ]);
  const base = `/app/${companyId}/contacts`;
  const qs = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: sp.q, kind, tag: sp.tag, ...o })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `${base}?${s}` : base;
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
      {canWrite && <details className="group glass rounded-[var(--radius-lg)]">
        <summary className="cursor-pointer list-none px-5 py-4 text-sm font-medium text-accent">+ Nouveau contact</summary>
        <div className="border-t border-border p-5"><ContactForm companyId={companyId} parents={parents} /></div>
      </details>}

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <PillTabs
          label="Filtres"
          tabs={[
            { href: qs({ archived: undefined }), label: "Actifs", count: counts.active, active: !archived },
            { href: qs({ archived: "1" }), label: "Archivés", count: counts.archived, active: archived },
          ]}
        />
        <form className="relative" role="search">
          <Search className="absolute left-3 top-2.5 size-4 text-muted" aria-hidden />
          <input
            name="q"
            defaultValue={sp.q}
            placeholder="Rechercher un contact"
            aria-label="Rechercher un contact"
            className="h-10 w-full rounded-[var(--radius-sm)] border border-border-strong bg-surface pl-9 pr-4 text-sm md:w-72"
          />
          {archived && <input type="hidden" name="archived" value="1" />}
        </form>
      </div>
      <PillTabs
        label="Type"
        tabs={[
          { href: qs({ kind: undefined }), label: "Tous", active: !kind },
          { href: qs({ kind: "person" }), label: "Particuliers", active: kind === "person" },
          { href: qs({ kind: "organization" }), label: "Entreprises", active: kind === "organization" },
        ]}
      />

      {contacts.length === 0 ? (
        <EmptyState
          icon={<Users className="size-6" />}
          title={sp.q || kind || sp.tag ? "Aucun résultat" : archived ? "Aucun contact archivé" : "Aucun contact"}
          description="Ajoutez un contact ou modifiez vos filtres."
        />
      ) : (
        <div className="overflow-x-auto glass rounded-[var(--radius-lg)]">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Nom</th>
                <th className="px-4 py-3 font-medium">E-mail</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Téléphone</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Tags</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                  <td className="px-4 py-3">
                    <Link href={`${base}/${c.id}`} className="font-medium hover:text-accent">{c.name}</Link>
                    {c.kind === "organization" && <span className="ml-2 text-xs text-muted">Entreprise</span>}
                  </td>
                  <td className="px-4 py-3 text-muted">{c.email ?? "—"}</td>
                  <td className="num hidden px-4 py-3 text-muted md:table-cell">{c.phone ?? "—"}</td>
                  <td className="hidden gap-1 px-4 py-3 md:table-cell">
                    {c.tags.map((t) => <span key={t} className="mr-1"><Badge tone="accent">{t}</Badge></span>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default withAccess(Contacts);
