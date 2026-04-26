import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, asc } from 'drizzle-orm';
import { db } from '@serverless-saas/database';
import { agentTasks, taskSteps, taskEvents, taskComments } from '@serverless-saas/database/schema/agents';
import { pushWebSocketEvent } from '../../lib/websocket';
import { publishToQueue } from '../../lib/sqs';
import type { AppEnv } from '../../types';

// Auth: compare x-internal-service-key header to process.env.INTERNAL_SERVICE_KEY.
// NOTE: These routes are mounted on the same API Gateway Lambda as all other /api/v1
// routes — there is no port-based isolation. The only protection is the shared secret
// header check below. Ensure INTERNAL_SERVICE_KEY is rotated if compromised.
function isAuthorized(c: { req: { header: (name: string) => string | undefined } }): boolean {
  const provided = c.req.header('x-internal-service-key');
  const expected = process.env.INTERNAL_SERVICE_KEY;
  return !!provided && !!expected && provided === expected;
}

const internalTasksRoute = new Hono<AppEnv>();

// GET /internal/tasks/:taskId/comments — fetch task comments ordered by createdAt
internalTasksRoute.get('/:taskId/comments', async (c) => {
  if (!isAuthorized(c)) return c.json({ error: 'Unauthorized' }, 401);

  const taskId = c.req.param('taskId');

  const task = (await db.select({ id: agentTasks.id, tenantId: agentTasks.tenantId })
    .from(agentTasks)
    .where(eq(agentTasks.id, taskId))
    .limit(1))[0];

  if (!task) return c.json({ error: 'Task not found' }, 404);

  const comments = await db
    .select()
    .from(taskComments)
    .where(and(
      eq(taskComments.taskId, taskId),
      eq(taskComments.tenantId, task.tenantId),
    ))
    .orderBy(asc(taskComments.createdAt));

  return c.json({ data: comments });
});

// POST /internal/tasks/:taskId/steps/:stepId/start
internalTasksRoute.post('/:taskId/steps/:stepId/start', async (c) => {
  if (!isAuthorized(c)) return c.json({ error: 'Unauthorized' }, 401);

  const taskId = c.req.param('taskId');
  const stepId = c.req.param('stepId');

  const step = (await db.select().from(taskSteps).where(and(
    eq(taskSteps.id, stepId),
    eq(taskSteps.taskId, taskId),
  )).limit(1))[0];

  if (!step) return c.json({ error: 'Step not found' }, 404);

  const { tenantId } = step;

  const task = (await db.select({ agentId: agentTasks.agentId })
    .from(agentTasks)
    .where(and(
      eq(agentTasks.id, taskId),
      eq(agentTasks.tenantId, tenantId),
    ))
    .limit(1))[0];

  if (!task) return c.json({ error: 'Task not found' }, 404);

  const actorId = task.agentId ?? 'system';

  await db.update(taskSteps)
    .set({ status: 'running', startedAt: new Date(), updatedAt: new Date() })
    .where(eq(taskSteps.id, stepId));

  await db.update(agentTasks)
    .set({ status: 'in_progress', updatedAt: new Date() })
    .where(and(eq(agentTasks.id, taskId), eq(agentTasks.tenantId, tenantId)));

  await db.insert(taskEvents).values({
    taskId,
    tenantId,
    actorType: 'agent',
    actorId,
    eventType: 'status_changed',
    payload: { stepId, stepStatus: 'running' },
  });

  await pushWebSocketEvent(tenantId, { type: 'task.step.updated', taskId, stepId, status: 'running' });

  return c.json({ success: true });
});

// POST /internal/tasks/:taskId/steps/:stepId/complete
internalTasksRoute.post('/:taskId/steps/:stepId/complete', async (c) => {
  if (!isAuthorized(c)) return c.json({ error: 'Unauthorized' }, 401);

  const taskId = c.req.param('taskId');
  const stepId = c.req.param('stepId');

  const bodySchema = z.object({
    agentOutput: z.string().optional(),
    toolResult: z.record(z.unknown()).optional(),
  });

  const parsed = bodySchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.errors[0].message }, 400);

  const step = (await db.select().from(taskSteps).where(and(
    eq(taskSteps.id, stepId),
    eq(taskSteps.taskId, taskId),
  )).limit(1))[0];

  if (!step) return c.json({ error: 'Step not found' }, 404);

  const { tenantId } = step;

  const task = (await db.select({ agentId: agentTasks.agentId })
    .from(agentTasks)
    .where(and(
      eq(agentTasks.id, taskId),
      eq(agentTasks.tenantId, tenantId),
    ))
    .limit(1))[0];

  if (!task) return c.json({ error: 'Task not found' }, 404);

  const actorId = task.agentId ?? 'system';
  const { agentOutput, toolResult } = parsed.data;

  await db.update(taskSteps)
    .set({
      status: 'done',
      agentOutput: agentOutput ?? null,
      toolResult: toolResult ?? null,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(taskSteps.id, stepId));

  await db.insert(taskEvents).values({
    taskId,
    tenantId,
    actorType: 'agent',
    actorId,
    eventType: 'step_completed',
    payload: { stepId },
  });

  await pushWebSocketEvent(tenantId, { type: 'task.step.updated', taskId, stepId, status: 'done', agentOutput });

  return c.json({ success: true });
});

