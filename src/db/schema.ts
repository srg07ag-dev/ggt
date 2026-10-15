import {
  bigint,
  boolean,
  date,
  foreignKey,
  index,
  integer,
  unique,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* ---------- Authentification (tables attendues par Better Auth) ---------- */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
  /** Opérateur de la plateforme (administration). Jamais modifiable par l'utilisateur ; attribué par script d'exploitation. */
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** Double authentification (TOTP + codes de secours). Les secrets sont chiffrés par Better Auth. */
export const twoFactor = pgTable("two_factor", {
  id: text("id").primaryKey(),
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  verified: boolean("verified").notNull().default(true),
  failedVerificationCount: integer("failed_verification_count").notNull().default(0),
  lockedUntil: timestamp("locked_until"),
});

/** Limitation de débit partagée entre instances (stockage « database » de Better Auth). */
export const rateLimit = pgTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

/* ---------- Entreprises et appartenance ---------- */

export const roleEnum = pgEnum("member_role", [
  "owner",
  "admin",
  "manager",
  "member",
  "accountant",
  "viewer",
]);

export const company = pgTable("company", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  /** ISO 3166-1 alpha-2. Sert à sélectionner le pack réglementaire, jamais à modifier l'historique. */
  country: text("country").notNull(),
  locale: text("locale").notNull().default("fr-FR"),
  /** ISO 4217 */
  currency: text("currency").notNull(),
  timezone: text("timezone").notNull().default("UTC"),
  /** Identité de l'émetteur, reproduite sur les documents (photographiée à l'émission). */
  address: text("address"),
  taxId: text("tax_id"),
  email: text("email"),
  phone: text("phone"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const membership = pgTable(
  "membership",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("membership_company_user").on(t.companyId, t.userId)],
);

/* ---------- Tables métier (isolées par company_id + RLS) ---------- */

export const contact = pgTable(
  "contact",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("person"), // person | organization
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    /** Organisation de rattachement (texte libre) pour un particulier. */
    organization: text("organization"),
    address: text("address"),
    tags: text("tags").array().notNull().default([]),
    /** Interlocuteur d'un client professionnel : pointe vers le contact « organization ». */
    parentId: uuid("parent_id"),
    notes: text("notes"),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("contact_company_idx").on(t.companyId),
    unique("contact_company_id_id").on(t.companyId, t.id),
    foreignKey({ columns: [t.companyId, t.parentId], foreignColumns: [t.companyId, t.id] }),
  ],
);

/** Journal d'audit en ajout seul (UPDATE/DELETE interdits par trigger). */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("audit_company_idx").on(t.companyId, t.createdAt)],
);

/* ---------- Pipeline commercial ---------- */

export const stageKindEnum = pgEnum("stage_kind", ["open", "won", "lost"]);

export const pipelineStage = pgTable(
  "pipeline_stage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    kind: stageKindEnum("kind").notNull().default("open"),
  },
  (t) => [unique("stage_company_id_id").on(t.companyId, t.id)],
);

export const opportunity = pgTable(
  "opportunity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull(),
    stageId: uuid("stage_id").notNull(),
    title: text("title").notNull(),
    /** Unités mineures de la devise (centimes), jamais de flottants. */
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull().default(0),
    currency: text("currency").notNull(),
    probability: integer("probability").notNull().default(10),
    expectedClose: date("expected_close"),
    closedAt: timestamp("closed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("opportunity_company_idx").on(t.companyId, t.stageId),
    unique("opportunity_company_id_id").on(t.companyId, t.id),
    foreignKey({ columns: [t.companyId, t.contactId], foreignColumns: [contact.companyId, contact.id] }),
    foreignKey({ columns: [t.companyId, t.stageId], foreignColumns: [pipelineStage.companyId, pipelineStage.id] }),
  ],
);

/* ---------- Activités et tâches ---------- */

export const activityTypeEnum = pgEnum("activity_type", ["call", "meeting", "note", "follow_up", "deadline"]);
export const priorityEnum = pgEnum("priority", ["low", "normal", "high"]);
export const activityStatusEnum = pgEnum("activity_status", ["todo", "done", "cancelled"]);

