CREATE TABLE IF NOT EXISTS "project_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_id" uuid,
	"parent_id" uuid,
	"owned_by" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"title" text NOT NULL DEFAULT 'Untitled',
	"description_html" text NOT NULL DEFAULT '<p></p>',
	"description_json" jsonb NOT NULL DEFAULT '{}',
	"description_stripped" text,
	"page_type" text NOT NULL DEFAULT 'custom',
	"source" text NOT NULL DEFAULT 'human',
	"source_ref_id" uuid,
	"access" smallint NOT NULL DEFAULT 0,
	"is_locked" boolean NOT NULL DEFAULT false,
	"is_global" boolean NOT NULL DEFAULT false,
	"archived_at" timestamptz,
	"sort_order" float NOT NULL DEFAULT 65535,
	"color" text,
	"logo_props" jsonb NOT NULL DEFAULT '{}',
	"document_id" uuid,
	"created_at" timestamptz NOT NULL DEFAULT now(),
	"updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_page_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"owned_by" uuid NOT NULL,
	"description_html" text NOT NULL DEFAULT '<p></p>',
	"description_json" jsonb NOT NULL DEFAULT '{}',
	"description_stripped" text,
	"last_saved_at" timestamptz NOT NULL DEFAULT now(),
	"created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_page_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"transaction" uuid NOT NULL DEFAULT gen_random_uuid(),
	"entity_name" text NOT NULL,
	"entity_identifier" uuid,
	"created_at" timestamptz NOT NULL DEFAULT now(),
	UNIQUE("page_id", "transaction")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_pages" ADD CONSTRAINT "project_pages_plan_id_project_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."project_plans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_pages" ADD CONSTRAINT "project_pages_parent_id_project_pages_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."project_pages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_pages" ADD CONSTRAINT "project_pages_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_page_versions" ADD CONSTRAINT "project_page_versions_page_id_project_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."project_pages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_page_logs" ADD CONSTRAINT "project_page_logs_page_id_project_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."project_pages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_project_pages_tenant" ON "project_pages" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_project_pages_plan" ON "project_pages" USING btree ("plan_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_project_pages_parent" ON "project_pages" USING btree ("parent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_project_pages_type" ON "project_pages" USING btree ("page_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_project_pages_source" ON "project_pages" USING btree ("source");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_page_versions_page" ON "project_page_versions" USING btree ("page_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_page_versions_saved" ON "project_page_versions" USING btree ("last_saved_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_page_logs_page" ON "project_page_logs" USING btree ("page_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_page_logs_entity" ON "project_page_logs" USING btree ("entity_identifier");
