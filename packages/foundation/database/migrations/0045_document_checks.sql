CREATE TYPE "public"."document_check_status" AS ENUM('pass', 'fail', 'flagged');--> statement-breakpoint
CREATE TYPE "public"."document_check_type" AS ENUM('structural', 'clause_conflict');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tender_id" uuid NOT NULL,
	"check_type" "document_check_type" NOT NULL,
	"rule_id" text NOT NULL,
	"status" "document_check_status" NOT NULL,
	"section_no" text,
	"message" text NOT NULL,
	"detail" jsonb DEFAULT '{}',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_checks" ADD CONSTRAINT "document_checks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_checks" ADD CONSTRAINT "document_checks_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_document_checks_tender" ON "document_checks" USING btree ("tender_id");
