ALTER TABLE "prebid_queries" ADD COLUMN IF NOT EXISTS "raised_by" text;
ALTER TABLE "prebid_queries" ALTER COLUMN "status" SET DEFAULT 'received';

CREATE TABLE IF NOT EXISTS "corrigenda" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tender_id" uuid NOT NULL REFERENCES "tenders"("id") ON DELETE CASCADE,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "corrigendum_no" text NOT NULL,
  "changes_summary" text NOT NULL,
  "changed_clauses" jsonb NOT NULL DEFAULT '[]',
  "rfp_version_before" integer,
  "rfp_version_after" integer,
  "query_id" uuid REFERENCES "prebid_queries"("id"),
  "issued_at" timestamp with time zone NOT NULL DEFAULT now()
);
