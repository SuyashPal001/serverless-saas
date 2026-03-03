import { pgTable, uuid, text, timestamp, boolean, integer, pgEnum, unique } from 'drizzle-orm/pg-core';
import { tenants } from './tenancy';
import { users } from './auth';

export const featureTypeEnum = pgEnum('feature_type', ['boolean', 'limit', 'metered']);
export const featureStatusEnum = pgEnum('feature_status', ['active', 'archived']);
export const resetPeriodEnum = pgEnum('reset_period', ['monthly', 'daily', 'weekly']);

export const features = pgTable('features', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  type: featureTypeEnum('type').notNull(),
  description: text('description'),
  unit: text('unit'),
  resetPeriod: resetPeriodEnum('reset_period'),
  metricKey: text('metric_key'),
  status: featureStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const planEntitlements = pgTable('plan_entitlements', {
  id: uuid('id').primaryKey().defaultRandom(),
  plan: text('plan').notNull(),
  featureId: uuid('feature_id').notNull().references(() => features.id),
  enabled: boolean('enabled').notNull().default(false),
  valueLimit: integer('value_limit'),
  unlimited: boolean('unlimited').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  uniquePlanFeature: unique().on(t.plan, t.featureId),
}));

export const tenantFeatureOverrides = pgTable('tenant_feature_overrides', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  featureId: uuid('feature_id').notNull().references(() => features.id),
  enabled: boolean('enabled'),
  valueLimit: integer('value_limit'),
  unlimited: boolean('unlimited'),
  reason: text('reason'),
  grantedBy: uuid('granted_by').notNull().references(() => users.id),
  expiresAt: timestamp('expires_at'),
  revokedAt: timestamp('revoked_at'),
  revokedBy: uuid('revoked_by').references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
}, (t) => ({
  uniqueTenantFeature: unique().on(t.tenantId, t.featureId),
}));
