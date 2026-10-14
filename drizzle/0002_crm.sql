CREATE TYPE "public"."activity_status" AS ENUM('todo', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."activity_type" AS ENUM('call', 'meeting', 'note', 'follow_up', 'deadline');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('low', 'normal', 'high');--> statement-breakpoint
CREATE TYPE "public"."stage_kind" AS ENUM('open', 'won', 'lost');--> statement-breakpoint
CREATE TABLE "activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid,
	"opportunity_id" uuid,
	"type" "activity_type" NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"priority" "priority" DEFAULT 'normal' NOT NULL,
	"status" "activity_status" DEFAULT 'todo' NOT NULL,
	"due_at" timestamp,
	"assignee_id" text,
	"created_by" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"title" text NOT NULL,
	"amount_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"probability" integer DEFAULT 10 NOT NULL,
	"expected_close" date,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "opportunity_company_id_id" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "pipeline_stage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"kind" "stage_kind" DEFAULT 'open' NOT NULL,
	CONSTRAINT "stage_company_id_id" UNIQUE("company_id","id")
);
--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "organization" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "tags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_company_id_id" UNIQUE("company_id","id");--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_company_id_contact_id_contact_company_id_id_fk" FOREIGN KEY ("company_id","contact_id") REFERENCES "public"."contact"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_company_id_opportunity_id_opportunity_company_id_id_fk" FOREIGN KEY ("company_id","opportunity_id") REFERENCES "public"."opportunity"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_company_id_assignee_id_membership_company_id_user_id_fk" FOREIGN KEY ("company_id","assignee_id") REFERENCES "public"."membership"("company_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_company_id_contact_id_contact_company_id_id_fk" FOREIGN KEY ("company_id","contact_id") REFERENCES "public"."contact"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_company_id_stage_id_pipeline_stage_company_id_id_fk" FOREIGN KEY ("company_id","stage_id") REFERENCES "public"."pipeline_stage"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stage" ADD CONSTRAINT "pipeline_stage_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_company_idx" ON "activity" USING btree ("company_id","status","due_at");--> statement-breakpoint
CREATE INDEX "opportunity_company_idx" ON "opportunity" USING btree ("company_id","stage_id");--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_company_id_parent_id_contact_company_id_id_fk" FOREIGN KEY ("company_id","parent_id") REFERENCES "public"."contact"("company_id","id") ON DELETE no action ON UPDATE no action;
