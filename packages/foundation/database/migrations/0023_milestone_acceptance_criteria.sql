ALTER TABLE "project_milestones" ADD COLUMN "acceptance_criteria" jsonb NOT NULL DEFAULT '[]';--> statement-breakpoint
ALTER TABLE "project_milestones" ADD COLUMN "estimated_hours" numeric(6,2);
