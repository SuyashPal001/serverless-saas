import { pgTable, uuid, text, jsonb, timestamp, numeric, pgEnum, index, integer } from 'drizzle-orm/pg-core';
import { tenants } from './tenancy';
import { users } from './auth';

// ── Enums ────────────────────────────────────────────────────────────────────

export const tenderStatusEnum = pgEnum('tender_status', [
  'authoring', 'draft', 'published', 'pre_bid', 'evaluation', 'awarded', 'cancelled',
]);

export const bidStatusEnum = pgEnum('bid_status', [
  'submitted', 'pq_qualified', 'pq_disqualified', 'tech_evaluated', 'financial_evaluated', 'awarded',
]);

export const pqFindingStatusEnum = pgEnum('pq_finding_status', [
  'qualified', 'not_qualified', 'cannot_evaluate',
]);

export const complianceStatusEnum = pgEnum('compliance_status', [
  'complied', 'deviation', 'not_found', 'cannot_evaluate',
]);

export const shortfallStatusEnum = pgEnum('shortfall_status', [
  'open', 'clarification_sent', 'response_received', 'closed',
]);

export const tenderOfficerActionEnum = pgEnum('tender_officer_action', [
  'accept', 'override', 'escalate',
]);

// ── Core tender ──────────────────────────────────────────────────────────────

export const tenders = pgTable('tenders', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  rfpNumber:    text('rfp_number').notNull(),           // "DIT/HRMS/2024-25/001"
  title:        text('title').notNull(),
  department:   text('department').notNull(),
  budget:       numeric('budget'),                      // in rupees
  evalMethod:   text('eval_method').notNull().default('L1'),  // L1 | QCBS
  status:       tenderStatusEnum('status').notNull().default('evaluation'),
  pqCriteria:      jsonb('pq_criteria').notNull().default('{}'),
  templateFields:  jsonb('template_fields').default('{}'),  // authoring form inputs
  requirementText: text('requirement_text'),                // extracted requirement doc text
  authoringStatus: text('authoring_status').default('idle'), // idle|generating|completed|failed
  version:         integer('version').notNull().default(1),
  publishedAt:  timestamp('published_at', { withTimezone: true }),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('idx_tenders_tenant').on(t.tenantId),
}));

// Stage 1 flashback — clause library entries
export const tenderClauses = pgTable('tender_clauses', {
  id:        uuid('id').primaryKey().defaultRandom(),
  tenderId:  uuid('tender_id').notNull().references(() => tenders.id, { onDelete: 'cascade' }),
  tenantId:  uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  clauseNo:  text('clause_no').notNull(),               // "3.8"
  title:     text('title').notNull(),
  content:   text('content').notNull(),
  category:   text('category').notNull().default('technical'),
  source:     text('source').notNull().default('ingested'), // 'authored' | 'ingested'
  sourcePage: integer('source_page'),                   // page in RFP where clause appears
  version:    integer('version').notNull().default(1),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Stage 2 flashback — corrigenda
export const corrigenda = pgTable('corrigenda', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenderId:        uuid('tender_id').notNull().references(() => tenders.id, { onDelete: 'cascade' }),
  tenantId:        uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  corrigendumNo:   text('corrigendum_no').notNull(),        // "Corrigendum No. 1"
  changesSummary:  text('changes_summary').notNull(),
  changedClauses:  jsonb('changed_clauses').notNull().default('[]'), // [{sectionNo, clauseNo, from, to}]
  rfpVersionBefore: integer('rfp_version_before'),
  rfpVersionAfter:  integer('rfp_version_after'),
  queryId:         uuid('query_id').references(() => prebidQueries.id),
  issuedAt:        timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
});

// Stage 2 — pre-bid queries
export const prebidQueries = pgTable('prebid_queries', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenderId:         uuid('tender_id').notNull().references(() => tenders.id, { onDelete: 'cascade' }),
  tenantId:         uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  queryNo:          text('query_no').notNull(),
  raisedBy:         text('raised_by'),                      // company/name of bidder
  queryText:        text('query_text').notNull(),
  draftedResponse:  text('drafted_response'),
  finalResponse:    text('final_response'),
  status:           text('status').notNull().default('received'), // received|draft_ready|responded
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Bidders & bids ───────────────────────────────────────────────────────────

export const bidders = pgTable('bidders', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  tenderId:     uuid('tender_id').notNull().references(() => tenders.id, { onDelete: 'cascade' }),
  name:         text('name').notNull(),
  displayLabel: text('display_label').notNull(),        // "Bidder A"
  contactEmail: text('contact_email'),
  documentIds:  jsonb('document_ids').notNull().default('[]'), // string[] of uploaded doc IDs
  status:       bidStatusEnum('status').notNull().default('submitted'),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenderIdx: index('idx_bidders_tender').on(t.tenderId),
}));

