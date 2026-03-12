import { relations } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, pgEnum, unique } from 'drizzle-orm/pg-core';
import { users } from './auth';
import { roles } from './authorization';

export const tenantTypeEnum = pgEnum('tenant_type', ['individual', 'startup', 'business', 'enterprise']);
export const tenantStatusEnum = pgEnum('tenant_status', ['active', 'suspended', 'deleted']);
export const memberTypeEnum = pgEnum('member_type', ['human', 'agent']);
export const memberStatusEnum = pgEnum('member_status', ['active', 'invited', 'suspended']);

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  type: tenantTypeEnum('type').notNull().default('startup'),
  status: tenantStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
});

export const memberships = pgTable('memberships', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id),
  agentId: uuid('agent_id'),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  roleId: uuid('role_id').notNull(),
  memberType: memberTypeEnum('member_type').notNull(),
  status: memberStatusEnum('status').notNull().default('invited'),
  invitedBy: uuid('invited_by').references(() => users.id),
  invitedAt: timestamp('invited_at'),
  joinedAt: timestamp('joined_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  uniqueUserTenant: unique().on(t.userId, t.tenantId),
  uniqueAgentTenant: unique().on(t.agentId, t.tenantId),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  user: one(users, {
    fields: [memberships.userId],
    references: [users.id],
  }),
  role: one(roles, {
    fields: [memberships.roleId],
    references: [roles.id],
  }),
  tenant: one(tenants, {
    fields: [memberships.tenantId],
    references: [tenants.id],
  }),
}));
