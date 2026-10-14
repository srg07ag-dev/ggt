CREATE TYPE "public"."account_type" AS ENUM('asset', 'liability', 'equity', 'revenue', 'expense');--> statement-breakpoint
CREATE TYPE "public"."journal_entry_status" AS ENUM('draft', 'posted');--> statement-breakpoint
CREATE TYPE "public"."journal_kind" AS ENUM('sales', 'purchases', 'treasury', 'misc');--> statement-breakpoint
CREATE TYPE "public"."obligation_status" AS ENUM('todo', 'filed', 'paid', 'not_applicable');--> statement-breakpoint
CREATE TYPE "public"."period_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."ruleset_status" AS ENUM('draft', 'validated', 'retired');--> statement-breakpoint
CREATE TABLE "accounting_settings" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"enabled_from" date,
	"receivable_account_id" uuid,
	"revenue_account_id" uuid,
	"tax_collected_account_id" uuid,
	"tax_deductible_account_id" uuid,
	"expense_account_id" uuid,
	"other_income_account_id" uuid,
	"sales_journal_id" uuid,
	"purchases_journal_id" uuid,
	"treasury_journal_id" uuid,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_tax_profile" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"regime_label" text,
	"vat_registered" boolean,
	"filing_frequency" text,
	"notes" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entry_counter" (
	"company_id" uuid NOT NULL,
	"journal_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"last" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "entry_counter_key" UNIQUE("company_id","journal_id","year")
);
--> statement-breakpoint
CREATE TABLE "fiscal_period" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" "period_status" DEFAULT 'open' NOT NULL,
	"closed_at" timestamp,
	"closed_by" text,
	CONSTRAINT "fiscal_period_company_id_id" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "journal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" "journal_kind" NOT NULL,
	"archived_at" timestamp,
	CONSTRAINT "journal_company_id_id" UNIQUE("company_id","id"),
	CONSTRAINT "journal_code" UNIQUE("company_id","code")
);
--> statement-breakpoint
CREATE TABLE "journal_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"journal_id" uuid NOT NULL,
	"period_id" uuid,
	"entry_date" date NOT NULL,
	"number" text,
	"description" text NOT NULL,
	"status" "journal_entry_status" DEFAULT 'draft' NOT NULL,
	"source_type" text DEFAULT 'manual' NOT NULL,
	"source_id" uuid,
	"reversal_of_id" uuid,
	"posted_at" timestamp,
	"posted_by" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entry_company_id_id" UNIQUE("company_id","id"),
	CONSTRAINT "journal_entry_number" UNIQUE("company_id","journal_id","number")
);
--> statement-breakpoint
CREATE TABLE "journal_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"account_id" uuid NOT NULL,
	"debit_minor" bigint DEFAULT 0 NOT NULL,
	"credit_minor" bigint DEFAULT 0 NOT NULL,
	"description" text,
	"contact_id" uuid,
	"supplier_id" uuid
);
--> statement-breakpoint
CREATE TABLE "ledger_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" "account_type" NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_account_company_id_id" UNIQUE("company_id","id"),
	CONSTRAINT "ledger_account_code" UNIQUE("company_id","code")
);
--> statement-breakpoint
CREATE TABLE "ruleset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction" text NOT NULL,
	"kind" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"version" integer NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"status" "ruleset_status" DEFAULT 'draft' NOT NULL,
	"source_reference" text,
	"validated_by" text,
	"validated_at" timestamp,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ruleset_version" UNIQUE("jurisdiction","kind","code","version")
);
--> statement-breakpoint
CREATE TABLE "tax_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"obligation_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"occurred_on" date NOT NULL,
	"amount_minor" bigint,
	"reference" text,
	"notes" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_obligation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"title" text NOT NULL,
	"authority" text,
	"period_label" text,
	"due_date" date NOT NULL,
	"status" "obligation_status" DEFAULT 'todo' NOT NULL,
	"notes" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tax_obligation_company_id_id" UNIQUE("company_id","id")
);
--> statement-breakpoint
ALTER TABLE "finance_account" ADD COLUMN "ledger_account_id" uuid;--> statement-breakpoint
ALTER TABLE "finance_category" ADD COLUMN "ledger_account_id" uuid;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "revenue_account_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_line" ADD COLUMN "tax_rate_id" uuid;--> statement-breakpoint
ALTER TABLE "tax_rate" ADD COLUMN "ledger_account_id" uuid;--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_company_id_receivable_account_id_ledger_account_company_id_id_fk" FOREIGN KEY ("company_id","receivable_account_id") REFERENCES "public"."ledger_account"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_company_id_revenue_account_id_ledger_account_company_id_id_fk" FOREIGN KEY ("company_id","revenue_account_id") REFERENCES "public"."ledger_account"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_company_id_tax_collected_account_id_ledger_account_company_id_id_fk" FOREIGN KEY ("company_id","tax_collected_account_id") REFERENCES "public"."ledger_account"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_company_id_tax_deductible_account_id_ledger_account_company_id_id_fk" FOREIGN KEY ("company_id","tax_deductible_account_id") REFERENCES "public"."ledger_account"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_company_id_expense_account_id_ledger_account_company_id_id_fk" FOREIGN KEY ("company_id","expense_account_id") REFERENCES "public"."ledger_account"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_company_id_other_income_account_id_ledger_account_company_id_id_fk" FOREIGN KEY ("company_id","other_income_account_id") REFERENCES "public"."ledger_account"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_company_id_sales_journal_id_journal_company_id_id_fk" FOREIGN KEY ("company_id","sales_journal_id") REFERENCES "public"."journal"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_company_id_purchases_journal_id_journal_company_id_id_fk" FOREIGN KEY ("company_id","purchases_journal_id") REFERENCES "public"."journal"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_settings" ADD CONSTRAINT "accounting_settings_company_id_treasury_journal_id_journal_company_id_id_fk" FOREIGN KEY ("company_id","treasury_journal_id") REFERENCES "public"."journal"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_tax_profile" ADD CONSTRAINT "company_tax_profile_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_counter" ADD CONSTRAINT "entry_counter_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_period" ADD CONSTRAINT "fiscal_period_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_period" ADD CONSTRAINT "fiscal_period_closed_by_user_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal" ADD CONSTRAINT "journal_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_posted_by_user_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_company_id_journal_id_journal_company_id_id_fk" FOREIGN KEY ("company_id","journal_id") REFERENCES "public"."journal"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_company_id_period_id_fiscal_period_company_id_id_fk" FOREIGN KEY ("company_id","period_id") REFERENCES "public"."fiscal_period"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_company_id_reversal_of_id_journal_entry_company_id_id_fk" FOREIGN KEY ("company_id","reversal_of_id") REFERENCES "public"."journal_entry"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_company_id_entry_id_journal_entry_company_id_id_fk" FOREIGN KEY ("company_id","entry_id") REFERENCES "public"."journal_entry"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_company_id_account_id_ledger_account_company_id_id_fk" FOREIGN KEY ("company_id","account_id") REFERENCES "public"."ledger_account"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_company_id_contact_id_contact_company_id_id_fk" FOREIGN KEY ("company_id","contact_id") REFERENCES "public"."contact"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_company_id_supplier_id_supplier_company_id_id_fk" FOREIGN KEY ("company_id","supplier_id") REFERENCES "public"."supplier"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_account" ADD CONSTRAINT "ledger_account_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_event" ADD CONSTRAINT "tax_event_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_event" ADD CONSTRAINT "tax_event_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_event" ADD CONSTRAINT "tax_event_company_id_obligation_id_tax_obligation_company_id_id_fk" FOREIGN KEY ("company_id","obligation_id") REFERENCES "public"."tax_obligation"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_obligation" ADD CONSTRAINT "tax_obligation_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_obligation" ADD CONSTRAINT "tax_obligation_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journal_entry_idx" ON "journal_entry" USING btree ("company_id","entry_date");--> statement-breakpoint
CREATE INDEX "journal_line_account_idx" ON "journal_line" USING btree ("company_id","account_id");--> statement-breakpoint
CREATE INDEX "tax_obligation_idx" ON "tax_obligation" USING btree ("company_id","due_date");--> statement-breakpoint
ALTER TABLE "finance_account" ADD CONSTRAINT "finance_account_company_id_ledger_account_id_ledger_account_company_id_id_fk" FOREIGN KEY ("company_id","ledger_account_id") REFERENCES "public"."ledger_account"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_category" ADD CONSTRAINT "finance_category_company_id_ledger_account_id_ledger_account_company_id_id_fk" FOREIGN KEY ("company_id","ledger_account_id") REFERENCES "public"."ledger_account"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_company_id_revenue_account_id_ledger_account_company_id_id_fk" FOREIGN KEY ("company_id","revenue_account_id") REFERENCES "public"."ledger_account"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_line" ADD CONSTRAINT "sales_line_company_id_tax_rate_id_tax_rate_company_id_id_fk" FOREIGN KEY ("company_id","tax_rate_id") REFERENCES "public"."tax_rate"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rate" ADD CONSTRAINT "tax_rate_company_id_ledger_account_id_ledger_account_company_id_id_fk" FOREIGN KEY ("company_id","ledger_account_id") REFERENCES "public"."ledger_account"("company_id","id") ON DELETE no action ON UPDATE no action;