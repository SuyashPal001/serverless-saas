import { timingSafeEqual } from 'crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, asc, lt, sql } from 'drizzle-orm';
import { db } from '@serverless-saas/database';
import { agentTasks, taskSteps, taskEvents, taskComments } from '@serverless-saas/database/schema/agents';
import { pushWebSocketEvent } from '../../lib/websocket';
import { publishToQueue } from '../../lib/sqs';
import { getCacheClient } from '@serverless-saas/cache';
import type { AppEnv } from '../../types';

// Auth: compare x-internal-service-key header to process.env.INTERNAL_SERVICE_KEY.
// NOTE: These routes are mounted on the same API Gateway Lambda as all other /api/v1
// routes — there is no port-based isolation. The only protection is the shared secret
// header check below. Ensure INTERNAL_SERVICE_KEY is rotated if compromised.
function isAuthorized(provided: string): boolean {
  const expected = process.env.INTERNAL_SERVICE_KEY
  if (!expected) return false
  try {
    return timingSafeEqual(
      Buffer.from(provided),
      Buffer.from(expected)
    )
  } catch {
    return false
  }
}

const MAX_CLARIFICATION_ROUNDS = 3;

const internalTasksRoute = new Hono<AppEnv>();

// GET /internal/tasks/:taskId/comments — fetch task comments ordered by createdAt
internalTasksRoute.get('/:taskId/comments', async (c) => {
  if (!isAuthorized(c.req.header('x-internal-service-key') ?? '')) return c.json({ error: 'Unauthorized' }, 401);

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
  if (!isAuthorized(c.req.header('x-internal-service-key') ?? '')) return c.json({ error: 'Unauthorized' }, 401);

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

  // Enforce sequential step execution — all prior steps must be done
  const previousIncomplete = await db.select({ id: taskSteps.id })
    .from(taskSteps)
    .where(and(
      eq(taskSteps.taskId, taskId),
      lt(taskSteps.stepNumber, step.stepNumber),
      sql`${taskSteps.status} NOT IN ('done', 'skipped')`,
    ))
    .limit(1);

  if (previousIncomplete.length > 0) {
    return c.json({ error: 'Previous steps not yet completed' }, 409);
  }

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

  // BUG-8: Refresh watchdog TTL on step start, not just on step complete.
  // A step that takes longer than the initial 600s TTL would trigger a false-positive
  // watchdog fire even if the agent is actively running.
  getCacheClient().expire(`task:watchdog:${taskId}`, 600).catch(() => {});

  return c.json({ success: true });
});

// POST /internal/tasks/:taskId/steps/:stepId/delta — relay fires streaming tokens and tool events
internalTasksRoute.post('/:taskId/steps/:stepId/delta', async (c) => {
  if (!isAuthorized(c.req.header('x-internal-service-key') ?? '')) return c.json({ error: 'Unauthorized' }, 401);

  const taskId = c.req.param('taskId');
  const stepId = c.req.param('stepId');

  const bodySchema = z.object({
    tenantId: z.string().uuid(),
    type: z.enum(['task.step.delta', 'task.step.tool_call', 'task.step.tool_result', 'task.step.thinking']).optional(),
    // delta fields
    delta: z.string().max(50_000).optional(),
    text: z.string().max(50_000).optional(),
    // tool_call fields
    toolName: z.string().optional(),
    toolInput: z.string().optional(),
    // tool_result fields
    durationMs: z.number().optional(),
    resultSummary: z.string().optional(),
  });

  const parsed = bodySchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.errors[0].message }, 400);

  // Cross-verify tenantId against DB
  const step = (await db.select({ tenantId: taskSteps.tenantId })
    .from(taskSteps)
    .where(and(eq(taskSteps.id, stepId), eq(taskSteps.taskId, taskId)))
    .limit(1))[0];
  if (!step) return c.json({ error: 'Step not found' }, 404);
  if (step.tenantId !== parsed.data.tenantId) {
    return c.json({ error: 'Tenant mismatch' }, 403);
  }

  const { tenantId, type: eventType = 'task.step.delta' } = parsed.data;

  if (eventType === 'task.step.tool_call') {
    await pushWebSocketEvent(tenantId, {
      type: 'task.step.tool_call',
      taskId,
      stepId,
      toolName: parsed.data.toolName,
      toolInput: parsed.data.toolInput,
    });
  } else if (eventType === 'task.step.tool_result') {
    await pushWebSocketEvent(tenantId, {
      type: 'task.step.tool_result',
      taskId,
      stepId,
      toolName: parsed.data.toolName,
      durationMs: parsed.data.durationMs,
      resultSummary: parsed.data.resultSummary,
    });
  } else if (eventType === 'task.step.thinking') {
    await pushWebSocketEvent(tenantId, {
      type: 'task.step.thinking',
      taskId,
      stepId,
    });
  } else {
    await pushWebSocketEvent(tenantId, {
      type: 'task.step.delta',
      taskId,
      stepId,
      delta: parsed.data.delta ?? '',
      text: parsed.data.text ?? '',
    });
  }

  return c.json({ success: true });
});

