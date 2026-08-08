CREATE TYPE "public"."approval_resource_type" AS ENUM('contract');--> statement-breakpoint
CREATE TYPE "public"."approval_step_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tender_approval_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tender_id" uuid NOT NULL,
	"resource_type" "approval_resource_type" NOT NULL,
	"resource_id" uuid NOT NULL,
	"step_order" integer NOT NULL,
	"approver_role" text NOT NULL,
	"status" "approval_step_status" DEFAULT 'pending' NOT NULL,
	"actor_id" uuid,
	"comment" text,
	"signature_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actioned_at" timestamp with time zone,
	CONSTRAINT "tender_approval_steps_resource_step_unique" UNIQUE("resource_type","resource_id","step_order")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tender_approval_steps" ADD CONSTRAINT "tender_approval_steps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tender_approval_steps" ADD CONSTRAINT "tender_approval_steps_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tender_approval_steps" ADD CONSTRAINT "tender_approval_steps_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tender_approval_steps_tender" ON "tender_approval_steps" USING btree ("tender_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tender_approval_steps_resource" ON "tender_approval_steps" USING btree ("resource_type","resource_id");