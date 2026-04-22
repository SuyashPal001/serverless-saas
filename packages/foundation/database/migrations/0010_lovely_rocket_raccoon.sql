CREATE TYPE "public"."task_event_actor_type" AS ENUM('agent', 'human', 'system');--> statement-breakpoint
CREATE TYPE "public"."task_event_type" AS ENUM('status_changed', 'step_completed', 'step_failed', 'clarification_requested', 'clarification_answered', 'plan_proposed', 'plan_approved', 'plan_rejected', 'task_cancelled', 'comment');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('backlog', 'ready', 'in_progress', 'review', 'blocked', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."task_step_status" AS ENUM('pending', 'running', 'done', 'skipped', 'failed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"acceptance_criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "task_status" DEFAULT 'backlog' NOT NULL,
	"estimated_hours" numeric(5, 2),
	"confidence_score" numeric(3, 2),
	"plan_approved_at" timestamp,
	"plan_approved_by" uuid,
	"blocked_reason" text,
	"cancel_reason" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_type" "task_event_actor_type" NOT NULL,
	"actor_id" text NOT NULL,
	"event_type" "task_event_type" NOT NULL,
	"payload" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"step_number" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"tool_name" text,
	"reasoning" text,
	"status" "task_step_status" DEFAULT 'pending' NOT NULL,
	"estimated_hours" numeric(4, 2),
	"confidence_score" numeric(3, 2),
	"human_feedback" text,
	"agent_output" text,
	"tool_args" jsonb,
	"tool_result" jsonb,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "knowledge_gaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"query" text NOT NULL,
	"conversation_id" uuid,
	"rag_score" numeric,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tool_call_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid,
	"user_id" uuid,
	"tool_name" text NOT NULL,
	"success" boolean NOT NULL,
	"latency_ms" integer,
	"error_message" text,
	"args" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_feedback" DROP CONSTRAINT IF EXISTS "conversation_feedback_message_id_user_id_unique";--> statement-breakpoint
ALTER TABLE "conversation_feedback" DROP CONSTRAINT IF EXISTS "conversation_feedback_message_id_messages_id_fk";
--> statement-breakpoint
ALTER TABLE "conversation_feedback" DROP CONSTRAINT IF EXISTS "conversation_feedback_conversation_id_conversations_id_fk";
--> statement-breakpoint
ALTER TABLE "conversation_feedback" DROP CONSTRAINT IF EXISTS "conversation_feedback_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "conversation_feedback" DROP CONSTRAINT IF EXISTS "conversation_feedback_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "conversation_metrics" DROP CONSTRAINT IF EXISTS "conversation_metrics_conversation_id_conversations_id_fk";
--> statement-breakpoint
ALTER TABLE "conversation_metrics" DROP CONSTRAINT IF EXISTS "conversation_metrics_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "eval_results" DROP CONSTRAINT IF EXISTS "eval_results_conversation_id_conversations_id_fk";
--> statement-breakpoint
ALTER TABLE "eval_results" DROP CONSTRAINT IF EXISTS "eval_results_message_id_messages_id_fk";
--> statement-breakpoint
ALTER TABLE "eval_results" DROP CONSTRAINT IF EXISTS "eval_results_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "conversation_feedback" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_feedback" ALTER COLUMN "rating" SET DATA TYPE varchar(4);--> statement-breakpoint
ALTER TABLE "conversation_feedback" ALTER COLUMN "created_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_metrics" ALTER COLUMN "rag_fired" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_metrics" ALTER COLUMN "rag_chunks_retrieved" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_metrics" ALTER COLUMN "total_tokens" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_metrics" ALTER COLUMN "user_message_count" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_metrics" ALTER COLUMN "created_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_results" ALTER COLUMN "score" SET DATA TYPE numeric(3, 2);--> statement-breakpoint
ALTER TABLE "eval_results" ALTER COLUMN "score" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_results" ALTER COLUMN "created_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pending_tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "brand_name" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "logo_url" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "brand_color" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "agent_display_name" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "avatar_url" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "description" text;--> statement-breakpoint
ALTER TABLE "conversation_metrics" ADD COLUMN IF NOT EXISTS "input_tokens" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "conversation_metrics" ADD COLUMN IF NOT EXISTS "output_tokens" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "conversation_metrics" ADD COLUMN IF NOT EXISTS "total_cost" numeric(10, 6) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "eval_results" ADD COLUMN IF NOT EXISTS "eval_type" varchar(20) NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_results" ADD COLUMN IF NOT EXISTS "model" varchar(100);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_plan_approved_by_users_id_fk" FOREIGN KEY ("plan_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_events" ADD CONSTRAINT "task_events_task_id_agent_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."agent_tasks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_events" ADD CONSTRAINT "task_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_steps" ADD CONSTRAINT "task_steps_task_id_agent_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."agent_tasks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task_steps" ADD CONSTRAINT "task_steps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "knowledge_gaps" ADD CONSTRAINT "knowledge_gaps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "knowledge_gaps" ADD CONSTRAINT "knowledge_gaps_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tool_call_logs" ADD CONSTRAINT "tool_call_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tool_call_logs" ADD CONSTRAINT "tool_call_logs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tool_call_logs" ADD CONSTRAINT "tool_call_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_tasks_tenant_status_idx" ON "agent_tasks" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_tasks_tenant_agent_idx" ON "agent_tasks" USING btree ("tenant_id","agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_tasks_tenant_created_by_idx" ON "agent_tasks" USING btree ("tenant_id","created_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_events_task_created_at_idx" ON "task_events" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_events_tenant_event_type_idx" ON "task_events" USING btree ("tenant_id","event_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_steps_task_id_idx" ON "task_steps" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_steps_tenant_status_idx" ON "task_steps" USING btree ("tenant_id","status");--> statement-breakpoint
ALTER TABLE "conversation_metrics" DROP COLUMN IF EXISTS "total_cost_cents";--> statement-breakpoint
ALTER TABLE "conversation_metrics" DROP COLUMN IF EXISTS "updated_at";--> statement-breakpoint
ALTER TABLE "eval_results" DROP COLUMN IF EXISTS "dimension";--> statement-breakpoint
DROP TYPE "public"."eval_dimension";--> statement-breakpoint
DROP TYPE "public"."feedback_rating";