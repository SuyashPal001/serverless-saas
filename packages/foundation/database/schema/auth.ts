import { pgTable, uuid, text, timestamp, pgEnum } from 'drizzle-orm/pg-core';

export const sessionStatusEnum = pgEnum('session_status', ['active', 'invalidated']);
export const invalidatedReasonEnum = pgEnum('invalidated_reason', ['role_changed', 'suspended', 'logout', 'expired', 'tenant_deleted']);
export const agentTypeEnum = pgEnum('agent_type', ['ops', 'support', 'billing', 'custom']);
export const agentStatusEnum = pgEnum('agent_status', ['active', 'paused', 'retired']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  cognitoId: text('cognito_id').notNull().unique(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  tenantId: uuid('tenant_id').notNull(),
  jwtId: text('jwt_id').notNull().unique(),
  status: sessionStatusEnum('status').notNull().default('active'),
  invalidatedAt: timestamp('invalidated_at'),
  invalidatedReason: invalidatedReasonEnum('invalidated_reason'),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  type: agentTypeEnum('type').notNull(),
  model: text('model'),
  status: agentStatusEnum('status').notNull().default('active'),
  apiKeyId: uuid('api_key_id').notNull(),
  llmProviderId: uuid('llm_provider_id'),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
