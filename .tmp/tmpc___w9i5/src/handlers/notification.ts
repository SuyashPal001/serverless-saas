import { eq, and, asc } from 'drizzle-orm';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { db } from '../db';
import {
  notificationWorkflows,
  notificationWorkflowSteps,
  notificationJobs,
} from '@serverless-saas/database';
import { resolveRecipientsByPermission } from '../lib/recipients';
import { checkPreference } from '../lib/preferences';
import { deliverEmail, deliverInApp } from '../lib/delivery';

const sqs = new SQSClient({ region: process.env.AWS_REGION ?? 'ap-south-1' });

export interface NotificationFireEvent {
  type: 'notification.fire';
  tenantId: string;
  messageType: string;
  actorId: string;
  actorType: 'human' | 'agent' | 'system';
  targetPermission?: string;
  recipientIds?: string[];
  data: Record<string, unknown>;
  triggerId?: string;
}

interface ChannelConfig {
  channel: 'email' | 'in_app' | 'sms' | 'slack';
}

interface DelayConfig {
  duration: number;
  unit: 'minutes' | 'hours' | 'days';
}

interface ConditionConfig {
  check: string;
  operator: string;
  value: unknown;
}

type WorkflowStep = typeof notificationWorkflowSteps.$inferSelect;

export async function walkSteps(params: {
  steps: WorkflowStep[];
  workflowId: string;
  tenantId: string;
  messageType: string;
  recipientId: string;
  isCritical: boolean;
  data: Record<string, unknown>;
  stepContext: Record<string, unknown>;
  triggerId: string;
  startFromOrder?: number;
}): Promise<void> {
  const {
    steps,
    workflowId,
    tenantId,
    messageType,
    recipientId,
    isCritical,
    data,
    triggerId,
  } = params;

  const startFromOrder = params.startFromOrder ?? 0;
  const stepContext = { ...params.stepContext };

  const stepsToRun = steps
    .filter((s) => s.order >= startFromOrder)
    .sort((a, b) => a.order - b.order);

  for (const step of stepsToRun) {
    if (step.type === 'channel') {
      const config = step.config as ChannelConfig;
      const { channel } = config;

      if (!isCritical) {
        const pref = await checkPreference(db, recipientId, tenantId, messageType, channel);
        if (!pref.enabled) {
          console.log('Notification skipped — preference disabled', { recipientId, channel, messageType });
          continue;
        }
      }

      const jobRows = await db
        .insert(notificationJobs)
        .values({
          workflowId,
          stepId: step.id,
          tenantId,
          recipientId,
          recipientType: 'human',
          scheduledAt: new Date(),
          status: 'running',
          payload: data,
          stepContext,
        })
        .returning({ id: notificationJobs.id });

      const jobId = jobRows[0].id;
      let jobStatus: 'completed' | 'failed' = 'completed';

      try {
        if (channel === 'email') {
          if (!step.templateId) throw new Error(`Step ${step.id} has no templateId`);
          await deliverEmail(db, { jobId, tenantId, templateId: step.templateId, recipientId, data });
        } else if (channel === 'in_app') {
          if (!step.templateId) throw new Error(`Step ${step.id} has no templateId`);
          await deliverInApp(db, {
            jobId,
            tenantId,
            workflowId,
            templateId: step.templateId,
            recipientId,
            messageType,
            data,
          });
        } else {
          console.log('Channel not implemented — skipping delivery', { channel, jobId });
        }
      } catch (err) {
        jobStatus = 'failed';
        console.error('Step delivery failed', {
          stepId: step.id,
          channel,
          recipientId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      await db
        .update(notificationJobs)
        .set({ status: jobStatus, executedAt: new Date(), updatedAt: new Date() })
        .where(eq(notificationJobs.id, jobId));
    } else if (step.type === 'delay') {
      const config = step.config as DelayConfig;
      const multipliers: Record<string, number> = { minutes: 60, hours: 3600, days: 86400 };
      const delaySeconds = config.duration * (multipliers[config.unit] ?? 60);
      const nextOrder = step.order + 1;

      if (delaySeconds <= 900) {
        await sqs.send(
          new SendMessageCommand({
            QueueUrl: process.env.SQS_PROCESSING_QUEUE_URL!,
            MessageBody: JSON.stringify({
              type: 'notification.step',
              tenantId,
              workflowId,
              recipientId,
              startFromStepOrder: nextOrder,
              payload: data,
              stepContext,
              triggerId,
            }),
            DelaySeconds: delaySeconds,
          }),
        );

        console.log('Delay step enqueued', { recipientId, delaySeconds, nextOrder });
      } else {
        await db.insert(notificationJobs).values({
          workflowId,
          stepId: step.id,
          tenantId,
          recipientId,
          recipientType: 'human',
          scheduledAt: new Date(Date.now() + delaySeconds * 1000),
          status: 'pending',
          payload: { ...data, _resumeFromOrder: nextOrder, _stepContext: stepContext, _triggerId: triggerId },
          stepContext,
        });

        console.log('Long delay job created — EventBridge pickup not yet implemented', {
          recipientId,
          delaySeconds,
        });
      }

      // Remaining steps resume after delay
      return;
    } else if (step.type === 'condition') {
      const config = step.config as ConditionConfig;
      const actual = stepContext[config.check];

      if (actual !== config.value) {
        console.log('Condition failed — stopping workflow for recipient', {
          recipientId,
          check: config.check,
          expected: config.value,
          actual,
        });
        return;
      }
    }
  }
}

export async function handleNotification(body: Record<string, unknown>): Promise<void> {
  const event = body as unknown as NotificationFireEvent;

  const workflows = await db
    .select()
    .from(notificationWorkflows)
    .where(
      and(
        eq(notificationWorkflows.tenantId, event.tenantId),
        eq(notificationWorkflows.messageType, event.messageType),
        eq(notificationWorkflows.status, 'active'),
      ),
    )
    .limit(1);

  if (workflows.length === 0) {
    console.log('No active workflow found', { tenantId: event.tenantId, messageType: event.messageType });
    return;
  }

  const workflow = workflows[0];

  let recipientIds: string[];

  if (event.recipientIds && event.recipientIds.length > 0) {
    recipientIds = event.recipientIds;
  } else if (event.targetPermission) {
    recipientIds = await resolveRecipientsByPermission(db, event.tenantId, event.targetPermission);
  } else {
    console.log('No recipients specified', { tenantId: event.tenantId, messageType: event.messageType });
    return;
  }

  if (recipientIds.length === 0) {
    console.log('Zero recipients resolved', { tenantId: event.tenantId, messageType: event.messageType });
    return;
  }

  const steps = await db
    .select()
    .from(notificationWorkflowSteps)
    .where(eq(notificationWorkflowSteps.workflowId, workflow.id))
    .orderBy(asc(notificationWorkflowSteps.order));

  if (steps.length === 0) {
    console.log('Workflow has no steps', { workflowId: workflow.id });
    return;
  }

  const triggerId = event.triggerId ?? crypto.randomUUID();

  for (const recipientId of recipientIds) {
    await walkSteps({
      steps,
      workflowId: workflow.id,
      tenantId: event.tenantId,
      messageType: event.messageType,
      recipientId,
      isCritical: workflow.critical,
      data: event.data,
      stepContext: {},
      triggerId,
    });
  }
}