export const activity = pgTable(
  "activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id"),
    opportunityId: uuid("opportunity_id"),
    type: activityTypeEnum("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    priority: priorityEnum("priority").notNull().default("normal"),
    status: activityStatusEnum("status").notNull().default("todo"),
    dueAt: timestamp("due_at"),
    assigneeId: text("assignee_id"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("activity_company_idx").on(t.companyId, t.status, t.dueAt),
    foreignKey({ columns: [t.companyId, t.contactId], foreignColumns: [contact.companyId, contact.id] }),
    foreignKey({ columns: [t.companyId, t.opportunityId], foreignColumns: [opportunity.companyId, opportunity.id] }),
    // l'assigné doit être membre de la même entreprise
    foreignKey({ columns: [t.companyId, t.assigneeId], foreignColumns: [membership.companyId, membership.userId] }),
  ],
);

/* ---------- Ventes : catalogue, taxes, numérotation ---------- */

/** Taux saisis par l'entreprise (aucune valeur par défaut : les taux relèvent de la réglementation locale). */
export const taxRate = pgTable(
  "tax_rate",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Points de base : 18 % = 1800. */
    rateBp: integer("rate_bp").notNull(),
    /** Compte comptable crédité pour la taxe collectée (comptabilisation automatique). */
    ledgerAccountId: uuid("ledger_account_id"),
    archivedAt: timestamp("archived_at"),
  },
  (t) => [
    unique("tax_rate_company_id_id").on(t.companyId, t.id),
    foreignKey({ columns: [t.companyId, t.ledgerAccountId], foreignColumns: [ledgerAccount.companyId, ledgerAccount.id] }),
  ],
);

export const product = pgTable(
  "product",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("service"), // product | service
    name: text("name").notNull(),
    description: text("description"),
    unitPriceMinor: bigint("unit_price_minor", { mode: "number" }).notNull().default(0),
    taxRateId: uuid("tax_rate_id"),
    /** Compte de produit spécifique ; à défaut, celui des réglages comptables. */
    revenueAccountId: uuid("revenue_account_id"),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("product_company_id_id").on(t.companyId, t.id),
    foreignKey({ columns: [t.companyId, t.taxRateId], foreignColumns: [taxRate.companyId, taxRate.id] }),
    foreignKey({ columns: [t.companyId, t.revenueAccountId], foreignColumns: [ledgerAccount.companyId, ledgerAccount.id] }),
  ],
);

export const docTypeEnum = pgEnum("doc_type", ["quote", "invoice", "credit_note"]);
export const docStatusEnum = pgEnum("doc_status", ["draft", "sent", "accepted", "declined", "converted", "issued"]);
export const paymentMethodEnum = pgEnum("payment_method", ["cash", "bank_transfer", "mobile_money", "card", "cheque", "other"]);

/** Motif de numérotation par type de document, ex. « FA-{YYYY}-{NNNN} ». */
export const numbering = pgTable(
  "numbering",
  {
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    docType: docTypeEnum("doc_type").notNull(),
    pattern: text("pattern").notNull(),
  },
  (t) => [unique("numbering_company_type").on(t.companyId, t.docType)],
);

export const numberingCounter = pgTable(
  "numbering_counter",
  {
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    docType: docTypeEnum("doc_type").notNull(),
    /** Année si le motif contient {YYYY}, sinon chaîne vide. */
    period: text("period").notNull().default(""),
    last: integer("last").notNull().default(0),
  },
  (t) => [unique("numbering_counter_key").on(t.companyId, t.docType, t.period)],
);

