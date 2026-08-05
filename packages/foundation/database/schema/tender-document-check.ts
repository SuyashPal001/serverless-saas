import { pgTable, uuid, text, jsonb, timestamp, pgEnum, index } from 'drizzle-orm/pg-core';
import { tenants } from './tenancy';
import { tenders } from './tender';

export const documentCheckTypeEnum = pgEnum('document_check_type', ['structural', 'clause_conflict']);
export const documentCheckStatusEnum = pgEnum('document_check_status', ['pass', 'fail', 'flagged']);

export const documentChecks = pgTable('document_checks', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  tenderId:    uuid('tender_id').notNull().references(() => tenders.id, { onDelete: 'cascade' }),
  checkType:   documentCheckTypeEnum('check_type').notNull(),
  ruleId:      text('rule_id').notNull(),          // e.g. "DC-S1" for structural, "CONFLICT-1" for clause conflicts
  status:      documentCheckStatusEnum('status').notNull(),
  sectionNo:   text('section_no'),                 // "S1".."S8", null for cross-section conflicts
  message:     text('message').notNull(),
  detail:      jsonb('detail').default('{}'),       // conflict pairs, clause refs, etc.
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenderIdx: index('idx_document_checks_tender').on(t.tenderId),
}));
