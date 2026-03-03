import { pgTable, uuid, text, timestamp, boolean, integer, decimal, pgEnum } from 'drizzle-orm/pg-core';
import { json } from 'drizzle-orm/pg-core';
import { tenants } from './tenancy';
import { users } from './auth';

export const workflowTriggerEnum = pgEnum('workflow_trigger', ['incident_created', 'scheduled', 'manual']);
export const workflowStatusEnum = pgEnum('workflow_status', ['active', 'paused', 'archived']);
export const workflowRunStatusEnum = pgEnum('workflow_run_status', ['running', 'completed', 'failed', 'awaiting_approval']);

export const agentWorkflows = pgTable('agent_workflows', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  agentId: uuid('agent_id').notNull(),
  name: text('name').notNull(),
  trigger: workflowTriggerEnum('trigger').notNull(),
  steps: json('steps').notNull().default([]),
  requiresApproval: boolean('requires_approval').notNull().default(false),
  llmProviderId: uuid('llm_provider_id'),
  temperature: decimal('temperature', { precision: 3, scale: 2 }),
  maxTokens: integer('max_tokens'),
  systemPrompt: text('system_prompt'),
  status: workflowStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const agentWorkflowRuns = pgTable('agent_workflow_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowId: uuid('workflow_id').notNull().references(() => agentWorkflows.id),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  agentId: uuid('agent_id').notNull(),
  trigger: text('trigger').notNull(),
  stepsCompleted: json('steps_completed').notNull().default([]),
  toolsCalled: json('tools_called').notNull().default([]),
  insights: text('insights'),
  actionsTaken: json('actions_taken').notNull().default([]),
  humanApproved: boolean('human_approved'),
  approvedBy: uuid('approved_by').references(() => users.id),
  status: workflowRunStatusEnum('status').notNull().default('running'),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
});
