CREATE TYPE "public"."entry_kind" AS ENUM('income', 'expense');--> statement-breakpoint
CREATE TABLE "attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"uploaded_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "attachment_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "finance_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'bank' NOT NULL,
	"currency" text NOT NULL,
	"opening_balance_minor" bigint DEFAULT 0 NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "finance_account_company_id_id" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "finance_category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" "entry_kind" NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp,
	CONSTRAINT "finance_category_company_id_id" UNIQUE("company_id","id"),
	CONSTRAINT "finance_category_name" UNIQUE("company_id","kind","name")
);
--> statement-breakpoint
CREATE TABLE "finance_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" "entry_kind" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"occurred_on" date NOT NULL,
	"category_id" uuid,
	"supplier_id" uuid,
	"contact_id" uuid,
	"description" text NOT NULL,
	"reference" text,
	"created_by" text,
	"voided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "finance_entry_company_id_id" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "supplier" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"address" text,
	"tax_id" text,
	"notes" text,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_company_id_id" UNIQUE("company_id","id")
);
--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_company_id_entry_id_finance_entry_company_id_id_fk" FOREIGN KEY ("company_id","entry_id") REFERENCES "public"."finance_entry"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_account" ADD CONSTRAINT "finance_account_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_category" ADD CONSTRAINT "finance_category_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_entry" ADD CONSTRAINT "finance_entry_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_entry" ADD CONSTRAINT "finance_entry_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_entry" ADD CONSTRAINT "finance_entry_company_id_account_id_finance_account_company_id_id_fk" FOREIGN KEY ("company_id","account_id") REFERENCES "public"."finance_account"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_entry" ADD CONSTRAINT "finance_entry_company_id_category_id_finance_category_company_id_id_fk" FOREIGN KEY ("company_id","category_id") REFERENCES "public"."finance_category"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_entry" ADD CONSTRAINT "finance_entry_company_id_supplier_id_supplier_company_id_id_fk" FOREIGN KEY ("company_id","supplier_id") REFERENCES "public"."supplier"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_entry" ADD CONSTRAINT "finance_entry_company_id_contact_id_contact_company_id_id_fk" FOREIGN KEY ("company_id","contact_id") REFERENCES "public"."contact"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachment_entry_idx" ON "attachment" USING btree ("company_id","entry_id");--> statement-breakpoint
CREATE INDEX "finance_entry_idx" ON "finance_entry" USING btree ("company_id","occurred_on");--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_company_id_account_id_finance_account_company_id_id_fk" FOREIGN KEY ("company_id","account_id") REFERENCES "public"."finance_account"("company_id","id") ON DELETE no action ON UPDATE no action;