// POST /internal/tasks/:taskId/steps/:stepId/complete
internalTasksRoute.post('/:taskId/steps/:stepId/complete', async (c) => {
  if (!isAuthorized(c.req.header('x-internal-service-key') ?? '')) return c.json({ error: 'Unauthorized' }, 401);

  const taskId = c.req.param('taskId');
  const stepId = c.req.param('stepId');

  const bodySchema = z.object({
    agentOutput: z.string().max(100_000).optional(),
    summary: z.string().optional(),
    toolResult: z.record(z.unknown()).optional(),
    reasoning: z.string().optional(),
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
  const { agentOutput, summary, toolResult, reasoning } = parsed.data;

  // BUG-9: Wrap the DB write in try/catch and return 503 so the relay can retry.
  // Without this, a transient DB error returns an unhandled 500 with no Retry-After
  // hint, leaving the step stuck in 'running' with no recovery path.
  try {
    await db.update(taskSteps)
      .set({
        status: 'done',
        agentOutput: agentOutput ?? null,
        summary: summary ?? null,
        toolResult: toolResult ?? null,
        reasoning: reasoning ?? null,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(taskSteps.id, stepId));
  } catch (dbErr) {
    console.error('[step/complete] DB write failed', { taskId, stepId, error: (dbErr as Error).message });
    c.header('Retry-After', '2');
    return c.json({ error: 'Step completion write failed, please retry' }, 503);
  }

  await db.insert(taskEvents).values({
    taskId,
    tenantId,
    actorType: 'agent',
    actorId,
    eventType: 'step_completed',
    payload: { stepId },
  });

  await pushWebSocketEvent(tenantId, { type: 'task.step.updated', taskId, stepId, status: 'done', agentOutput, summary });

  // Extend watchdog TTL — step completed, relay is alive
  getCacheClient().expire(`task:watchdog:${taskId}`, 600).catch(() => {});

  return c.json({ success: true });
});

// POST /internal/tasks/:taskId/steps/:stepId/fail
internalTasksRoute.post('/:taskId/steps/:stepId/fail', async (c) => {
  if (!isAuthorized(c.req.header('x-internal-service-key') ?? '')) return c.json({ error: 'Unauthorized' }, 401);

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

  const [updatedStep] = await db.update(taskSteps)
    .set({ status: 'failed', agentOutput: failError, updatedAt: new Date() })
    .where(and(eq(taskSteps.id, stepId), eq(taskSteps.status, 'running')))
    .returning({ id: taskSteps.id });

  if (!updatedStep) {
    return c.json({ error: 'Step is not in a failable state' }, 409);
  }

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

  await pushWebSocketEvent(tenantId, {
    type: 'task.status.changed',
    taskId,
    status: 'blocked',
    blockedReason: failError,
  });

  // Step failed → task blocked (terminal for this run) — clear watchdog
  getCacheClient().del(`task:watchdog:${taskId}`).catch(() => {});

  return c.json({ success: true });
});

// POST /internal/tasks/:taskId/complete
internalTasksRoute.post('/:taskId/complete', async (c) => {
  if (!isAuthorized(c.req.header('x-internal-service-key') ?? '')) return c.json({ error: 'Unauthorized' }, 401);

  const taskId = c.req.param('taskId');

  const bodySchema = z.object({
    summary: z.string().optional(),
    tenantId: z.string().uuid().optional(),
  });

  const parsed = bodySchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.errors[0].message }, 400);

  const task = (await db.select().from(agentTasks).where(eq(agentTasks.id, taskId)).limit(1))[0];
  if (!task) return c.json({ error: 'Task not found' }, 404);
  if (parsed.data.tenantId && parsed.data.tenantId !== task.tenantId) {
    return c.json({ error: 'Tenant mismatch' }, 403);
  }

  const { tenantId } = task;
  const actorId = task.agentId ?? 'system';

  // BUG-12: Add status predicate to prevent the illegal blocked → review transition.
  // Without it, if the watchdog fires and marks the task 'blocked' while the agent
  // is still running, the agent's subsequent /complete call overwrites it to 'review',
  // creating inconsistent state (user received a failure notification but task shows done).
  const [updatedTask] = await db.update(agentTasks)
    .set({ status: 'review', completedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(agentTasks.id, taskId),
      eq(agentTasks.tenantId, tenantId),
      eq(agentTasks.status, 'in_progress'),
    ))
    .returning({ id: agentTasks.id });

  if (!updatedTask) {
    return c.json({ error: 'Task is not in a completable state' }, 409);
  }

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

  // Task completed — clear watchdog (terminal state)
  getCacheClient().del(`task:watchdog:${taskId}`).catch(() => {});

  // BUG-11: Wrap publishToQueue in try/catch — the task is already in terminal state
  // ('review'). If the notification publish throws and we don't catch it, the Lambda
  // returns 500 to the relay, which may retry /complete and send a duplicate notification.
  const sqsUrl = process.env.SQS_PROCESSING_QUEUE_URL;
  if (sqsUrl) {
    try {
      await publishToQueue(sqsUrl, {
        type: 'notification.fire',
        tenantId,
        messageType: 'task.completed',
        actorId: actorId,
        actorType: 'agent',
        recipientIds: [task.createdBy],
        data: { taskId: task.id, taskTitle: task.title },
      });
    } catch (sqsErr) {
      console.error('[task/complete] notification publish failed (non-fatal):', (sqsErr as Error).message);
    }
  }

  return c.json({ success: true });
});

// POST /internal/tasks/:taskId/fail
internalTasksRoute.post('/:taskId/fail', async (c) => {
  if (!isAuthorized(c.req.header('x-internal-service-key') ?? '')) return c.json({ error: 'Unauthorized' }, 401);

  const taskId = c.req.param('taskId');

  const bodySchema = z.object({
    error: z.string().min(1),
    tenantId: z.string().uuid().optional(),
  });

  const parsed = bodySchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.errors[0].message }, 400);

  const task = (await db.select().from(agentTasks).where(eq(agentTasks.id, taskId)).limit(1))[0];
  if (!task) return c.json({ error: 'Task not found' }, 404);
  if (parsed.data.tenantId && parsed.data.tenantId !== task.tenantId) {
    return c.json({ error: 'Tenant mismatch' }, 403);
  }

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

  // Task failed → blocked (terminal for this run) — clear watchdog
  getCacheClient().del(`task:watchdog:${taskId}`).catch(() => {});

  // BUG-11: Same as /complete — wrap publishToQueue so a notification failure doesn't
  // return 500 to the relay after the DB is already in terminal state.
  const sqsUrl = process.env.SQS_PROCESSING_QUEUE_URL;
  if (sqsUrl) {
    try {
      await publishToQueue(sqsUrl, {
        type: 'notification.fire',
        tenantId,
        messageType: 'task.failed',
        actorId: actorId,
        actorType: 'agent',
        recipientIds: [task.createdBy],
        data: { taskId: task.id, taskTitle: task.title },
      });
    } catch (sqsErr) {
      console.error('[task/fail] notification publish failed (non-fatal):', (sqsErr as Error).message);
    }
  }

  return c.json({ success: true });
});

