import { pgTable, uuid, text, jsonb, timestamp, integer, index, boolean } from 'drizzle-orm/pg-core';
import { tenants } from './tenancy';
import { users } from './auth';
import { tenders } from './tender';

// ── Clause Library ────────────────────────────────────────────────────────────
// Reusable, versioned government-standard clauses. Distinct from tender-instance
// tenderClauses rows. source='library' entries here; source='instance' in tenderClauses.

export const clauseLibrary = pgTable('clause_library', {
  id:        uuid('id').primaryKey().defaultRandom(),
  tenantId:  uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  code:      text('code').notNull(),              // "CL-001"
  category:  text('category').notNull(),          // Eligibility/PQ | Technical | SLA/KPI | Commercial | Security/Compliance | General Terms
  title:     text('title').notNull(),
  content:   text('content').notNull(),           // full clause text
  tags:      jsonb('tags').notNull().default('[]'), // string[]
  version:   integer('version').notNull().default(1),
  isActive:  boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('idx_clause_library_tenant').on(t.tenantId),
  codeIdx:   index('idx_clause_library_code').on(t.tenantId, t.code),
}));

// ── RFP Sections ──────────────────────────────────────────────────────────────
// Authored sections per tender. blockType drives the renderer.
// content jsonb shape:
//   prose           → { text: string; clauses: ClauseEntry[] }
//   criteria-table  → { rows: CriteriaRow[]; clauses: ClauseEntry[] }
//   spec-table      → { rows: SpecRow[];     clauses: ClauseEntry[] }
//   line-item-table → { rows: BoqRow[];      clauses: ClauseEntry[] }
//
// ClauseEntry: { clauseNo, title, text, source: 'library'|'drafted', libraryRef?, cvcFlag? }

export const rfpSections = pgTable('rfp_sections', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenderId:    uuid('tender_id').notNull().references(() => tenders.id, { onDelete: 'cascade' }),
  tenantId:    uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  sectionNo:   text('section_no').notNull(),      // "S1"–"S8"
  title:       text('title').notNull(),
  blockType:   text('block_type').notNull(),      // prose|criteria-table|spec-table|line-item-table
  content:     jsonb('content').notNull().default('{}'),
  version:     integer('version').notNull().default(1),
  acceptedAt:  timestamp('accepted_at', { withTimezone: true }),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenderIdx: index('idx_rfp_sections_tender').on(t.tenderId),
}));

// ── RFP Section Versions ──────────────────────────────────────────────────────
// Change record: every accept/edit creates a version entry.

export const rfpSectionVersions = pgTable('rfp_section_versions', {
  id:        uuid('id').primaryKey().defaultRandom(),
  sectionId: uuid('section_id').notNull().references(() => rfpSections.id, { onDelete: 'cascade' }),
  tenderId:  uuid('tender_id').notNull().references(() => tenders.id, { onDelete: 'cascade' }),
  tenantId:  uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  version:   integer('version').notNull(),
  content:   jsonb('content').notNull().default('{}'),
  changeNote: text('change_note'),               // accept|edit|regenerate + optional steer
  editedBy:  uuid('edited_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
