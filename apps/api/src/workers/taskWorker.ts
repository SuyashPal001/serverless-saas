import type { SQSHandler } from 'aws-lambda';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from '@serverless-saas/database/schema';
import { agentTasks, taskSteps, taskEvents, agents, files } from '@serverless-saas/database/schema';
import { eq, asc, and, sql, inArray } from 'drizzle-orm';
import { storageService } from '@serverless-saas/storage';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

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

const MAX_STEPS_PER_TASK = 20;

let secretsInitialised = false;

const EXTRACTABLE_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/octet-stream', // fallback for .md uploaded without type
];

async function extractAttachments(
  tenantId: string,
  fileIds: string[]
): Promise<{ attachmentContext: string | null }> {
  if (!fileIds.length) return { attachmentContext: null };

  console.log('[extractAttachments] fileIds:', fileIds)

  const fileRows = await db
    .select()
    .from(files)
    .where(inArray(files.id, fileIds));

  console.log('[extractAttachments] fileRows:', fileRows.map(f => ({ id: f.id, name: f.name, mimeType: f.mimeType })))

  const parts: string[] = [];

  for (const file of fileRows) {
    try {
      const buffer = await storageService.downloadFile(tenantId, file.id);
      console.log('[extractAttachments] downloaded buffer', buffer.length, 'bytes for:', file.name)

      const isExtractable =
        EXTRACTABLE_TYPES.includes(file.mimeType ?? '') ||
        file.name.endsWith('.md') ||
        file.name.endsWith('.txt') ||
        file.name.endsWith('.csv');

      if (isExtractable) {
        let text: string;

        if (file.mimeType === 'application/pdf') {
          const parsed = await pdfParse(buffer);
          text = parsed.text.trim();
        } else if (
          file.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
          file.name.toLowerCase().endsWith('.docx')
        ) {
          const result = await mammoth.extractRawText({ buffer });
          text = result.value.trim();
        } else {
          text = buffer.toString('utf-8').trim();
        }

        console.log('[extractAttachments] extracted', text.length, 'chars from:', file.name)

        if (text) {
          parts.push(`[Attachment: ${file.name}]\n${text}`);
        }
      } else {
        // Unsupported type — send presigned URL for relay to fetch via web_fetch tool
        const url = await storageService.getDownloadUrl(tenantId, file.id);
        console.log('[extractAttachments] got url for:', file.name)
        parts.push(
          `[Attachment: ${file.name} (${file.mimeType ?? 'unknown type'})]\n` +
            `Download URL (expires in 1 hour): ${url}`
        );
      }
    } catch (err) {
      console.error('[extractAttachments] error for', file.name, ':', err)
      console.error(`[taskWorker] Failed to extract attachment ${file.name}:`, err);
      // Skip this file silently — don't fail the whole task
    }
  }

  const attachmentContext = parts.length > 0 ? parts.join('\n\n---\n\n') : null;
  console.log('[extractAttachments] result:', parts.length, 'parts, context length:', attachmentContext?.length ?? 0)

  return {
    attachmentContext,
  };
}

