ALTER TABLE "tenders" ADD COLUMN IF NOT EXISTS "scoring_config" jsonb DEFAULT '{}';

CREATE TABLE IF NOT EXISTS "bidder_technical_scores" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "tender_id" uuid NOT NULL REFERENCES "tenders"("id") ON DELETE CASCADE,
  "bidder_id" uuid NOT NULL REFERENCES "bidders"("id") ON DELETE CASCADE,
  "technical_score" numeric NOT NULL,
  "breakdown" jsonb NOT NULL DEFAULT '[]',
  "computed_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_bts_tender" ON "bidder_technical_scores" ("tender_id");
