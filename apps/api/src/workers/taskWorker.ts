import type { SQSHandler } from 'aws-lambda';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from '@serverless-saas/database/schema';
import { agentTasks, taskSteps, taskEvents, agents } from '@serverless-saas/database/schema';
import { eq, asc, and, sql } from 'drizzle-orm';

// Import schema from TypeScript source so esbuild bundles fresh — avoids stale dist/schema
// causing db.query.agentTasks to be undefined at runtime.
const db = drizzle(neon(process.env.DATABASE_URL!), { schema });
import { pushWebSocketEvent } from '../lib/websocket';
import { publishToQueue } from '../lib/sqs';
import { initRuntimeSecrets } from '../lib/secrets';
import { getCacheClient } from '@serverless-saas/cache';
import { embedQuery } from '@serverless-saas/ai';

const RELAY_URL = process.env.RELAY_URL!;
const INTERNAL_SERVICE_KEY = () => process.env.INTERNAL_SERVICE_KEY!;

let secretsInitialised = false;

async function getPastSuccessfulPlans(tenantId: string, title: string, description: string | null | undefined, limit = 2): Promise<string | null> {
  const queryText = [title, description].filter(Boolean).join(' ');
  const embedding = await embedQuery(queryText);
  const vectorStr = `[${embedding.join(',')}]`;

  const result = await db.execute(sql`
    SELECT id, title
    FROM agent_tasks
    WHERE tenant_id = ${tenantId}
      AND status = 'done'
      AND embedding IS NOT NULL
      AND (1 - (embedding <=> ${vectorStr}::vector)) > 0.6
    ORDER BY embedding <=> ${vectorStr}::vector
    LIMIT ${limit}
  `);

  const rows = (result as any).rows as Array<{ id: string; title: string }>;
  if (!rows || rows.length === 0) return null;

  const sections: string[] = [];
  for (const row of rows) {
    const steps = await db.select({ title: taskSteps.title, description: taskSteps.description })
      .from(taskSteps)
      .where(and(eq(taskSteps.taskId, row.id), eq(taskSteps.status, 'done')))
      .orderBy(asc(taskSteps.stepNumber));

    if (steps.length > 0) {
      const stepList = steps.map((s, i) => `${i + 1}. ${s.title}${s.description ? ': ' + s.description : ''}`).join('\n');
      sections.push(`### ${row.title}\n${stepList}`);
    }
  }

  if (sections.length === 0) return null;
  return `## Similar past tasks\n${sections.join('\n\n')}`;
}

export const handler: SQSHandler = async (event) => {
  if (!secretsInitialised) {
    await initRuntimeSecrets();
    secretsInitialised = true;
  }
  for (const record of event.Records) {
    const message = JSON.parse(record.body);
    const { type, taskId } = message;

    if (type === 'plan_task' || type === 'replan_task') {
      await handlePlanning(taskId, message.extraContext as string | undefined);
    } else if (type === 'execute_task') {
      await handleExecution(taskId);
    }
  }
};

async function handlePlanning(taskId: string, extraContext?: string) {
  const task = await db.query.agentTasks.findFirst({
    where: eq(agentTasks.id, taskId),
  });
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const agent = task.agentId
    ? (await db.select({ name: agents.name }).from(agents).where(eq(agents.id, task.agentId)).limit(1))[0]
    : null;

  let ragContext: string | null = null;
  try {
    ragContext = await getPastSuccessfulPlans(task.tenantId, task.title, task.description);
    if (ragContext) {
      console.log(`[handlePlanning] taskId=${taskId} RAG found similar past tasks, prepending context`);
    }
  } catch (ragErr) {
    console.error('[handlePlanning] RAG lookup failed (non-fatal):', (ragErr as Error).message);
  }

  const combinedExtraContext = [ragContext, extraContext].filter(Boolean).join('\n\n') || undefined;

  const response = await fetch(`${RELAY_URL}/api/tasks/plan`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-service-key': INTERNAL_SERVICE_KEY(),
    },
    body: JSON.stringify({
      taskId: task.id,
      agentId: task.agentId,
      tenantId: task.tenantId,
      title: task.title,
      description: task.description,
      acceptanceCriteria: task.acceptanceCriteria,
      agentName: agent?.name ?? null,
      referenceText: task.referenceText ?? null,
      links: task.links ?? [],
      ...(combinedExtraContext ? { extraContext: combinedExtraContext } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`Relay planning failed: ${response.status}`);
  }

  const body = await response.json() as {
    steps?: Array<{ title: string; description: string; toolName?: string; confidenceScore?: number }>;
    clarificationNeeded?: boolean;
    questions?: string[];
  };

  if (body.clarificationNeeded) {
    const questions = body.questions ?? [];
    const reason = `Agent needs clarification:\n${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`;
    await db.update(agentTasks)
      .set({ status: 'blocked', blockedReason: reason, updatedAt: new Date() })
      .where(eq(agentTasks.id, task.id));

    await db.insert(taskEvents).values({
      taskId: task.id,
      tenantId: task.tenantId,
      actorType: 'agent',
      actorId: task.agentId ?? 'system',
      eventType: 'clarification_requested',
      payload: { questions },
    });

    await pushWebSocketEvent(task.tenantId, {
      type: 'task.status.changed',
      taskId: task.id,
      status: 'blocked',
    });
    return;
  }

  const { steps } = body;
  if (!steps || steps.length === 0) {
    throw new Error('Relay returned no steps and no clarification');
  }

  await db.insert(taskSteps).values(
    steps.map((step, index) => ({
      taskId: task.id,
      tenantId: task.tenantId,
      stepNumber: index + 1,
      title: step.title,
      description: step.description,
      toolName: step.toolName ?? null,
      confidenceScore: step.confidenceScore ?? null,
      status: 'pending' as const,
    }))
  );

  const scores = steps.filter(s => s.confidenceScore != null).map(s => s.confidenceScore!);
  const avgConfidence = scores.length > 0
    ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)
    : null;

  await db.update(agentTasks)
    .set({ status: 'awaiting_approval', confidenceScore: avgConfidence, updatedAt: new Date() })
    .where(eq(agentTasks.id, task.id));

  await db.insert(taskEvents).values({
    taskId: task.id,
    tenantId: task.tenantId,
    actorType: 'agent',
    actorId: task.agentId ?? 'system',
    eventType: 'plan_proposed',
    payload: { stepCount: steps.length },
  });

  await pushWebSocketEvent(task.tenantId, {
    type: 'task.status.changed',
    taskId: task.id,
    status: 'awaiting_approval',
  });

  const sqsUrl = process.env.SQS_PROCESSING_QUEUE_URL;
  if (sqsUrl) {
    await publishToQueue(sqsUrl, {
      type: 'notification.fire',
      tenantId: task.tenantId,
      messageType: 'task.awaiting_approval',
      actorId: task.agentId ?? 'system',
      actorType: 'agent',
      recipientIds: [task.createdBy],
      data: { taskId: task.id, taskTitle: task.title },
    });
  }
}