export const salesDocument = pgTable(
  "sales_document",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    type: docTypeEnum("type").notNull(),
    status: docStatusEnum("status").notNull().default("draft"),
    /** Attribué à l'émission (facture, avoir) ou à l'envoi (devis) ; sans trou. */
    number: text("number"),
    contactId: uuid("contact_id").notNull(),
    /** Devis d'origine (facture) ou facture d'origine (avoir). */
    relatedId: uuid("related_id"),
    issueDate: date("issue_date").notNull(),
    dueDate: date("due_date"),
    currency: text("currency").notNull(),
    subtotalMinor: bigint("subtotal_minor", { mode: "number" }).notNull().default(0),
    taxMinor: bigint("tax_minor", { mode: "number" }).notNull().default(0),
    totalMinor: bigint("total_minor", { mode: "number" }).notNull().default(0),
    notes: text("notes"),
    /** Identités émetteur et client figées à l'émission. */
    snapshot: jsonb("snapshot"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    issuedAt: timestamp("issued_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("sales_document_idx").on(t.companyId, t.type, t.status),
    index("sales_document_related_idx").on(t.companyId, t.relatedId),
    unique("sales_document_company_id_id").on(t.companyId, t.id),
    unique("sales_document_number").on(t.companyId, t.type, t.number),
    foreignKey({ columns: [t.companyId, t.contactId], foreignColumns: [contact.companyId, contact.id] }),
    foreignKey({ columns: [t.companyId, t.relatedId], foreignColumns: [t.companyId, t.id] }),
  ],
);

export const salesLine = pgTable(
  "sales_line",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").notNull(),
    position: integer("position").notNull(),
    productId: uuid("product_id"),
    description: text("description").notNull(),
    /** Millièmes d'unité : 2,5 → 2500. */
    quantityMilli: integer("quantity_milli").notNull(),
    unitPriceMinor: bigint("unit_price_minor", { mode: "number" }).notNull(),
    /** Photographie du taux au moment de la saisie : un changement ultérieur ne touche pas l'historique. */
    taxName: text("tax_name"),
    taxRateId: uuid("tax_rate_id"),
    taxRateBp: integer("tax_rate_bp").notNull().default(0),
    netMinor: bigint("net_minor", { mode: "number" }).notNull(),
    taxMinor: bigint("tax_minor", { mode: "number" }).notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.companyId, t.documentId], foreignColumns: [salesDocument.companyId, salesDocument.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.companyId, t.productId], foreignColumns: [product.companyId, product.id] }),
    foreignKey({ columns: [t.companyId, t.taxRateId], foreignColumns: [taxRate.companyId, taxRate.id] }),
  ],
);

/** Paiements en ajout seul : une erreur s'annule (voided_at), elle ne se modifie pas. */
export const payment = pgTable(
  "payment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    paidOn: date("paid_on").notNull(),
    /** Compte de trésorerie crédité ; vide = paiement non affecté. */
    accountId: uuid("account_id"),
    method: paymentMethodEnum("method").notNull(),
    reference: text("reference"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    voidedAt: timestamp("voided_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("payment_invoice_idx").on(t.companyId, t.invoiceId),
    foreignKey({ columns: [t.companyId, t.invoiceId], foreignColumns: [salesDocument.companyId, salesDocument.id] }),
    foreignKey({ columns: [t.companyId, t.accountId], foreignColumns: [financeAccount.companyId, financeAccount.id] }),
  ],
);

/* ---------- Finances : trésorerie, fournisseurs, recettes et dépenses ---------- */

export const financeAccount = pgTable(
  "finance_account",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").notNull().default("bank"), // cash | bank | mobile_money | other
    currency: text("currency").notNull(),
    /** Solde au démarrage du suivi, en unités mineures (peut être négatif). */
    openingBalanceMinor: bigint("opening_balance_minor", { mode: "number" }).notNull().default(0),
    /** Compte comptable de ce compte de trésorerie (comptabilisation automatique). */
    ledgerAccountId: uuid("ledger_account_id"),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("finance_account_company_id_id").on(t.companyId, t.id),
    foreignKey({ columns: [t.companyId, t.ledgerAccountId], foreignColumns: [ledgerAccount.companyId, ledgerAccount.id] }),
  ],
);

