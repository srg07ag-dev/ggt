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
