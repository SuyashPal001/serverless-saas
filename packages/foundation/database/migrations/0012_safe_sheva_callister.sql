ALTER TABLE "integrations" ALTER COLUMN "mcp_server_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD COLUMN "upvotes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD COLUMN "downvotes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD COLUMN "links" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD COLUMN "attachment_file_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD COLUMN "sort_order" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "tsv" "tsvector";