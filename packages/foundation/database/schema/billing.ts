import { pgTable, uuid, text, timestamp, boolean, decimal, pgEnum } from 'drizzle-orm/pg-core';
import { tenants } from './tenancy';

export const planEnum = pgEnum('plan', ['free', 'starter', 'business', 'enterprise']);
export const subscriptionStatusEnum = pgEnum('subscription_status', ['active', 'cancelled', 'expired', 'trialing']);
export const billingCycleEnum = pgEnum('billing_cycle', ['monthly', 'annual']);
export const invoiceStatusEnum = pgEnum('invoice_status', ['draft', 'open', 'paid', 'void', 'uncollectible']);
export const paymentMethodTypeEnum = pgEnum('payment_method_type', ['card', 'bank_account', 'invoice']);
export const disputeStatusEnum = pgEnum('dispute_status', ['open', 'won', 'lost', 'closed']);
export const billingProviderEnum = pgEnum('billing_provider', ['stripe', 'paddle', 'chargebee']);
export const actorTypeEnum = pgEnum('actor_type', ['human', 'agent']);

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  plan: planEnum('plan').notNull().default('free'),
  status: subscriptionStatusEnum('status').notNull().default('trialing'),
  billingCycle: billingCycleEnum('billing_cycle').notNull().default('monthly'),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  endedAt: timestamp('ended_at'),
  trialEndsAt: timestamp('trial_ends_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  subscriptionId: uuid('subscription_id'),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  currency: text('currency').notNull().default('usd'),
  status: invoiceStatusEnum('status').notNull().default('draft'),
  dueAt: timestamp('due_at'),
  paidAt: timestamp('paid_at'),
  externalId: text('external_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const paymentMethods = pgTable('payment_methods', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  type: paymentMethodTypeEnum('type').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  externalId: text('external_id').notNull(),
  lastFour: text('last_four'),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const disputes = pgTable('disputes', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  invoiceId: uuid('invoice_id').notNull().references(() => invoices.id),
  reason: text('reason').notNull(),
  status: disputeStatusEnum('status').notNull().default('open'),
  externalId: text('external_id'),
  resolvedAt: timestamp('resolved_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const billingProviders = pgTable('billing_providers', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  provider: billingProviderEnum('provider').notNull(),
  externalId: text('external_id').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const usageRecords = pgTable('usage_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  actorId: uuid('actor_id').notNull(),
  actorType: actorTypeEnum('actor_type').notNull(),
  metric: text('metric').notNull(),
  quantity: decimal('quantity', { precision: 10, scale: 4 }).notNull(),
  recordedAt: timestamp('recorded_at').notNull().defaultNow(),
});