export const bids = pgTable('bids', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  tenderId:    uuid('tender_id').notNull().references(() => tenders.id, { onDelete: 'cascade' }),
  bidderId:    uuid('bidder_id').notNull().references(() => bidders.id, { onDelete: 'cascade' }),
  envelope:    text('envelope').notNull(),               // 'technical' | 'financial'
  documentIds: jsonb('document_ids').notNull().default('[]'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Stage 3: PQ findings ─────────────────────────────────────────────────────

export const pqFindings = pgTable('pq_findings', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  tenderId:     uuid('tender_id').notNull().references(() => tenders.id, { onDelete: 'cascade' }),
  bidderId:     uuid('bidder_id').notNull().references(() => bidders.id, { onDelete: 'cascade' }),
  ruleId:       text('rule_id').notNull(),               // "PQ001"
  ruleName:     text('rule_name').notNull(),
  status:       pqFindingStatusEnum('status').notNull(),
  provision:    text('provision').notNull(),
  narration:    text('narration').notNull(),
  declaredValue: text('declared_value'),
  thresholdValue: text('threshold_value'),
  sourceDoc:    text('source_doc'),                      // e.g. "Audited Balance Sheet FY2023"
  sourcePage:   integer('source_page'),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenderIdx: index('idx_pq_findings_tender').on(t.tenderId),
}));

// ── Stage 4: Technical findings ──────────────────────────────────────────────

export const technicalFindings = pgTable('technical_findings', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  tenderId:     uuid('tender_id').notNull().references(() => tenders.id, { onDelete: 'cascade' }),
  bidderId:     uuid('bidder_id').notNull().references(() => bidders.id, { onDelete: 'cascade' }),
  clauseNo:     text('clause_no').notNull(),             // "3.8"
  clauseTitle:  text('clause_title').notNull(),
  status:       complianceStatusEnum('status').notNull(),
  narration:    text('narration').notNull(),
  sourceDoc:    text('source_doc'),
  sourcePage:   integer('source_page'),
  rfpRequirement: text('rfp_requirement'),
  bidderResponse: text('bidder_response'),
  runId:        text('run_id'),                          // mastra run ID for live evaluation
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenderIdx: index('idx_tech_findings_tender').on(t.tenderId),
}));

// ── Stage 5: Shortfalls & clarifications ────────────────────────────────────

export const shortfalls = pgTable('shortfalls', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  tenderId:        uuid('tender_id').notNull().references(() => tenders.id, { onDelete: 'cascade' }),
  bidderId:        uuid('bidder_id').notNull().references(() => bidders.id, { onDelete: 'cascade' }),
  techFindingId:   uuid('tech_finding_id').references(() => technicalFindings.id),
  discrepancy:     text('discrepancy').notNull(),
  sourceDoc:       text('source_doc'),
  sourcePage:      integer('source_page'),
  status:          shortfallStatusEnum('status').notNull().default('open'),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const clarificationRequests = pgTable('clarification_requests', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  tenderId:        uuid('tender_id').notNull().references(() => tenders.id, { onDelete: 'cascade' }),
  shortfallId:     uuid('shortfall_id').references(() => shortfalls.id),
  bidderId:        uuid('bidder_id').notNull().references(() => bidders.id, { onDelete: 'cascade' }),
  draftedText:     text('drafted_text').notNull(),      // auto-drafted CVC-clean request
  sentAt:          timestamp('sent_at', { withTimezone: true }),
  responseText:    text('response_text'),
  respondedAt:     timestamp('responded_at', { withTimezone: true }),
  deadlineDays:    integer('deadline_days').notNull().default(7),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Stage 6: Financial findings ──────────────────────────────────────────────

export const financialFindings = pgTable('financial_findings', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  tenderId:     uuid('tender_id').notNull().references(() => tenders.id, { onDelete: 'cascade' }),
  bidderId:     uuid('bidder_id').notNull().references(() => bidders.id, { onDelete: 'cascade' }),
  boqLines:     jsonb('boq_lines').notNull().default('[]'), // [{item, rfpQty, unit, quotedRate, amount}]
  totalAmount:  numeric('total_amount').notNull(),
  arithmeticCorrection: numeric('arithmetic_correction').default('0'),
  correctedTotal: numeric('corrected_total').notNull(),
  isL1:         text('is_l1').notNull().default('no'),   // 'yes' | 'no'
  l1Margin:     numeric('l1_margin'),                    // difference from L1 if not L1
  sourceDoc:    text('source_doc'),
  sourcePage:   integer('source_page'),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenderIdx: index('idx_fin_findings_tender').on(t.tenderId),
}));

// Consolidated evaluation report
export const evaluationReports = pgTable('evaluation_reports', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  tenderId:     uuid('tender_id').notNull().references(() => tenders.id, { onDelete: 'cascade' }),
  pqSummary:    jsonb('pq_summary').notNull().default('{}'),
  techSummary:  jsonb('tech_summary').notNull().default('{}'),
  finSummary:   jsonb('fin_summary').notNull().default('{}'),
  recommendation: text('recommendation').notNull(),
  l1BidderId:   uuid('l1_bidder_id').references(() => bidders.id),
  generatedAt:  timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Officer actions across all stages
export const tenderOfficerActions = pgTable('tender_officer_actions', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  tenderId:   uuid('tender_id').notNull().references(() => tenders.id, { onDelete: 'cascade' }),
  findingType: text('finding_type').notNull(),           // 'pq' | 'technical' | 'financial'
  findingId:  uuid('finding_id'),
  action:     tenderOfficerActionEnum('action').notNull(),
  rationale:  text('rationale'),
  actorId:    uuid('actor_id').references(() => users.id),
  actorRole:  text('actor_role').notNull(),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenderIdx: index('idx_tender_actions_tender').on(t.tenderId),
}));
