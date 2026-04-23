import { pgTable, uuid, text, timestamp, boolean, integer, decimal, pgEnum, index } from 'drizzle-orm/pg-core';
import { json, jsonb } from 'drizzle-orm/pg-core';
import { tenants } from './tenancy';
import { users } from './auth';

export const workflowTriggerEnum = pgEnum('workflow_trigger', ['incident_created', 'scheduled', 'manual']);
export const workflowStatusEnum = pgEnum('workflow_status', ['active', 'paused', 'archived']);
export const workflowRunStatusEnum = pgEnum('workflow_run_status', ['running', 'completed', 'failed', 'awaiting_approval']);

export const agentTypeEnum = pgEnum('agent_type', ['ops', 'support', 'billing', 'custom']);
export const agentStatusEnum = pgEnum('agent_status', ['active', 'paused', 'retired']);

export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  type: agentTypeEnum('type').notNull(),
  model: text('model'),
  status: agentStatusEnum('status').notNull().default('active'),
  apiKeyId: uuid('api_key_id').notNull(),
  llmProviderId: uuid('llm_provider_id'),
  avatarUrl: text('avatar_url'),
  description: text('description'),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

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

// ── Agent Scrum Board ─────────────────────────────────────────────────────────

export const taskStatusEnum = pgEnum('task_status', ['backlog', 'ready', 'in_progress', 'review', 'blocked', 'done', 'cancelled']);
export const taskStepStatusEnum = pgEnum('task_step_status', ['pending', 'running', 'done', 'skipped', 'failed']);
export const taskEventActorTypeEnum = pgEnum('task_event_actor_type', ['agent', 'human', 'system']);
export const taskEventTypeEnum = pgEnum('task_event_type', ['status_changed', 'step_completed', 'step_failed', 'clarification_requested', 'clarification_answered', 'plan_proposed', 'plan_approved', 'plan_rejected', 'task_cancelled', 'comment']);

export const agentTasks = pgTable('agent_tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  agentId: uuid('agent_id').notNull().references(() => agents.id),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  title: text('title').notNull(),
  description: text('description'),
  acceptanceCriteria: jsonb('acceptance_criteria').notNull().default([]),
  status: taskStatusEnum('status').notNull().default('backlog'),
  estimatedHours: decimal('estimated_hours', { precision: 5, scale: 2 }),
  confidenceScore: decimal('confidence_score', { precision: 3, scale: 2 }),
  planApprovedAt: timestamp('plan_approved_at'),
  planApprovedBy: uuid('plan_approved_by').references(() => users.id),
  blockedReason: text('blocked_reason'),
  cancelReason: text('cancel_reason'),
  dueDate: timestamp('due_date'),
  upvotes: integer('upvotes').notNull().default(0),
  downvotes: integer('downvotes').notNull().default(0),
  links: jsonb('links').$type<string[]>().default([]),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  tenantStatusIdx: index('agent_tasks_tenant_status_idx').on(t.tenantId, t.status),
  tenantAgentIdx: index('agent_tasks_tenant_agent_idx').on(t.tenantId, t.agentId),
  tenantCreatedByIdx: index('agent_tasks_tenant_created_by_idx').on(t.tenantId, t.createdBy),
}));

export const taskSteps = pgTable('task_steps', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').notNull().references(() => agentTasks.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  stepNumber: integer('step_number').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  toolName: text('tool_name'),
  reasoning: text('reasoning'),
  status: taskStepStatusEnum('status').notNull().default('pending'),
  estimatedHours: decimal('estimated_hours', { precision: 4, scale: 2 }),
  confidenceScore: decimal('confidence_score', { precision: 3, scale: 2 }),
  humanFeedback: text('human_feedback'),
  agentOutput: text('agent_output'),
  toolArgs: jsonb('tool_args'),
  toolResult: jsonb('tool_result'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  taskIdIdx: index('task_steps_task_id_idx').on(t.taskId),
  tenantStatusIdx: index('task_steps_tenant_status_idx').on(t.tenantId, t.status),
}));

export const taskEvents = pgTable('task_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').notNull().references(() => agentTasks.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  actorType: taskEventActorTypeEnum('actor_type').notNull(),
  actorId: text('actor_id').notNull(),
  eventType: taskEventTypeEnum('event_type').notNull(),
  payload: jsonb('payload'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  taskCreatedAtIdx: index('task_events_task_created_at_idx').on(t.taskId, t.createdAt),
  tenantEventTypeIdx: index('task_events_tenant_event_type_idx').on(t.tenantId, t.eventType),
}));