// POST /internal/tasks/:taskId/steps/:stepId/fail
internalTasksRoute.post('/:taskId/steps/:stepId/fail', async (c) => {
  if (!isAuthorized(c)) return c.json({ error: 'Unauthorized' }, 401);

  const taskId = c.req.param('taskId');
  const stepId = c.req.param('stepId');

  const bodySchema = z.object({
    error: z.string().min(1),
  });

  const parsed = bodySchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.errors[0].message }, 400);

  const step = (await db.select().from(taskSteps).where(and(
    eq(taskSteps.id, stepId),
    eq(taskSteps.taskId, taskId),
  )).limit(1))[0];

  if (!step) return c.json({ error: 'Step not found' }, 404);

  const { tenantId } = step;

  const task = (await db.select({ agentId: agentTasks.agentId })
    .from(agentTasks)
    .where(and(
      eq(agentTasks.id, taskId),
      eq(agentTasks.tenantId, tenantId),
    ))
    .limit(1))[0];

  if (!task) return c.json({ error: 'Task not found' }, 404);

  const actorId = task.agentId ?? 'system';
  const { error: failError } = parsed.data;

  await db.update(taskSteps)
    .set({ status: 'failed', updatedAt: new Date() })
    .where(eq(taskSteps.id, stepId));

  await db.update(agentTasks)
    .set({ status: 'blocked', blockedReason: failError, updatedAt: new Date() })
    .where(and(eq(agentTasks.id, taskId), eq(agentTasks.tenantId, tenantId)));

  await db.insert(taskEvents).values({
    taskId,
    tenantId,
    actorType: 'agent',
    actorId,
    eventType: 'step_failed',
    payload: { stepId, error: failError },
  });

  await pushWebSocketEvent(tenantId, { type: 'task.step.updated', taskId, stepId, status: 'failed' });

  return c.json({ success: true });
});

// POST /internal/tasks/:taskId/complete
internalTasksRoute.post('/:taskId/complete', async (c) => {
  if (!isAuthorized(c)) return c.json({ error: 'Unauthorized' }, 401);

  const taskId = c.req.param('taskId');

  const bodySchema = z.object({
    summary: z.string().optional(),
  });

  const parsed = bodySchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.errors[0].message }, 400);

  const task = (await db.select().from(agentTasks).where(eq(agentTasks.id, taskId)).limit(1))[0];
  if (!task) return c.json({ error: 'Task not found' }, 404);

  const { tenantId } = task;
  const actorId = task.agentId ?? 'system';

  await db.update(agentTasks)
    .set({ status: 'review', completedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(agentTasks.id, taskId), eq(agentTasks.tenantId, tenantId)));

  await db.insert(taskEvents).values({
    taskId,
    tenantId,
    actorType: 'agent',
    actorId,
    eventType: 'status_changed',
    payload: { from: task.status, to: 'review', summary: parsed.data.summary ?? null },
  });

  try {
    await pushWebSocketEvent(tenantId, { type: 'task.status.changed', taskId, status: 'review' });
  } catch (wsErr) {
    console.error('WS push failed (non-fatal):', wsErr);
  }

  const sqsUrl = process.env.SQS_PROCESSING_QUEUE_URL;
  if (sqsUrl) {
    await publishToQueue(sqsUrl, {
      type: 'notification.fire',
      tenantId,
      messageType: 'task.completed',
      actorId: actorId,
      actorType: 'agent',
      recipientIds: [task.createdBy],
      data: { taskId: task.id, taskTitle: task.title },
    });
  }

  return c.json({ success: true });
});

