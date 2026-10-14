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
    archivedAt: timestamp("archived_at"),
  },
  (t) => [unique("tax_rate_company_id_id").on(t.companyId, t.id)],
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
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("product_company_id_id").on(t.companyId, t.id),
    foreignKey({ columns: [t.companyId, t.taxRateId], foreignColumns: [taxRate.companyId, taxRate.id] }),
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
    taxRateBp: integer("tax_rate_bp").notNull().default(0),
    netMinor: bigint("net_minor", { mode: "number" }).notNull(),
    taxMinor: bigint("tax_minor", { mode: "number" }).notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.companyId, t.documentId], foreignColumns: [salesDocument.companyId, salesDocument.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.companyId, t.productId], foreignColumns: [product.companyId, product.id] }),
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
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [unique("finance_account_company_id_id").on(t.companyId, t.id)],
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
    archivedAt: timestamp("archived_at"),
  },
  (t) => [
    unique("finance_category_company_id_id").on(t.companyId, t.id),
    unique("finance_category_name").on(t.companyId, t.kind, t.name),
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
