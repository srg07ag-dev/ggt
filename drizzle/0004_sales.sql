CREATE TYPE "public"."doc_status" AS ENUM('draft', 'sent', 'accepted', 'declined', 'converted', 'issued');--> statement-breakpoint
CREATE TYPE "public"."doc_type" AS ENUM('quote', 'invoice', 'credit_note');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'bank_transfer', 'mobile_money', 'card', 'cheque', 'other');--> statement-breakpoint
CREATE TABLE "numbering" (
	"company_id" uuid NOT NULL,
	"doc_type" "doc_type" NOT NULL,
	"pattern" text NOT NULL,
	CONSTRAINT "numbering_company_type" UNIQUE("company_id","doc_type")
);
--> statement-breakpoint
CREATE TABLE "numbering_counter" (
	"company_id" uuid NOT NULL,
	"doc_type" "doc_type" NOT NULL,
	"period" text DEFAULT '' NOT NULL,
	"last" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "numbering_counter_key" UNIQUE("company_id","doc_type","period")
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"paid_on" date NOT NULL,
	"method" "payment_method" NOT NULL,
	"reference" text,
	"created_by" text,
	"voided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text DEFAULT 'service' NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"unit_price_minor" bigint DEFAULT 0 NOT NULL,
	"tax_rate_id" uuid,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "product_company_id_id" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "sales_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"type" "doc_type" NOT NULL,
	"status" "doc_status" DEFAULT 'draft' NOT NULL,
	"number" text,
	"contact_id" uuid NOT NULL,
	"related_id" uuid,
	"issue_date" date NOT NULL,
	"due_date" date,
	"currency" text NOT NULL,
	"subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"notes" text,
	"snapshot" jsonb,
	"created_by" text,
	"issued_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sales_document_company_id_id" UNIQUE("company_id","id"),
	CONSTRAINT "sales_document_number" UNIQUE("company_id","type","number")
);
--> statement-breakpoint
CREATE TABLE "sales_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"product_id" uuid,
	"description" text NOT NULL,
	"quantity_milli" integer NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"tax_name" text,
	"tax_rate_bp" integer DEFAULT 0 NOT NULL,
	"net_minor" bigint NOT NULL,
	"tax_minor" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_rate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"rate_bp" integer NOT NULL,
	"archived_at" timestamp,
	CONSTRAINT "tax_rate_company_id_id" UNIQUE("company_id","id")
);
--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "tax_id" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "numbering" ADD CONSTRAINT "numbering_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "numbering_counter" ADD CONSTRAINT "numbering_counter_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_company_id_invoice_id_sales_document_company_id_id_fk" FOREIGN KEY ("company_id","invoice_id") REFERENCES "public"."sales_document"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_company_id_tax_rate_id_tax_rate_company_id_id_fk" FOREIGN KEY ("company_id","tax_rate_id") REFERENCES "public"."tax_rate"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_document" ADD CONSTRAINT "sales_document_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_document" ADD CONSTRAINT "sales_document_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_document" ADD CONSTRAINT "sales_document_company_id_contact_id_contact_company_id_id_fk" FOREIGN KEY ("company_id","contact_id") REFERENCES "public"."contact"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_document" ADD CONSTRAINT "sales_document_company_id_related_id_sales_document_company_id_id_fk" FOREIGN KEY ("company_id","related_id") REFERENCES "public"."sales_document"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_line" ADD CONSTRAINT "sales_line_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_line" ADD CONSTRAINT "sales_line_company_id_document_id_sales_document_company_id_id_fk" FOREIGN KEY ("company_id","document_id") REFERENCES "public"."sales_document"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_line" ADD CONSTRAINT "sales_line_company_id_product_id_product_company_id_id_fk" FOREIGN KEY ("company_id","product_id") REFERENCES "public"."product"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rate" ADD CONSTRAINT "tax_rate_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_invoice_idx" ON "payment" USING btree ("company_id","invoice_id");--> statement-breakpoint
CREATE INDEX "sales_document_idx" ON "sales_document" USING btree ("company_id","type","status");