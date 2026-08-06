DO $$ BEGIN
 ALTER TABLE "tender_proposals" ADD CONSTRAINT "tender_proposals_tender_id_version_unique" UNIQUE("tender_id","version");
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