export const supplier = pgTable(
  "supplier",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    address: text("address"),
    taxId: text("tax_id"),
    notes: text("notes"),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [unique("supplier_company_id_id").on(t.companyId, t.id)],
);

export const entryKindEnum = pgEnum("entry_kind", ["income", "expense"]);

export const financeCategory = pgTable(
  "finance_category",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    kind: entryKindEnum("kind").notNull(),
    name: text("name").notNull(),
    /** Compte de charge (dépense) ou de produit (recette) pour la comptabilisation automatique. */
    ledgerAccountId: uuid("ledger_account_id"),
    archivedAt: timestamp("archived_at"),
  },
  (t) => [
    unique("finance_category_company_id_id").on(t.companyId, t.id),
    unique("finance_category_name").on(t.companyId, t.kind, t.name),
    foreignKey({ columns: [t.companyId, t.ledgerAccountId], foreignColumns: [ledgerAccount.companyId, ledgerAccount.id] }),
  ],
);

/** Recettes diverses et dépenses. Les encaissements de factures vivent dans `payment`. Ajout seul + annulation. */
export const financeEntry = pgTable(
  "finance_entry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull(),
    kind: entryKindEnum("kind").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    /** Part de taxe incluse dans le montant, saisie par l'utilisateur (aucun calcul automatique). */
    taxMinor: bigint("tax_minor", { mode: "number" }).notNull().default(0),
    occurredOn: date("occurred_on").notNull(),
    categoryId: uuid("category_id"),
    supplierId: uuid("supplier_id"),
    contactId: uuid("contact_id"),
    description: text("description").notNull(),
    reference: text("reference"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    voidedAt: timestamp("voided_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("finance_entry_idx").on(t.companyId, t.occurredOn),
    unique("finance_entry_company_id_id").on(t.companyId, t.id),
    foreignKey({ columns: [t.companyId, t.accountId], foreignColumns: [financeAccount.companyId, financeAccount.id] }),
    foreignKey({ columns: [t.companyId, t.categoryId], foreignColumns: [financeCategory.companyId, financeCategory.id] }),
    foreignKey({ columns: [t.companyId, t.supplierId], foreignColumns: [supplier.companyId, supplier.id] }),
    foreignKey({ columns: [t.companyId, t.contactId], foreignColumns: [contact.companyId, contact.id] }),
  ],
);

/** Justificatifs : le fichier est dans le stockage privé, jamais servi sans contrôle d'accès. */
export const attachment = pgTable(
  "attachment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    entryId: uuid("entry_id").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    uploadedBy: text("uploaded_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("attachment_entry_idx").on(t.companyId, t.entryId),
    foreignKey({ columns: [t.companyId, t.entryId], foreignColumns: [financeEntry.companyId, financeEntry.id] }),
  ],
);

/* ---------- Invitations ---------- */

/** Le jeton n'est jamais stocké : seule son empreinte SHA-256 l'est. Usage unique, expiration, révocable. */
export const invitation = pgTable(
  "invitation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    /** Toujours en minuscules. */
    email: text("email").notNull(),
    role: roleEnum("role").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: text("invited_by").references(() => user.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at").notNull(),
    acceptedAt: timestamp("accepted_at"),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("invitation_company_idx").on(t.companyId)],
);

/* ---------- Limitation de débit applicative ---------- */

/** Compteurs à fenêtre fixe pour les actions sensibles (hors authentification, gérée par Better Auth). Non lié à une entreprise. */
export const appRateLimit = pgTable("app_rate_limit", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
  count: integer("count").notNull().default(0),
});

/* ---------- Comptabilité en partie double ---------- */

export const accountTypeEnum = pgEnum("account_type", ["asset", "liability", "equity", "revenue", "expense"]);
export const journalKindEnum = pgEnum("journal_kind", ["sales", "purchases", "treasury", "misc"]);
export const periodStatusEnum = pgEnum("period_status", ["open", "closed"]);
export const entryStatusEnum = pgEnum("journal_entry_status", ["draft", "posted"]);