// POST /internal/tasks/:taskId/clarify
internalTasksRoute.post('/:taskId/clarify', async (c) => {
  if (!isAuthorized(c.req.header('x-internal-service-key') ?? '')) return c.json({ error: 'Unauthorized' }, 401);

  const taskId = c.req.param('taskId');

  const bodySchema = z.object({
    questions: z.array(z.string().min(1)).min(1),
    tenantId: z.string().uuid().optional(),
  });

  const parsed = bodySchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.errors[0].message }, 400);

  const task = (await db.select().from(agentTasks).where(eq(agentTasks.id, taskId)).limit(1))[0];
  if (!task) return c.json({ error: 'Task not found' }, 404);
  if (parsed.data.tenantId && parsed.data.tenantId !== task.tenantId) {
    return c.json({ error: 'Tenant mismatch' }, 403);
  }

  const { tenantId } = task;
  const actorId = task.agentId ?? 'system';
  const { questions } = parsed.data;

  // Enforce max clarification rounds
  const priorClarifications = await db.select({ id: taskEvents.id })
    .from(taskEvents)
    .where(and(
      eq(taskEvents.taskId, taskId),
      eq(taskEvents.eventType, 'clarification_requested'),
    ));

  if (priorClarifications.length >= MAX_CLARIFICATION_ROUNDS) {
    const reason = 'Maximum clarification rounds reached. Please restart with more detail.';
    await db.update(agentTasks)
      .set({ status: 'blocked', blockedReason: reason, updatedAt: new Date() })
      .where(eq(agentTasks.id, taskId));
    await pushWebSocketEvent(tenantId, {
      type: 'task.status.changed',
      taskId,
      status: 'blocked',
    });
    return c.json({ error: reason, code: 'MAX_CLARIFICATIONS' }, 429);
  }

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
    try {
      await publishToQueue(sqsUrl, {
        type: 'notification.fire',
        tenantId,
        messageType: 'task.needs_clarification',
        actorId: actorId,
        actorType: 'agent',
        recipientIds: [task.createdBy],
        data: { taskId: task.id, taskTitle: task.title },
      });
    } catch (sqsErr) {
      console.error('[task/clarify] notification publish failed (non-fatal):', (sqsErr as Error).message);
    }
  }

  return c.json({ success: true });
});

// POST /internal/tasks/:taskId/comments — agent posting a comment
internalTasksRoute.post('/:taskId/comments', async (c) => {
  if (!isAuthorized(c.req.header('x-internal-service-key') ?? '')) return c.json({ error: 'Unauthorized' }, 401);

  const taskId = c.req.param('taskId');

  const bodySchema = z.object({
    content: z.string().min(1),
    agentId: z.string().uuid(),
    parentId: z.string().uuid().optional(),
    tenantId: z.string().uuid().optional(),
  });

  const parsed = bodySchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.errors[0].message }, 400);

  const task = (await db.select().from(agentTasks).where(eq(agentTasks.id, taskId)).limit(1))[0];
  if (!task) return c.json({ error: 'Task not found' }, 404);
  if (parsed.data.tenantId && parsed.data.tenantId !== task.tenantId) {
    return c.json({ error: 'Tenant mismatch' }, 403);
  }

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
