ALTER TABLE "agent_tasks" ADD COLUMN "description_html" text;--> statement-breakpoint
ALTER TABLE "task_comments" ADD COLUMN "content_html" text;--> statement-breakpoint
UPDATE "agent_tasks" SET "description_html" = "description" WHERE "description" IS NOT NULL;--> statement-breakpoint
UPDATE "task_comments" SET "content_html" = "content" WHERE "content" IS NOT NULL;
