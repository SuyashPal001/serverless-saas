import type { Timestamps } from './common';
import type {
  NotificationChannel,
  NotificationStepType,
  NotificationJobStatus,
  DeliveryStatus,
  PreferenceSetBy,
  WorkflowStatus,
  ActorType,
} from './enums';

// ============================================
// Notification Workflow
// ============================================

export interface NotificationWorkflow extends Timestamps {
  id: string;
  tenantId: string;
  messageType: string;
  critical: boolean;
  status: WorkflowStatus;
  createdBy: string;
}

// ============================================
// Notification Workflow Step
// ============================================

export interface NotificationWorkflowStep extends Timestamps {
  id: string;
  workflowId: string;
  tenantId: string;
  order: number;
  type: NotificationStepType;
  config: ChannelStepConfig | DelayStepConfig | ConditionStepConfig;
  skipCondition: SkipCondition | null;
  templateId: string | null;
}

export interface ChannelStepConfig {
  channel: NotificationChannel;
}

export interface DelayStepConfig {
  duration: number;
  unit: 'minutes' | 'hours' | 'days';
}

export interface ConditionStepConfig {
  check: string;
  operator: 'equals' | 'not_equals' | 'exists' | 'gt' | 'lt';
  value: unknown;
}

export interface SkipCondition {
  check: string;
  operator: 'equals' | 'not_equals' | 'exists';
  value: unknown;
}

// ============================================
// Notification Template
// ============================================

export interface NotificationTemplate extends Timestamps {
  id: string;
  tenantId: string | null;
  name: string;
  channel: NotificationChannel;
  locale: string;
  subject: string | null;
  body: string;
  version: number;
  status: WorkflowStatus;
  createdBy: string;
}

// ============================================
// Notification Job
// ============================================

export interface NotificationJob extends Timestamps {
  id: string;
  workflowId: string;
  stepId: string;
  tenantId: string;
  recipientId: string;
  recipientType: ActorType;
  scheduledAt: Date;
  executedAt: Date | null;
  status: NotificationJobStatus;
  retryCount: number;
  payload: NotificationPayload;
  stepContext: StepContext;
  cancelledAt: Date | null;
}

export interface NotificationPayload {
  event: string;
  tenantId: string;
  actorId?: string;
  actorType?: ActorType;
  resourceId?: string;
  resourceType?: string;
  data: Record<string, unknown>;
  triggeredAt: string;
}

export interface StepContext {
  previousStepResults: {
    stepId: string;
    status: 'completed' | 'skipped' | 'failed';
    channel?: NotificationChannel;
    deliveryStatus?: string;
  }[];
  variables: Record<string, unknown>;
}

// ============================================
// Notification Delivery Log
// ============================================

export interface NotificationDeliveryLog extends Pick<Timestamps, 'createdAt'> {
  id: string;
  jobId: string;
  tenantId: string;
  channel: NotificationChannel;
  provider: string;
  status: DeliveryStatus;
  trackingToken: string;
  errorMessage: string | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  openedAt: Date | null;
  clickedAt: Date | null;
  failedAt: Date | null;
}

// ============================================
// Notification Preference
// ============================================

export interface NotificationPreference extends Timestamps {
  id: string;
  tenantId: string;
  userId: string;
  messageType: string | null;
  channel: NotificationChannel;
  enabled: boolean;
  readOnly: boolean;
  setBy: PreferenceSetBy;
}

// ============================================
// Notification Inbox
// ============================================

export interface NotificationInbox extends Pick<Timestamps, 'createdAt'> {
  id: string;
  tenantId: string;
  userId: string;
  jobId: string;
  workflowId: string;
  messageType: string;
  title: string;
  body: string;
  metadata: Record<string, unknown> | null;
  read: boolean;
  readAt: Date | null;
  archived: boolean;
  archivedAt: Date | null;
}
