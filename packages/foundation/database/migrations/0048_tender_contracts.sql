CREATE TYPE "public"."contract_status" AS ENUM('draft', 'finalized');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tender_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tender_id" uuid NOT NULL,
	"contractor_bidder_id" uuid NOT NULL,
	"status" "contract_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"contractor_name" text NOT NULL,
	"contractor_display_label" text NOT NULL,
	"contractor_contact_email" text,
	"contract_value" numeric NOT NULL,
	"sections" jsonb DEFAULT '[]' NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tender_contracts_tender_id_version_unique" UNIQUE("tender_id","version")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tender_contracts" ADD CONSTRAINT "tender_contracts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tender_contracts" ADD CONSTRAINT "tender_contracts_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tender_contracts" ADD CONSTRAINT "tender_contracts_contractor_bidder_id_bidders_id_fk" FOREIGN KEY ("contractor_bidder_id") REFERENCES "public"."bidders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tender_contracts_tender" ON "tender_contracts" USING btree ("tender_id");