// POST /internal/tasks/:taskId/fail
internalTasksRoute.post('/:taskId/fail', async (c) => {
  if (!isAuthorized(c)) return c.json({ error: 'Unauthorized' }, 401);

  const taskId = c.req.param('taskId');

  const bodySchema = z.object({
    error: z.string().min(1),
  });

  const parsed = bodySchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.errors[0].message }, 400);

  const task = (await db.select().from(agentTasks).where(eq(agentTasks.id, taskId)).limit(1))[0];
  if (!task) return c.json({ error: 'Task not found' }, 404);

  const { tenantId } = task;
  const actorId = task.agentId ?? 'system';
  const { error: failError } = parsed.data;

  await db.update(agentTasks)
    .set({ status: 'blocked', blockedReason: failError, updatedAt: new Date() })
    .where(and(eq(agentTasks.id, taskId), eq(agentTasks.tenantId, tenantId)));

  await db.insert(taskEvents).values({
    taskId,
    tenantId,
    actorType: 'agent',
    actorId,
    eventType: 'status_changed',
    payload: { from: task.status, to: 'blocked', error: failError },
  });

  try {
    await pushWebSocketEvent(tenantId, { type: 'task.status.changed', taskId, status: 'blocked' });
  } catch (wsErr) {
    console.error('WS push failed (non-fatal):', wsErr);
  }

  const sqsUrl = process.env.SQS_PROCESSING_QUEUE_URL;
  if (sqsUrl) {
    await publishToQueue(sqsUrl, {
      type: 'notification.fire',
      tenantId,
      messageType: 'task.failed',
      actorId: actorId,
      actorType: 'agent',
      recipientIds: [task.createdBy],
      data: { taskId: task.id, taskTitle: task.title },
    });
  }

  return c.json({ success: true });
});

// POST /internal/tasks/:taskId/clarify
internalTasksRoute.post('/:taskId/clarify', async (c) => {
  if (!isAuthorized(c)) return c.json({ error: 'Unauthorized' }, 401);

  const taskId = c.req.param('taskId');

  const bodySchema = z.object({
    questions: z.array(z.string().min(1)).min(1),
  });

  const parsed = bodySchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.errors[0].message }, 400);

  const task = (await db.select().from(agentTasks).where(eq(agentTasks.id, taskId)).limit(1))[0];
  if (!task) return c.json({ error: 'Task not found' }, 404);

  const { tenantId } = task;
  const actorId = task.agentId ?? 'system';
  const { questions } = parsed.data;

  const numbered = questions.map((q, i) => `${i + 1}. ${q}`).join('\n');
  const blockedReason = `Agent needs clarification:\n${numbered}`;

  await db.update(agentTasks)
    .set({ status: 'blocked', blockedReason, updatedAt: new Date() })
    .where(and(eq(agentTasks.id, taskId), eq(agentTasks.tenantId, tenantId)));

  await db.insert(taskEvents).values({
    taskId,
    tenantId,
    actorType: 'agent',
    actorId,
    eventType: 'clarification_requested',
    payload: { questions },
  });

  const sqsUrl = process.env.SQS_PROCESSING_QUEUE_URL;
  if (sqsUrl) {
    await publishToQueue(sqsUrl, {
      type: 'notification.fire',
      tenantId,
      messageType: 'task.needs_clarification',
      actorId: actorId,
      actorType: 'agent',
      recipientIds: [task.createdBy],
      data: { taskId: task.id, taskTitle: task.title },
    });
  }

  return c.json({ success: true });
});

// POST /internal/tasks/:taskId/comments — agent posting a comment
internalTasksRoute.post('/:taskId/comments', async (c) => {
  if (!isAuthorized(c)) return c.json({ error: 'Unauthorized' }, 401);

  const taskId = c.req.param('taskId');

  const bodySchema = z.object({
    content: z.string().min(1),
    agentId: z.string().uuid(),
    parentId: z.string().uuid().optional(),
  });

  const parsed = bodySchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.errors[0].message }, 400);

  const task = (await db.select().from(agentTasks).where(eq(agentTasks.id, taskId)).limit(1))[0];
  if (!task) return c.json({ error: 'Task not found' }, 404);

  const { tenantId } = task;
  const { content, agentId, parentId } = parsed.data;

  const [comment] = await db.insert(taskComments).values({
    taskId,
    tenantId,
    authorId: agentId,
    authorType: 'agent',
    content,
    parentId: parentId ?? null,
  }).returning();

  await db.insert(taskEvents).values({
    taskId,
    tenantId,
    actorType: 'agent',
    actorId: agentId,
    eventType: 'comment_added',
    payload: { commentId: comment.id },
  });

  await pushWebSocketEvent(tenantId, {
    type: 'task.comment.added',
    taskId,
    comment,
  });

  return c.json({ data: comment }, 201);
});

export default internalTasksRoute;
