import { pgTable, uuid, text, jsonb, timestamp, integer, pgEnum, index } from 'drizzle-orm/pg-core';
import { tenants } from './tenancy';
import { tenders } from './tender';

export const proposalStatusEnum = pgEnum('proposal_status', ['draft', 'finalized']);

export const tenderProposals = pgTable('tender_proposals', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  tenderId:         uuid('tender_id').notNull().references(() => tenders.id, { onDelete: 'cascade' }),
  status:           proposalStatusEnum('status').notNull().default('draft'),
  version:          integer('version').notNull().default(1),
  execSummary:      text('exec_summary').notNull(),
  complianceMatrix: jsonb('compliance_matrix').notNull().default('[]'), // ComplianceRow[]
  priceComparison:  jsonb('price_comparison').notNull().default('{}'),  // PriceComparison
  rejectionGrounds: jsonb('rejection_grounds').notNull().default('[]'), // RejectionGround[]
  recommendation:   text('recommendation').notNull(),
  generatedAt:      timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenderIdx: index('idx_tender_proposals_tender').on(t.tenderId),
}));