/**
 * Plan de comptes de l'entreprise. Aucun plan réglementaire n'est fourni avec le produit : l'entreprise (ou son comptable)
 * saisit ou importe celui de son référentiel. Le type détermine le sens normal du solde.
 */
export const ledgerAccount = pgTable(
  "ledger_account",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: accountTypeEnum("type").notNull(),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [unique("ledger_account_company_id_id").on(t.companyId, t.id), unique("ledger_account_code").on(t.companyId, t.code)],
);

export const journal = pgTable(
  "journal",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    kind: journalKindEnum("kind").notNull(),
    archivedAt: timestamp("archived_at"),
  },
  (t) => [unique("journal_company_id_id").on(t.companyId, t.id), unique("journal_code").on(t.companyId, t.code)],
);

/** Exercices / périodes. Sans chevauchement (contrainte d'exclusion) ; une période clôturée verrouille les écritures. */
export const fiscalPeriod = pgTable(
  "fiscal_period",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    status: periodStatusEnum("status").notNull().default("open"),
    closedAt: timestamp("closed_at"),
    closedBy: text("closed_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [unique("fiscal_period_company_id_id").on(t.companyId, t.id)],
);

export const journalEntry = pgTable(
  "journal_entry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    journalId: uuid("journal_id").notNull(),
    periodId: uuid("period_id"),
    entryDate: date("entry_date").notNull(),
    /** Attribué à la validation, sans trou, par journal et par année. */
    number: text("number"),
    description: text("description").notNull(),
    status: entryStatusEnum("status").notNull().default("draft"),
    /** manual | invoice | credit_note | payment | expense | income | reversal | opening */
    sourceType: text("source_type").notNull().default("manual"),
    sourceId: uuid("source_id"),
    reversalOfId: uuid("reversal_of_id"),
    postedAt: timestamp("posted_at"),
    postedBy: text("posted_by").references(() => user.id, { onDelete: "set null" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("journal_entry_idx").on(t.companyId, t.entryDate),
    unique("journal_entry_company_id_id").on(t.companyId, t.id),
    unique("journal_entry_number").on(t.companyId, t.journalId, t.number),
    foreignKey({ columns: [t.companyId, t.journalId], foreignColumns: [journal.companyId, journal.id] }),
    foreignKey({ columns: [t.companyId, t.periodId], foreignColumns: [fiscalPeriod.companyId, fiscalPeriod.id] }),
    foreignKey({ columns: [t.companyId, t.reversalOfId], foreignColumns: [t.companyId, t.id] }),
  ],
);

export const journalLine = pgTable(
  "journal_line",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    entryId: uuid("entry_id").notNull(),
    position: integer("position").notNull(),
    accountId: uuid("account_id").notNull(),
    debitMinor: bigint("debit_minor", { mode: "number" }).notNull().default(0),
    creditMinor: bigint("credit_minor", { mode: "number" }).notNull().default(0),
    description: text("description"),
    /** Tiers (comptabilité auxiliaire) */
    contactId: uuid("contact_id"),
    supplierId: uuid("supplier_id"),
  },
  (t) => [
    index("journal_line_account_idx").on(t.companyId, t.accountId),
    foreignKey({ columns: [t.companyId, t.entryId], foreignColumns: [journalEntry.companyId, journalEntry.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.companyId, t.accountId], foreignColumns: [ledgerAccount.companyId, ledgerAccount.id] }),
    foreignKey({ columns: [t.companyId, t.contactId], foreignColumns: [contact.companyId, contact.id] }),
    foreignKey({ columns: [t.companyId, t.supplierId], foreignColumns: [supplier.companyId, supplier.id] }),
  ],
);

export const entryCounter = pgTable(
  "entry_counter",
  {
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    journalId: uuid("journal_id").notNull(),
    /** Année du numéro (« VT-2026-000001 ») : le compteur repart à 1 chaque année, quel que soit le nombre de périodes. */
    year: integer("year").notNull(),
    last: integer("last").notNull().default(0),
  },
  (t) => [unique("entry_counter_key").on(t.companyId, t.journalId, t.year)],
);

/** Activation et correspondances pour la comptabilisation automatique des ventes et des finances. */
export const accountingSettings = pgTable(
  "accounting_settings",
  {
    companyId: uuid("company_id")
      .primaryKey()
      .references(() => company.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    /** Seuls les documents et opérations datés à partir de ce jour sont comptabilisés automatiquement. */
    enabledFrom: date("enabled_from"),
    receivableAccountId: uuid("receivable_account_id"),
    revenueAccountId: uuid("revenue_account_id"),
    taxCollectedAccountId: uuid("tax_collected_account_id"),
    taxDeductibleAccountId: uuid("tax_deductible_account_id"),
    expenseAccountId: uuid("expense_account_id"),
    otherIncomeAccountId: uuid("other_income_account_id"),
    salesJournalId: uuid("sales_journal_id"),
    purchasesJournalId: uuid("purchases_journal_id"),
    treasuryJournalId: uuid("treasury_journal_id"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => {
    const acc = (c: typeof t.receivableAccountId) => foreignKey({ columns: [t.companyId, c], foreignColumns: [ledgerAccount.companyId, ledgerAccount.id] });
    const jr = (c: typeof t.salesJournalId) => foreignKey({ columns: [t.companyId, c], foreignColumns: [journal.companyId, journal.id] });
    return [
      acc(t.receivableAccountId),
      acc(t.revenueAccountId),
      acc(t.taxCollectedAccountId),
      acc(t.taxDeductibleAccountId),
      acc(t.expenseAccountId),
      acc(t.otherIncomeAccountId),
      jr(t.salesJournalId),
      jr(t.purchasesJournalId),
      jr(t.treasuryJournalId),
    ];
  },
);

/* ---------- Fiscalité : règles versionnées et suivi des obligations ---------- */

export const rulesetStatusEnum = pgEnum("ruleset_status", ["draft", "validated", "retired"]);

/**
 * Règles réglementaires par juridiction (données de plateforme, pas de l'entreprise). Aucune règle n'est livrée avec le produit :
 * une règle n'est utilisable qu'une fois « validated » (source citée, validateur et date), et reste immuable ensuite — un
 * changement de règle est une nouvelle version avec ses propres dates de validité, l'historique n'est jamais réécrit.
 */
export const ruleset = pgTable(
  "ruleset",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jurisdiction: text("jurisdiction").notNull(), // ISO 3166-1 alpha-2
    kind: text("kind").notNull(), // tax | chart_of_accounts | numbering | invoice_mentions …
    code: text("code").notNull(),
    name: text("name").notNull(),
    version: integer("version").notNull(),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    status: rulesetStatusEnum("status").notNull().default("draft"),
    sourceReference: text("source_reference"),
    validatedBy: text("validated_by"),
    validatedAt: timestamp("validated_at"),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [unique("ruleset_version").on(t.jurisdiction, t.kind, t.code, t.version)],
);

/** Situation fiscale déclarée par l'entreprise (saisie libre, non interprétée tant qu'aucune règle validée n'existe). */
export const companyTaxProfile = pgTable("company_tax_profile", {
  companyId: uuid("company_id")
    .primaryKey()
    .references(() => company.id, { onDelete: "cascade" }),
  regimeLabel: text("regime_label"),
  vatRegistered: boolean("vat_registered"),
  filingFrequency: text("filing_frequency"),
  notes: text("notes"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const obligationStatusEnum = pgEnum("obligation_status", ["todo", "filed", "paid", "not_applicable"]);

/** Échéance fiscale suivie par l'entreprise (saisie manuelle ou issue d'une règle validée). */
export const taxObligation = pgTable(
  "tax_obligation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    authority: text("authority"),
    periodLabel: text("period_label"),
    dueDate: date("due_date").notNull(),
    status: obligationStatusEnum("status").notNull().default("todo"),
    notes: text("notes"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("tax_obligation_idx").on(t.companyId, t.dueDate), unique("tax_obligation_company_id_id").on(t.companyId, t.id)],
);

/** Historique des déclarations et paiements (ajout seul). */
export const taxEvent = pgTable(
  "tax_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    obligationId: uuid("obligation_id").notNull(),
    kind: text("kind").notNull(), // filed | paid | note
    occurredOn: date("occurred_on").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }),
    reference: text("reference"),
    notes: text("notes"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [foreignKey({ columns: [t.companyId, t.obligationId], foreignColumns: [taxObligation.companyId, taxObligation.id] })],
);

/* ---------- Abonnements et administration de la plateforme ---------- */

export const planIntervalEnum = pgEnum("plan_interval", ["month", "year"]);
export const subscriptionStatusEnum = pgEnum("subscription_status", ["trialing", "active", "past_due", "expired"]);
export const billingInvoiceStatusEnum = pgEnum("billing_invoice_status", ["open", "paid", "void"]);

/**
 * Offres commerciales (données de plateforme). Aucune n'est livrée : les prix et les limites sont décidés par l'opérateur.
 * `limits` : { members, invoicesPerMonth, storageMb } — null ou absent = illimité. `modules` : crm, sales, finance, accounting, tax.
 */
export const plan = pgTable(
  "plan",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    currency: text("currency").notNull(),
    priceMinor: bigint("price_minor", { mode: "number" }).notNull().default(0),
    interval: planIntervalEnum("interval").notNull().default("month"),
    trialDays: integer("trial_days").notNull().default(0),
    limits: jsonb("limits").notNull().default({}),
    modules: text("modules").array().notNull().default([]),
    isPublic: boolean("is_public").notNull().default(true),
    /** Attribuée automatiquement aux nouvelles entreprises (une seule). */
    isDefault: boolean("is_default").notNull().default(false),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
);

/**
 * Abonnement d'une entreprise. `planId` est l'offre facturée aux prochains renouvellements. L'accès, lui, se déduit de la période d'essai
 * ou de la facture payée qui couvre la date du jour : il ne dépend d'aucune tâche planifiée. `status` n'est qu'un cache pour l'administration.
 */
export const subscription = pgTable("subscription", {
  companyId: uuid("company_id")
    .primaryKey()
    .references(() => company.id, { onDelete: "cascade" }),
  planId: uuid("plan_id")
    .notNull()
    .references(() => plan.id),
  /** Dernier statut matérialisé ; le statut effectif se calcule (voir core/entitlements). */
  status: subscriptionStatusEnum("status").notNull(),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  suspendedReason: text("suspended_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** Factures émises par la plateforme à ses clients (abonnements). Montants figés à l'émission. */
export const billingInvoice = pgTable(
  "billing_invoice",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plan.id),
    number: text("number").notNull().unique(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    status: billingInvoiceStatusEnum("status").notNull().default("open"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    paymentMethod: text("payment_method"),
    paymentReference: text("payment_reference"),
    provider: text("provider"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("billing_invoice_company_idx").on(t.companyId, t.issuedAt)],
);

/** Idempotence des webhooks : un événement de prestataire n'est traité qu'une fois. */
export const billingEvent = pgTable(
  "billing_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    receivedAt: timestamp("received_at").notNull().defaultNow(),
    payload: jsonb("payload").notNull(),
  },
  (t) => [unique("billing_event_unique").on(t.provider, t.eventId)],
);

export const platformCounter = pgTable("platform_counter", {
  key: text("key").primaryKey(),
  last: integer("last").notNull().default(0),
});

/** Réglages uniques de la plateforme (ligne id = 1). */
export const platformSettings = pgTable("platform_settings", {
  id: integer("id").primaryKey().default(1),
  billingEnabled: boolean("billing_enabled").notNull().default(false),
  paymentInstructions: text("payment_instructions"),
  graceDays: integer("grace_days").notNull().default(7),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** Journal d'audit de la plateforme (actions des opérateurs), en ajout seul. */
export const platformAuditLog = pgTable(
  "platform_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("platform_audit_idx").on(t.createdAt)],
);
