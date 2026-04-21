import { pgTable, uuid, text, timestamp, boolean, integer, numeric, jsonb } from 'drizzle-orm/pg-core';
import { tenants } from './tenancy';
import { users } from './auth';
import { conversations } from './conversations';

export const knowledgeGaps = pgTable('knowledge_gaps', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  query: text('query').notNull(),
  conversationId: uuid('conversation_id').references(() => conversations.id),
  ragScore: numeric('rag_score'),
  status: text('status').notNull().default('open'),
  resolvedAt: timestamp('resolved_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const toolCallLogs = pgTable('tool_call_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  conversationId: uuid('conversation_id').references(() => conversations.id),
  userId: uuid('user_id').references(() => users.id),
  toolName: text('tool_name').notNull(),
  success: boolean('success').notNull(),
  latencyMs: integer('latency_ms'),
  errorMessage: text('error_message'),
  args: jsonb('args'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
