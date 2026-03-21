import { pgTable, uuid, text, timestamp, integer, pgEnum, jsonb, index } from 'drizzle-orm/pg-core';
import { tenants } from './tenancy';
import { users } from './auth';

export const webhookEndpointStatusEnum = pgEnum('webhook_endpoint_status', ['active', 'inactive']);
export const webhookDeliveryStatusEnum = pgEnum('webhook_delivery_status', ['pending', 'delivered', 'failed']);

export const webhookEndpoints = pgTable('webhook_endpoints', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  url: text('url').notNull(),
  events: text('events').array().notNull().default([]),
  secret: text('secret').notNull(),
  status: webhookEndpointStatusEnum('status').notNull().default('active'),
  description: text('description'),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
}, (t) => ({
  tenantIdx: index('webhook_endpoints_tenant_idx').on(t.tenantId),
}));

export const webhookDeliveryLog = pgTable('webhook_delivery_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  endpointId: uuid('endpoint_id').notNull().references(() => webhookEndpoints.id),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  event: text('event').notNull(),
  payload: jsonb('payload').notNull(),
  status: webhookDeliveryStatusEnum('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(1),
  httpStatus: integer('http_status'),
  responseBody: text('response_body'),
  error: text('error'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  endpointIdx: index('webhook_delivery_log_endpoint_idx').on(t.endpointId),
  tenantIdx: index('webhook_delivery_log_tenant_idx').on(t.tenantId),
}));
