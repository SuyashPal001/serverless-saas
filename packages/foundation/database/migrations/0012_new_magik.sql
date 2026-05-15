ALTER TABLE "conversation_metrics" ADD COLUMN "input_tokens" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "conversation_metrics" ADD COLUMN "output_tokens" integer DEFAULT 0;