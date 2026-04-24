import type { SQSHandler } from 'aws-lambda';
import { db } from '@serverless-saas/database';
import { agentTasks, taskSteps, taskEvents } from '@serverless-saas/database/schema';
import { eq } from 'drizzle-orm';
import { pushWebSocketEvent } from '../lib/websocket';

const RELAY_URL = process.env.RELAY_URL!;
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY!;

export const handler: SQSHandler = async (event) => {
  for (const record of event.Records) {
    const message = JSON.parse(record.body);
    const { type, taskId } = message;

    if (type === 'plan_task' || type === 'replan_task') {
      await handlePlanning(taskId);
    } else if (type === 'execute_task') {
      await handleExecution(taskId);
    }
  }
};

async function handlePlanning(taskId: string) {
  const task = await db.query.agentTasks.findFirst({
    where: eq(agentTasks.id, taskId),
  });
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const response = await fetch(`${RELAY_URL}/api/tasks/plan`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-service-key': INTERNAL_SERVICE_KEY,
    },
    body: JSON.stringify({
      taskId: task.id,
      agentId: task.agentId,
      tenantId: task.tenantId,
      title: task.title,
      description: task.description,
      acceptanceCriteria: task.acceptanceCriteria,
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
    actorId: task.agentId,
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
  console.log(`execute_task received for ${taskId} — not yet implemented`);
}