async function getPastSuccessfulPlans(tenantId: string, title: string, description: string | null | undefined, limit = 2): Promise<string | null> {
  const queryText = [title, description].filter(Boolean).join(' ');
  const embedding = await embedQuery(queryText);
  const vectorStr = `[${embedding.join(',')}]`;

  const result = await db.execute(sql`
    SELECT id, title
    FROM agent_tasks
    WHERE tenant_id = ${tenantId}
      AND status IN ('done', 'review')
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
      const stepList = steps.map((s, i) => `${i + 1}. ${s.title}${s.description ? ' — ' + s.description : ''}`).join('\n');
      sections.push(`Past task: "${row.title}"\nSteps taken:\n${stepList}`);
    }
  }

  if (sections.length === 0) return null;
  return `---\nContext: Here is how this workspace previously handled similar requests. Use as reference only — adapt to current task.\n\n${sections.join('\n\n')}\n---`;
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
      await handlePlanning(taskId, message.extraContext as string | undefined, message.feedbackHistoryMap as Record<string, Array<{ round: number; feedback: string; generalInstruction: string | null; replannedAt: string }>> | undefined);
    } else if (type === 'execute_task') {
      await handleExecution(taskId);
    }
  }
};

async function handlePlanning(taskId: string, extraContext?: string, feedbackHistoryMap?: Record<string, Array<{ round: number; feedback: string; generalInstruction: string | null; replannedAt: string }>>) {
  const task = await db.query.agentTasks.findFirst({
    where: eq(agentTasks.id, taskId),
  });
  if (!task) throw new Error(`Task not found: ${taskId}`);

  try {
    // BUG-3: Delete existing pending steps before relay call — makes retry idempotent.
    // If a prior SQS attempt inserted steps but failed before updating task status,
    // retrying without this delete would append a second set of steps on top of the first.
    await db.delete(taskSteps)
      .where(and(
        eq(taskSteps.taskId, task.id),
        eq(taskSteps.status, 'pending'),
      ));

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

    const { attachmentContext } = await extractAttachments(
      task.tenantId,
      task.attachmentFileIds ?? []
    );

    // BUG-1+2: AbortSignal.timeout(55_000) prevents the Lambda from hanging
    // indefinitely on a slow/unresponsive relay. Without it, Node's default fetch
    // has no timeout; a hung relay would exhaust the Lambda timeout and leave the
    // task permanently stuck in 'planning' with no user-visible error.
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
        attachmentContext: attachmentContext ?? null,
        ...(combinedExtraContext ? { extraContext: combinedExtraContext } : {}),
      }),
      signal: AbortSignal.timeout(55_000),
    });

    if (!response.ok) {
      throw new Error(`Relay planning failed: ${response.status}`);
    }

    // BUG-4: Guard against malformed JSON — relay or Gemini can return HTTP 200
    // with a truncated/non-JSON body. Without this, response.json() throws and
    // the error propagates to the SQS handler, triggering unbounded retries.
    let body: {
      steps?: Array<{ title: string; description: string; toolName?: string; confidenceScore?: number; reasoning?: string }>;
      clarificationNeeded?: boolean;
      questions?: string[];
    };
    try {
      body = await response.json();
    } catch (jsonErr) {
      throw new Error(`Relay returned malformed JSON: ${(jsonErr as Error).message}`);
    }

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
    if (steps.length > MAX_STEPS_PER_TASK) {
      throw new Error(`Relay proposed ${steps.length} steps (max ${MAX_STEPS_PER_TASK})`);
    }

    const insertedSteps = await db.insert(taskSteps).values(
      steps.map((step, index) => ({
        taskId: task.id,
        tenantId: task.tenantId,
        stepNumber: index + 1,
        title: step.title,
        description: step.description,
        toolName: step.toolName ?? null,
        reasoning: step.reasoning ?? null,
        confidenceScore: step.confidenceScore ?? null,
        status: 'pending' as const,
        ...(feedbackHistoryMap?.[step.title] ? { feedbackHistory: feedbackHistoryMap[step.title] } : {}),
      }))
    ).returning({
      id: taskSteps.id,
      stepNumber: taskSteps.stepNumber,
      title: taskSteps.title,
      description: taskSteps.description,
      toolName: taskSteps.toolName,
      reasoning: taskSteps.reasoning,
      confidenceScore: taskSteps.confidenceScore,
    });

    // Stream steps to frontend one-by-one so the UI can animate them in during planning
    for (const step of insertedSteps) {
      await pushWebSocketEvent(task.tenantId, {
        type: 'task.step.created',
        taskId: task.id,
        step: {
          id: step.id,
          stepNumber: step.stepNumber,
          title: step.title,
          description: step.description ?? null,
          toolName: step.toolName ?? null,
          reasoning: step.reasoning ?? null,
          confidenceScore: step.confidenceScore ?? null,
          status: 'pending',
        },
      });
    }

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
  } catch (err) {
    // BUG-1: Any relay/DB/JSON error marks the task blocked rather than rethrowing to
    // SQS. Rethrowing would cause unbounded retries ending in DLQ, leaving the task
    // permanently stuck in 'planning' with no user-visible feedback.
    const reason = `Planning failed: ${(err as Error).message}`;
    console.error('[handlePlanning] fatal error', { taskId, error: (err as Error).message });
    try {
      await db.update(agentTasks)
        .set({ status: 'blocked', blockedReason: reason, updatedAt: new Date() })
        .where(eq(agentTasks.id, taskId));
      await db.insert(taskEvents).values({
        taskId: task.id,
        tenantId: task.tenantId,
        actorType: 'agent',
        actorId: task.agentId ?? 'system',
        eventType: 'status_changed',
        payload: { from: task.status, to: 'blocked', reason },
      });
      await pushWebSocketEvent(task.tenantId, {
        type: 'task.status.changed',
        taskId: task.id,
        status: 'blocked',
      });
    } catch (recoveryErr) {
      console.error('[handlePlanning] recovery write failed', { taskId, error: (recoveryErr as Error).message });
    }
    // Do not rethrow — let SQS ack the message cleanly.
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

  const pendingSteps = steps.filter(s => s.status === 'pending');

  // If all steps already completed (SQS retry scenario), skip relay
  if (pendingSteps.length === 0 && steps.every(s => s.status === 'done')) {
    console.log(`[taskWorker] All steps already done for task ${taskId}, skipping relay`);
    await db.update(agentTasks)
      .set({ status: 'review', completedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(agentTasks.id, taskId), eq(agentTasks.status, 'in_progress')));
    await pushWebSocketEvent(task.tenantId, {
      type: 'task.status.changed',
      taskId: task.id,
      status: 'review',
    });
    return;
  }

  const watchdogKey = `task:watchdog:${taskId}`;
  const cache = getCacheClient();
  await cache.set(watchdogKey, JSON.stringify({ taskId, tenantId: task.tenantId, startedAt: Date.now() }), { ex: 600 });

  const { attachmentContext } = await extractAttachments(
    task.tenantId,
    task.attachmentFileIds ?? []
  );

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
        attachmentContext: attachmentContext ?? null,
        steps: pendingSteps.map((s: typeof taskSteps.$inferSelect) => ({
          id: s.id,
          stepNumber: s.stepNumber,
          title: s.title,
          description: s.description,
          toolName: s.toolName,
        })),
      }),
      signal: AbortSignal.timeout(290_000),
    });
  } catch (err: unknown) {
    const isTimeout = err instanceof Error &&
      (err.name === 'AbortError' ||
       err.name === 'TimeoutError')

    const reason = isTimeout
      ? 'Execution timeout — relay took too long'
      : `Relay execution failed: ${err instanceof Error ? err.message : String(err)}`

    await db.update(agentTasks)
      .set({
        status: 'blocked',
        blockedReason: reason,
        updatedAt: new Date()
      })
      .where(eq(agentTasks.id, taskId))

    await pushWebSocketEvent(task.tenantId, {
      type: 'task.status.changed',
      taskId,
      status: 'blocked',
      blockedReason: reason,
    })
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
