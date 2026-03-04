import { pgTable, uuid, text, timestamp, boolean, integer, pgEnum, json, unique } from 'drizzle-orm/pg-core';
import { tenants } from './tenancy';
import { users } from './auth';

export const notificationStepTypeEnum = pgEnum('notification_step_type', ['channel', 'delay', 'condition']);
export const notificationChannelEnum = pgEnum('notification_channel', ['email', 'in_app', 'sms', 'slack']);
export const notificationStatusEnum = pgEnum('notification_status', ['active', 'paused', 'archived']);
export const notificationJobStatusEnum = pgEnum('notification_job_status', ['pending', 'running', 'completed', 'failed', 'cancelled']);
export const notificationDeliveryStatusEnum = pgEnum('notification_delivery_status', ['queued', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed']);
export const notificationRecipientTypeEnum = pgEnum('notification_recipient_type', ['human', 'agent']);
export const notificationSetByEnum = pgEnum('notification_set_by', ['user', 'tenant_admin', 'platform']);

export const notificationWorkflows = pgTable('notification_workflows', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  messageType: text('message_type').notNull(),
  critical: boolean('critical').notNull().default(false),
  status: notificationStatusEnum('status').notNull().default('active'),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const notificationWorkflowSteps = pgTable('notification_workflow_steps', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowId: uuid('workflow_id').notNull().references(() => notificationWorkflows.id),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  order: integer('order').notNull(),
  type: notificationStepTypeEnum('type').notNull(),
  config: json('config').notNull(),
  skipCondition: json('skip_condition'),
  templateId: uuid('template_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const notificationTemplates = pgTable('notification_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  name: text('name').notNull(),
  channel: notificationChannelEnum('channel').notNull(),
  locale: text('locale').notNull().default('en'),
  subject: text('subject'),
  body: text('body').notNull(),
  version: integer('version').notNull().default(1),
  status: notificationStatusEnum('status').notNull().default('active'),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const notificationJobs = pgTable('notification_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowId: uuid('workflow_id').notNull().references(() => notificationWorkflows.id),
  stepId: uuid('step_id').notNull().references(() => notificationWorkflowSteps.id),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  recipientId: uuid('recipient_id').notNull(),
  recipientType: notificationRecipientTypeEnum('recipient_type').notNull(),
  scheduledAt: timestamp('scheduled_at').notNull(),
  executedAt: timestamp('executed_at'),
  status: notificationJobStatusEnum('status').notNull().default('pending'),
  retryCount: integer('retry_count').notNull().default(0),
  payload: json('payload').notNull(),
  stepContext: json('step_context').notNull().default({}),
  cancelledAt: timestamp('cancelled_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const notificationDeliveryLog = pgTable('notification_delivery_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id').notNull().references(() => notificationJobs.id),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  channel: notificationChannelEnum('channel').notNull(),
  provider: text('provider').notNull(),
  status: notificationDeliveryStatusEnum('status').notNull().default('queued'),
  trackingToken: text('tracking_token').notNull().unique(),
  errorMessage: text('error_message'),
  sentAt: timestamp('sent_at'),
  deliveredAt: timestamp('delivered_at'),
  openedAt: timestamp('opened_at'),
  clickedAt: timestamp('clicked_at'),
  failedAt: timestamp('failed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const notificationPreferences = pgTable('notification_preferences', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  messageType: text('message_type'),
  channel: notificationChannelEnum('channel').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  readOnly: boolean('read_only').notNull().default(false),
  setBy: notificationSetByEnum('set_by').notNull().default('user'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  uniqueUserPreference: unique().on(t.userId, t.tenantId, t.messageType, t.channel),
}));

export const notificationInbox = pgTable('notification_inbox', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  jobId: uuid('job_id').notNull().references(() => notificationJobs.id),
  workflowId: uuid('workflow_id').notNull().references(() => notificationWorkflows.id),
  messageType: text('message_type').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  metadata: json('metadata'),
  read: boolean('read').notNull().default(false),
  readAt: timestamp('read_at'),
  archived: boolean('archived').notNull().default(false),
  archivedAt: timestamp('archived_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
