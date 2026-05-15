CREATE TYPE "public"."prd_content_type" AS ENUM('markdown', 'html');--> statement-breakpoint
CREATE TYPE "public"."prd_status" AS ENUM('draft', 'pending_approval', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_prds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"content_type" "prd_content_type" DEFAULT 'markdown' NOT NULL,
	"status" "prd_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_from_task_ids" uuid[],
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_prds" ADD CONSTRAINT "agent_prds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_prds" ADD CONSTRAINT "agent_prds_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_prds_tenant_agent_idx" ON "agent_prds" USING btree ("tenant_id","agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_prds_tenant_status_idx" ON "agent_prds" USING btree ("tenant_id","status");