CREATE TYPE "public"."proposal_status" AS ENUM('draft', 'finalized');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tender_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tender_id" uuid NOT NULL,
	"status" "proposal_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"exec_summary" text NOT NULL,
	"compliance_matrix" jsonb DEFAULT '[]' NOT NULL,
	"price_comparison" jsonb DEFAULT '{}' NOT NULL,
	"rejection_grounds" jsonb DEFAULT '[]' NOT NULL,
	"recommendation" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tender_proposals" ADD CONSTRAINT "tender_proposals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tender_proposals" ADD CONSTRAINT "tender_proposals_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tender_proposals_tender" ON "tender_proposals" USING btree ("tender_id");
