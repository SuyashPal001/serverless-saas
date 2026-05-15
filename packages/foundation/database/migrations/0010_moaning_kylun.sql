ALTER TABLE "conversation_feedback" DROP CONSTRAINT "conversation_feedback_message_id_user_id_unique";--> statement-breakpoint
ALTER TABLE "conversation_feedback" DROP CONSTRAINT "conversation_feedback_message_id_messages_id_fk";
--> statement-breakpoint
ALTER TABLE "conversation_feedback" DROP CONSTRAINT "conversation_feedback_conversation_id_conversations_id_fk";
--> statement-breakpoint
ALTER TABLE "conversation_feedback" DROP CONSTRAINT "conversation_feedback_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "conversation_feedback" DROP CONSTRAINT "conversation_feedback_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "conversation_metrics" DROP CONSTRAINT "conversation_metrics_conversation_id_conversations_id_fk";
--> statement-breakpoint
ALTER TABLE "conversation_metrics" DROP CONSTRAINT "conversation_metrics_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "eval_results" DROP CONSTRAINT "eval_results_conversation_id_conversations_id_fk";
--> statement-breakpoint
ALTER TABLE "eval_results" DROP CONSTRAINT "eval_results_message_id_messages_id_fk";
--> statement-breakpoint
ALTER TABLE "eval_results" DROP CONSTRAINT "eval_results_tenant_id_tenants_id_fk";
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
ALTER TABLE "users" ADD COLUMN "pending_tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "brand_name" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "logo_url" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "brand_color" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "agent_display_name" text;--> statement-breakpoint
ALTER TABLE "conversation_metrics" ADD COLUMN "total_cost" numeric(10, 6) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "eval_results" ADD COLUMN "eval_type" varchar(20) NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_results" ADD COLUMN "model" varchar(100);--> statement-breakpoint
ALTER TABLE "conversation_metrics" DROP COLUMN IF EXISTS "total_cost_cents";--> statement-breakpoint
ALTER TABLE "conversation_metrics" DROP COLUMN IF EXISTS "updated_at";--> statement-breakpoint
ALTER TABLE "eval_results" DROP COLUMN IF EXISTS "dimension";--> statement-breakpoint
DROP TYPE "public"."eval_dimension";--> statement-breakpoint
DROP TYPE "public"."feedback_rating";