async function handleExecution(taskId: string) {
  const task = await db.query.agentTasks.findFirst({
    where: eq(agentTasks.id, taskId),
  });
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const agent = task.agentId
    ? (await db.select({ name: agents.name }).from(agents).where(eq(agents.id, task.agentId)).limit(1))[0]
    : null;

  const steps = await db.select()
    .from(taskSteps)
    .where(eq(taskSteps.taskId, taskId))
    .orderBy(asc(taskSteps.stepNumber));

  const watchdogKey = `task:watchdog:${taskId}`;
  const cache = getCacheClient();
  await cache.set(watchdogKey, JSON.stringify({ taskId, tenantId: task.tenantId, startedAt: Date.now() }), { ex: 600 });

  let response: Response;
  try {
    response = await fetch(`${RELAY_URL}/api/tasks/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-service-key': INTERNAL_SERVICE_KEY(),
      },
      body: JSON.stringify({
        taskId: task.id,
        agentId: task.agentId,
        tenantId: task.tenantId,
        taskTitle: task.title,
        taskDescription: task.description ?? '',
        agentName: agent?.name ?? null,
        referenceText: task.referenceText ?? null,
        links: task.links ?? [],
        steps: steps.map((s: typeof taskSteps.$inferSelect) => ({
          id: s.id,
          stepNumber: s.stepNumber,
          title: s.title,
          description: s.description,
          toolName: s.toolName,
        })),
      }),
    });
  } catch (err) {
    const reason = `Execution failed: relay unreachable or timed out`;
    console.error('[taskWorker] relay call failed', { taskId, error: (err as Error).message });
    await cache.del(watchdogKey);
    await db.update(agentTasks)
      .set({ status: 'blocked', blockedReason: reason, updatedAt: new Date() })
      .where(eq(agentTasks.id, taskId));
    await db.insert(taskEvents).values({
      taskId: task.id,
      tenantId: task.tenantId,
      actorType: 'agent',
      actorId: 'system',
      eventType: 'status_changed',
      payload: { from: task.status, to: 'blocked', reason },
    });
    await pushWebSocketEvent(task.tenantId, {
      type: 'task.status.changed',
      taskId: task.id,
      status: 'blocked',
    });
    return;
  }

  if (!response.ok) {
    // Relay rejected the execution — mark task blocked directly without HTTP round-trip
    const reason = `Relay rejected execution: HTTP ${response.status}`;
    await cache.del(watchdogKey);
    await db.update(agentTasks)
      .set({ status: 'blocked', blockedReason: reason, updatedAt: new Date() })
      .where(eq(agentTasks.id, taskId));

    await db.insert(taskEvents).values({
      taskId: task.id,
      tenantId: task.tenantId,
      actorType: 'agent',
      actorId: 'system',
      eventType: 'status_changed',
      payload: { from: task.status, to: 'blocked', reason },
    });

    await pushWebSocketEvent(task.tenantId, {
      type: 'task.status.changed',
      taskId: task.id,
      status: 'blocked',
    });
  }
}
