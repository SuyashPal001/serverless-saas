CREATE TYPE "public"."document_check_status" AS ENUM('pass', 'fail', 'flagged');--> statement-breakpoint
CREATE TYPE "public"."document_check_type" AS ENUM('structural', 'clause_conflict');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bidder_technical_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tender_id" uuid NOT NULL,
	"bidder_id" uuid NOT NULL,
	"technical_score" numeric NOT NULL,
	"breakdown" jsonb DEFAULT '[]' NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
ALTER TABLE "prebid_queries" ALTER COLUMN "status" SET DEFAULT 'received';--> statement-breakpoint
ALTER TABLE "corrigenda" ADD COLUMN "rfp_version_before" integer;--> statement-breakpoint
ALTER TABLE "corrigenda" ADD COLUMN "rfp_version_after" integer;--> statement-breakpoint
ALTER TABLE "corrigenda" ADD COLUMN "query_id" uuid;--> statement-breakpoint
ALTER TABLE "prebid_queries" ADD COLUMN "raised_by" text;--> statement-breakpoint
ALTER TABLE "tender_clauses" ADD COLUMN "source" text DEFAULT 'ingested' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenders" ADD COLUMN "scoring_config" jsonb DEFAULT '{}';--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bidder_technical_scores" ADD CONSTRAINT "bidder_technical_scores_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bidder_technical_scores" ADD CONSTRAINT "bidder_technical_scores_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bidder_technical_scores" ADD CONSTRAINT "bidder_technical_scores_bidder_id_bidders_id_fk" FOREIGN KEY ("bidder_id") REFERENCES "public"."bidders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
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
CREATE INDEX IF NOT EXISTS "idx_bts_tender" ON "bidder_technical_scores" USING btree ("tender_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_document_checks_tender" ON "document_checks" USING btree ("tender_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "corrigenda" ADD CONSTRAINT "corrigenda_query_id_prebid_queries_id_fk" FOREIGN KEY ("query_id") REFERENCES "public"."prebid_queries"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
