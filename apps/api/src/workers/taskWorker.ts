import type { SQSHandler } from 'aws-lambda';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from '@serverless-saas/database/schema';
import { agentTasks, taskSteps, taskEvents } from '@serverless-saas/database/schema';
import { eq, asc } from 'drizzle-orm';

// Import schema from TypeScript source so esbuild bundles fresh — avoids stale dist/schema
// causing db.query.agentTasks to be undefined at runtime.
const db = drizzle(neon(process.env.DATABASE_URL!), { schema });
import { pushWebSocketEvent } from '../lib/websocket';
import { initRuntimeSecrets } from '../lib/secrets';

const RELAY_URL = process.env.RELAY_URL!;
const INTERNAL_SERVICE_KEY = () => process.env.INTERNAL_SERVICE_KEY!;

let secretsInitialised = false;

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
      ...(extraContext ? { extraContext } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`Relay planning failed: ${response.status}`);
  }

  const body = await response.json() as { steps: Array<{ title: string; description: string; toolName?: string }> };
  const { steps } = body;

  await db.insert(taskSteps).values(
    steps.map((step, index) => ({
      taskId: task.id,
      tenantId: task.tenantId,
      stepNumber: index + 1,
      title: step.title,
      description: step.description,
      toolName: step.toolName ?? null,
      status: 'pending' as const,
    }))
  );

  await db.update(agentTasks)
    .set({ status: 'awaiting_approval', updatedAt: new Date() })
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
}

async function handleExecution(taskId: string) {
  const task = await db.query.agentTasks.findFirst({
    where: eq(agentTasks.id, taskId),
  });
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const steps = await db.select()
    .from(taskSteps)
    .where(eq(taskSteps.taskId, taskId))
    .orderBy(asc(taskSteps.stepNumber));

  const response = await fetch(`${RELAY_URL}/api/tasks/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-service-key': INTERNAL_SERVICE_KEY(),
    },
    body: JSON.stringify({
      taskId: task.id,
      agentId: task.agentId,
      tenantId: task.tenantId,
      steps: steps.map((s: typeof taskSteps.$inferSelect) => ({
        id: s.id,
        stepNumber: s.stepNumber,
        title: s.title,
        description: s.description,
        toolName: s.toolName,
      })),
    }),
  });

  if (!response.ok) {
    // Relay rejected the execution — mark task blocked directly without HTTP round-trip
    const reason = `Relay rejected execution: HTTP ${response.status}`;
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
