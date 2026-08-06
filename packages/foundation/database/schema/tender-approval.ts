import { pgTable, uuid, text, integer, timestamp, pgEnum, index, unique } from 'drizzle-orm/pg-core';
import { tenants } from './tenancy';
import { tenders } from './tender';
import { users } from './auth';

export const approvalStepStatusEnum = pgEnum('approval_step_status', ['pending', 'approved', 'rejected']);
export const approvalResourceTypeEnum = pgEnum('approval_resource_type', ['contract']);

export const tenderApprovalSteps = pgTable('tender_approval_steps', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  tenderId:      uuid('tender_id').notNull().references(() => tenders.id, { onDelete: 'cascade' }),
  resourceType:  approvalResourceTypeEnum('resource_type').notNull(),
  resourceId:    uuid('resource_id').notNull(),        // e.g. tenderContracts.id — no FK, resourceType determines the target table
  stepOrder:     integer('step_order').notNull(),       // 1-based
  approverRole:  text('approver_role').notNull(),       // free text, e.g. "Reviewing Officer" — matches tenderOfficerActions.actorRole convention
  status:        approvalStepStatusEnum('status').notNull().default('pending'),
  actorId:       uuid('actor_id').references(() => users.id),
  comment:       text('comment'),
  signatureRef:  text('signature_ref'),                 // unverified claimed signature reference — NOT cryptographic DSC
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),  // "arrival" — file-movement in-timestamp
  actionedAt:    timestamp('actioned_at', { withTimezone: true }),                        // "departure" — file-movement out-timestamp
}, (t) => ({
  tenderIdx: index('idx_tender_approval_steps_tender').on(t.tenderId),
  resourceIdx: index('idx_tender_approval_steps_resource').on(t.resourceType, t.resourceId),
  resourceStepUnique: unique('tender_approval_steps_resource_step_unique').on(t.resourceType, t.resourceId, t.stepOrder),
}));
