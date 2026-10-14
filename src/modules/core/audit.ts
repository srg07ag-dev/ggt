import { and, desc, eq, like, sql, type SQL } from "drizzle-orm";
import { schema } from "@/db/client";
import { requireMembership, withTenant } from "./tenant";

export const PAGE_SIZE = 50;

/** Libellés lisibles des actions tracées ; une action inconnue s'affiche telle quelle. */
export const ACTION_LABELS: Record<string, string> = {
  "company.created": "Entreprise créée",
  "company.updated": "Informations de l'entreprise modifiées",
  "numbering.updated": "Numérotation modifiée",
  "contact.created": "Contact créé",
  "contact.updated": "Contact modifié",
  "contact.archived": "Contact archivé",
  "contact.restored": "Contact restauré",
  "opportunity.created": "Opportunité créée",
  "opportunity.moved": "Opportunité déplacée",
  "activity.created": "Tâche créée",
  "activity.status": "Statut de tâche modifié",
  "tax_rate.created": "Taxe ajoutée",
  "tax_rate.archived": "Taxe archivée",
  "product.created": "Produit créé",
  "product.archived": "Produit archivé",
  "quote.draft_created": "Brouillon de devis créé",
  "quote.sent": "Devis envoyé",
  "quote.accepted": "Devis accepté",
  "quote.declined": "Devis refusé",
  "quote.converted": "Devis converti en facture",
  "invoice.draft_created": "Brouillon de facture créé",
  "invoice.issued": "Facture émise",
  "credit_note.draft_created": "Brouillon d'avoir créé",
  "credit_note.issued": "Avoir émis",
  "document.line_added": "Ligne ajoutée",
  "document.line_removed": "Ligne supprimée",
  "document.draft_deleted": "Brouillon supprimé",
  "payment.recorded": "Paiement enregistré",
  "payment.voided": "Paiement annulé",
  "account.created": "Compte de trésorerie créé",
  "account.archived": "Compte archivé",
  "supplier.created": "Fournisseur créé",
  "supplier.archived": "Fournisseur archivé",
  "category.created": "Catégorie créée",
  "income.recorded": "Recette enregistrée",
  "expense.recorded": "Dépense enregistrée",
  "entry.voided": "Opération annulée",
  "attachment.added": "Justificatif ajouté",
  "attachment.downloaded": "Justificatif téléchargé",
  "attachment.deleted": "Justificatif supprimé",
  "export.generated": "Export généré",
  "invitation.created": "Invitation créée",
  "invitation.accepted": "Invitation acceptée",
  "invitation.revoked": "Invitation annulée",
  "member.role_changed": "Rôle modifié",
  "member.removed": "Membre retiré",
  "member.left": "Membre parti",
  "ledger_account.created": "Compte comptable créé",
  "ledger_account.renamed": "Compte comptable renommé",
  "ledger_account.archived": "Compte comptable archivé",
  "ledger_account.restored": "Compte comptable restauré",
  "ledger_account.imported": "Plan de comptes importé",
  "ledger_mapping.set": "Correspondance comptable modifiée",
  "journal.created": "Journal créé",
  "journal.archived": "Journal archivé",
  "period.created": "Période comptable créée",
  "period.closed": "Période comptable clôturée",
  "period.reopened": "Période comptable rouverte",
  "entry.draft_created": "Brouillon d'écriture créé",
  "entry.draft_updated": "Brouillon d'écriture modifié",
  "entry.draft_deleted": "Brouillon d'écriture supprimé",
  "entry.posted": "Écriture validée",
  "entry.reversed": "Écriture contre-passée",
  "accounting.enabled": "Comptabilisation automatique activée",
  "accounting.settings_saved": "Réglages comptables enregistrés",
  "tax_profile.saved": "Profil fiscal enregistré",
  "tax_obligation.created": "Échéance fiscale créée",
  "tax_obligation.status": "Statut d'échéance fiscale modifié",
  "tax_obligation.deleted": "Échéance fiscale supprimée",
  "tax_event.filed": "Déclaration fiscale enregistrée",
  "tax_event.paid": "Paiement fiscal enregistré",
  "tax_event.note": "Note fiscale ajoutée",
};

/** Familles proposées en filtre (préfixe d'action). */
export const FAMILIES: [string, string][] = [
  ["", "Tout"],
  ["contact.", "Contacts"],
  ["member.", "Membres"],
  ["invitation.", "Invitations"],
  ["invoice.", "Factures"],
  ["credit_note.", "Avoirs"],
  ["payment.", "Paiements"],
  ["quote.", "Devis"],
  ["expense.", "Dépenses"],
  ["attachment.", "Justificatifs"],
  ["export.", "Exports"],
  ["entry.", "Écritures"],
  ["period.", "Périodes"],
  ["ledger_", "Plan de comptes"],
  ["tax_", "Fiscalité"],
];

export interface AuditFilter {
  family?: string;
  /** Curseur : « horodatage|id » de la dernière ligne vue (produit par listAudit). */
  before?: string;
}

/** Journal d'audit de l'entreprise (lecture seule, paginé du plus récent au plus ancien). */
export async function listAudit(userId: string, companyId: string, f: AuditFilter = {}) {
  const ctx = await requireMembership(userId, companyId, "audit:read");
  const conds: (SQL | undefined)[] = [];
  if (f.family && FAMILIES.some(([k]) => k === f.family)) conds.push(like(schema.auditLog.action, `${f.family}%`));
  if (f.before) {
    // Le curseur garde la précision à la microseconde de PostgreSQL (une Date JS la perdrait et sauterait des lignes).
    const [ts, id] = f.before.split("|");
    if (ts && id && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?$/.test(ts) && /^[0-9a-f-]{36}$/i.test(id)) {
      conds.push(sql`(${schema.auditLog.createdAt}, ${schema.auditLog.id}) < (${ts}::timestamp, ${id}::uuid)`);
    }
  }
  const rows = await withTenant(ctx, (tx) =>
    tx
      .select({
        id: schema.auditLog.id,
        action: schema.auditLog.action,
        entity: schema.auditLog.entity,
        entityId: schema.auditLog.entityId,
        meta: schema.auditLog.meta,
        createdAt: schema.auditLog.createdAt,
        cursorTs: sql<string>`${schema.auditLog.createdAt}::text`,
        actorName: schema.user.name,
        actorEmail: schema.user.email,
      })
      .from(schema.auditLog)
      .leftJoin(schema.user, eq(schema.user.id, schema.auditLog.actorId))
      .where(and(...conds))
      .orderBy(desc(schema.auditLog.createdAt), desc(schema.auditLog.id))
      .limit(PAGE_SIZE + 1),
  );
  const more = rows.length > PAGE_SIZE;
  const page = rows.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  return { rows: page, next: more && last ? `${last.cursorTs}|${last.id}` : null };
}

