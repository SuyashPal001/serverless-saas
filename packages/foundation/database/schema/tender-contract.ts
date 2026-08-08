import { pgTable, uuid, text, jsonb, timestamp, integer, numeric, pgEnum, index, unique } from 'drizzle-orm/pg-core';
import { tenants } from './tenancy';
import { tenders, bidders } from './tender';

export const contractStatusEnum = pgEnum('contract_status', ['draft', 'finalized']);

export const tenderContracts = pgTable('tender_contracts', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  tenantId:              uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  tenderId:              uuid('tender_id').notNull().references(() => tenders.id, { onDelete: 'cascade' }),
  contractorBidderId:    uuid('contractor_bidder_id').notNull().references(() => bidders.id),
  status:                contractStatusEnum('status').notNull().default('draft'),
  version:               integer('version').notNull().default(1),
  contractorName:        text('contractor_name').notNull(),
  contractorDisplayLabel: text('contractor_display_label').notNull(),
  contractorContactEmail: text('contractor_contact_email'),
  contractValue:         numeric('contract_value').notNull(),
  sections:              jsonb('sections').notNull().default('[]'), // ContractSection[]
  generatedAt:           timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenderIdx: index('idx_tender_contracts_tender').on(t.tenderId),
  tenderVersionUnique: unique('tender_contracts_tender_id_version_unique').on(t.tenderId, t.version),
}));
