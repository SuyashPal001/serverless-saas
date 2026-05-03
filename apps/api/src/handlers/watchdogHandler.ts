import type { ScheduledHandler } from 'aws-lambda';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from '@serverless-saas/database/schema';
import { agentTasks, taskEvents } from '@serverless-saas/database/schema';
import { eq, and, sql } from 'drizzle-orm';
import { getCacheClient } from '@serverless-saas/cache';
import { pushWebSocketEvent } from '../lib/websocket';
import { publishToQueue } from '../lib/sqs';
import { initRuntimeSecrets } from '../lib/secrets';

const db = drizzle(neon(process.env.DATABASE_URL!), { schema });

let secretsInitialised = false;

export const handler: ScheduledHandler = async () => {
  if (!secretsInitialised) {
    await initRuntimeSecrets();
    secretsInitialised = true;
  }

  const sqsUrl = process.env.SQS_PROCESSING_QUEUE_URL;

  // --- Sweep 1: Stalled in_progress tasks (Redis watchdog key expired) ---
  const inProgressTasks = await db
    .select({
      id: agentTasks.id,
      tenantId: agentTasks.tenantId,
      agentId: agentTasks.agentId,
      createdBy: agentTasks.createdBy,
      title: agentTasks.title,
      status: agentTasks.status,
    })
    .from(agentTasks)
    .where(eq(agentTasks.status, 'in_progress'));

  if (inProgressTasks.length > 0) {
    const cache = getCacheClient();
    const stalled: typeof inProgressTasks = [];

    for (const task of inProgressTasks) {
      const exists = await cache.exists(`task:watchdog:${task.id}`);
      if (!exists) {
        stalled.push(task);
      }
    }

    if (stalled.length > 0) {
      console.log(`[watchdog] ${stalled.length} stalled task(s): ${stalled.map(t => t.id).join(', ')}`);

      const reason = 'Task timed out. The agent may have crashed. Please retry.';

      for (const task of stalled) {
        console.log('[Watchdog] Stalled task:', task.id, task.tenantId);

        // BUG-15+16: Add status predicate so the update is a no-op if:
        // (a) two watchdog invocations overlap and one already wrote 'blocked', or
        // (b) the agent finished just before the watchdog fired and set the task to
        //     'review'/'done'. In either case skip all notifications — another process
        //     already handled this task.
        const [updated] = await db.update(agentTasks)
          .set({ status: 'blocked', blockedReason: reason, updatedAt: new Date() })
          .where(and(
            eq(agentTasks.id, task.id),
            eq(agentTasks.status, 'in_progress'),
          ))
          .returning({ id: agentTasks.id });

        if (!updated) {
          console.log(`[watchdog] taskId=${task.id} no longer in_progress — skipping notification`);
          continue;
        }

        await db.insert(taskEvents).values({
          taskId: task.id,
          tenantId: task.tenantId,
          actorType: 'system',
          actorId: 'system',
          eventType: 'status_changed',
          payload: { from: 'in_progress', to: 'blocked', reason },
        });

        try {
          await pushWebSocketEvent(task.tenantId, {
            type: 'task.status.changed',
            taskId: task.id,
            status: 'blocked',
          });
        } catch (wsErr) {
          console.error(`[watchdog] WS push failed for taskId=${task.id}:`, wsErr);
        }

        if (sqsUrl) {
          try {
            await publishToQueue(sqsUrl, {
              type: 'notification.fire',
              tenantId: task.tenantId,
              messageType: 'task.failed',
              actorId: 'system',
              actorType: 'system',
              recipientIds: [task.createdBy],
              data: { taskId: task.id, taskTitle: task.title },
            });
          } catch (sqsErr) {
            console.error(`[watchdog] SQS publish failed for taskId=${task.id}:`, sqsErr);
          }
        }
      }
    }
  }

  // --- Sweep 2: Stale planning tasks (stuck > 10 minutes) ---
  const stalePlanning = await db
    .select({
      id: agentTasks.id,
      tenantId: agentTasks.tenantId,
      createdBy: agentTasks.createdBy,
      title: agentTasks.title,
    })
    .from(agentTasks)
    .where(and(
      eq(agentTasks.status, 'planning'),
      sql`${agentTasks.updatedAt} < NOW() - INTERVAL '10 minutes'`,
    ));

  for (const task of stalePlanning) {
    const reason = 'Planning timed out — relay may be unresponsive.';
    const [updated] = await db.update(agentTasks)
      .set({ status: 'blocked', blockedReason: reason, updatedAt: new Date() })
      .where(and(eq(agentTasks.id, task.id), eq(agentTasks.status, 'planning')))
      .returning({ id: agentTasks.id });

    if (!updated) continue;

    console.log(`[watchdog] Planning timed out for taskId=${task.id}`);

    try {
      await pushWebSocketEvent(task.tenantId, {
        type: 'task.status.changed',
        taskId: task.id,
        status: 'blocked',
      });
    } catch (wsErr) {
      console.error(`[watchdog] WS push failed for taskId=${task.id}:`, wsErr);
    }

    if (sqsUrl) {
      try {
        await publishToQueue(sqsUrl, {
          type: 'notification.fire',
          tenantId: task.tenantId,
          messageType: 'task.failed',
          actorId: 'system',
          actorType: 'system',
          recipientIds: [task.createdBy],
          data: { taskId: task.id, taskTitle: task.title },
        });
      } catch (sqsErr) {
        console.error(`[watchdog] SQS publish failed for taskId=${task.id}:`, sqsErr);
      }
    }
  }

  // --- Sweep 3: Stale awaiting_approval tasks (> 7 days) ---
  const staleApproval = await db
    .select({
      id: agentTasks.id,
      tenantId: agentTasks.tenantId,
      createdBy: agentTasks.createdBy,
      title: agentTasks.title,
    })
    .from(agentTasks)
    .where(and(
      eq(agentTasks.status, 'awaiting_approval'),
      sql`${agentTasks.updatedAt} < NOW() - INTERVAL '7 days'`,
    ));

  for (const task of staleApproval) {
    const reason = 'Plan approval timed out after 7 days.';
    const [updated] = await db.update(agentTasks)
      .set({ status: 'cancelled', blockedReason: reason, updatedAt: new Date() })
      .where(and(eq(agentTasks.id, task.id), eq(agentTasks.status, 'awaiting_approval')))
      .returning({ id: agentTasks.id });

    if (!updated) continue;

    console.log(`[watchdog] Approval timed out for taskId=${task.id}`);

    try {
      await pushWebSocketEvent(task.tenantId, {
        type: 'task.status.changed',
        taskId: task.id,
        status: 'cancelled',
      });
    } catch (wsErr) {
      console.error(`[watchdog] WS push failed for taskId=${task.id}:`, wsErr);
    }
  }
};
