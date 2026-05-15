CREATE TYPE "public"."agent_tool_stakes" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_tools" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" uuid,
    "name" text NOT NULL,
    "display_name" text NOT NULL,
    "description" text,
    "provider" text,
    "parameters_schema" jsonb,
    "stakes" "agent_tool_stakes" DEFAULT 'low' NOT NULL,
    "requires_approval" boolean DEFAULT false NOT NULL,
    "max_retries" integer DEFAULT 1 NOT NULL,
    "timeout_ms" integer DEFAULT 30000 NOT NULL,
    "status" text DEFAULT 'active' NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_tool_assignments" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "agent_id" uuid NOT NULL,
    "tool_id" uuid NOT NULL,
    "tenant_id" uuid NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_tool_assignments" ADD CONSTRAINT "agent_tool_assignments_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_tool_assignments" ADD CONSTRAINT "agent_tool_assignments_tool_id_agent_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."agent_tools"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_tool_assignments" ADD CONSTRAINT "agent_tool_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_tools" ADD CONSTRAINT "agent_tools_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_tool_assignments_unique" ON "agent_tool_assignments" USING btree ("agent_id","tool_id");
