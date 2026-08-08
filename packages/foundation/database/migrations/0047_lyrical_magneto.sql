CREATE TYPE "public"."rate_contract_type" AS ENUM('limited', 'framework', 'rate');--> statement-breakpoint
CREATE TYPE "public"."vendor_category" AS ENUM('cpsu', 'spsu', 'mse', 'self_help_group', 'govt_body', 'civil_contractor', 'other');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rate_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"contract_type" "rate_contract_type" NOT NULL,
	"terms" text,
	"pricing" jsonb DEFAULT '{}',
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vendors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" "vendor_category" DEFAULT 'other' NOT NULL,
	"country_of_origin" text,
	"contact_email" text,
	"contact_phone" text,
	"is_blacklisted" boolean DEFAULT false NOT NULL,
	"blacklist_reason" text,
	"blacklisted_at" timestamp with time zone,
	"is_oem_authorized" boolean DEFAULT false NOT NULL,
	"oem_products" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bidders" ADD COLUMN "vendor_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rate_contracts" ADD CONSTRAINT "rate_contracts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rate_contracts" ADD CONSTRAINT "rate_contracts_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendors" ADD CONSTRAINT "vendors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_rate_contracts_vendor" ON "rate_contracts" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_vendors_tenant" ON "vendors" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "bidders" ADD CONSTRAINT "bidders_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL;