import { randomUUID } from 'crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, desc, asc, count, sql, inArray } from 'drizzle-orm';
import { db } from '@serverless-saas/database';
import { publishToQueue } from '../lib/sqs';
import { agentTasks, taskSteps, taskEvents, taskComments, agents } from '@serverless-saas/database/schema/agents';
import { users } from '@serverless-saas/database/schema/auth';
import { auditLog } from '@serverless-saas/database/schema/audit';
import { hasPermission } from '@serverless-saas/permissions';
import { pushWebSocketEvent } from '../lib/websocket';
import { embedTexts } from '@serverless-saas/ai';
import type { AppEnv } from '../types';
export const tasksRoutes = new Hono<AppEnv>();

export const VALID_USER_TRANSITIONS: Record<string, string[]> = {
  backlog: ['todo', 'cancelled'],
  todo: ['backlog', 'cancelled'],
  planning: [],
  awaiting_approval: [],
  in_progress: [],
  blocked: ['cancelled'],
  review: ['done', 'cancelled'],
  done: [],
  cancelled: [],
};

// POST /tasks — create task and generate plan via relay
tasksRoutes.post('/', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];
    const userId = c.get('userId') as string;

    if (!hasPermission(permissions, 'agent_tasks', 'create')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const schema = z.object({
        agentId: z.string().uuid().optional(),
        assigneeId: z.string().uuid().optional(),
        title: z.string().min(1).max(200),
        description: z.string().optional(),
        referenceText: z.string().optional(),
        acceptanceCriteria: z.array(z.object({
            text: z.string(),
            checked: z.boolean().default(false),
        })).default([]),
        estimatedHours: z.number().positive().optional(),
        priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
        links: z.preprocess(
            (v) => {
                const arr = typeof v === 'string' ? JSON.parse(v) : v
                if (!Array.isArray(arr)) return arr
                return arr.map((url: unknown) =>
                    typeof url === 'string' && !/^https?:\/\//i.test(url)
                        ? `https://${url}`
                        : url
                )
            },
            z.array(z.string().url()).optional(),
        ),
        attachmentFileIds: z.preprocess(
            (v) => (typeof v === 'string' ? JSON.parse(v) : v),
            z.array(z.string().uuid()).optional(),
        ),
        milestoneId: z.string().uuid().nullable().optional(),
        planId: z.string().uuid().nullable().optional(),
        parentTaskId: z.string().uuid().nullable().optional(),
    });

    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
        return c.json({ error: result.error.errors[0].message }, 400);
    }

    const { agentId, assigneeId, title, description, referenceText, acceptanceCriteria, estimatedHours, priority, links, attachmentFileIds, milestoneId, planId, parentTaskId } = result.data;

    if (agentId) {
        const agent = (await db.select().from(agents).where(and(
            eq(agents.id, agentId),
            eq(agents.tenantId, tenantId),
        )).limit(1))[0];

        if (!agent) {
            return c.json({ error: 'Agent not found in tenant' }, 404);
        }
    }

    const [task] = await db.insert(agentTasks).values({
        tenantId,
        agentId: agentId ?? null,
        assigneeId: assigneeId ?? null,
        createdBy: userId,
        title,
        description,
        referenceText: referenceText ?? null,
        acceptanceCriteria,
        estimatedHours: estimatedHours !== undefined ? String(estimatedHours) : undefined,
        priority: priority ?? 'medium',
        links: Array.isArray(links) ? links : [],
        attachmentFileIds: sql`ARRAY[${sql.join(
            (Array.isArray(attachmentFileIds) ? attachmentFileIds : []).map(id => sql`${id}`),
            sql`, `
        )}]::text[]`,
        milestoneId: milestoneId ?? null,
        planId: planId ?? null,
        parentTaskId: parentTaskId ?? null,
        status: 'backlog',
    }).returning();

    await db.insert(taskEvents).values({
        taskId: task.id,
        tenantId,
        actorType: 'system',
        actorId: 'system',
        eventType: 'status_changed',
        payload: { from: null, to: 'backlog' },
    });

    try {
        await db.insert(auditLog).values({
            tenantId,
            actorId: userId ?? 'system',
            actorType: 'human',
            action: 'task_created',
            resource: 'agent_task',
            resourceId: task.id,
            metadata: { agentId },
            traceId: c.get('traceId') ?? '',
        });
    } catch (auditErr) {
        console.error('Audit log write failed:', auditErr);
    }

    // Fire-and-forget: generate and store embedding for future RAG-injected planning
    const embedText = [title, description].filter(Boolean).join(' ');
    embedTexts([embedText], 'RETRIEVAL_DOCUMENT')
      .then(([embedding]) => db.update(agentTasks)
        .set({ embedding })
        .where(eq(agentTasks.id, task.id))
      )
      .catch((err: unknown) => console.error('[tasks] embedding generation failed (non-fatal):', (err as Error).message));

    return c.json({ data: { task: { ...task, sortOrder: task.sortOrder ?? 0 }, steps: [] } }, 201);
});

// GET /tasks — list tasks for tenant with optional status/agentId filters
tasksRoutes.get('/', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!hasPermission(permissions, 'agent_tasks', 'read')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const statusFilter = c.req.query('status');
    const agentIdFilter = c.req.query('agentId');
    const parentTaskIdFilter = c.req.query('parentTaskId');

    // Internal states are hidden from the board list unless explicitly requested via ?status=
    const boardCondition = !statusFilter
        ? sql`${agentTasks.status} NOT IN ('planning', 'awaiting_approval')`
        : eq(agentTasks.status, statusFilter as any);

    const taskList = await db.select()
        .from(agentTasks)
        .where(and(
            eq(agentTasks.tenantId, tenantId),
            boardCondition,
            agentIdFilter ? eq(agentTasks.agentId, agentIdFilter) : undefined,
            parentTaskIdFilter ? eq(agentTasks.parentTaskId, parentTaskIdFilter) : undefined,
        ))
        .orderBy(asc(agentTasks.sortOrder), desc(agentTasks.createdAt));

    const tasksWithCounts = await Promise.all(taskList.map(async (task: typeof agentTasks.$inferSelect) => {
        const [{ value: totalSteps }] = await db
            .select({ value: count() })
            .from(taskSteps)
            .where(eq(taskSteps.taskId, task.id));

        const [{ value: completedSteps }] = await db
            .select({ value: count() })
            .from(taskSteps)
            .where(and(
                eq(taskSteps.taskId, task.id),
                eq(taskSteps.status, 'done'),
            ));

        return { 
            ...task, 
            sortOrder: task.sortOrder ?? 0,
            totalSteps: Number(totalSteps), 
            completedSteps: Number(completedSteps) 
        };
    }));

    return c.json({ data: tasksWithCounts });
});

// GET /tasks/:taskId — fetch single task with steps and events
tasksRoutes.get('/:taskId', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!hasPermission(permissions, 'agent_tasks', 'read')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const taskId = c.req.param('taskId');

    const task = (await db.select().from(agentTasks).where(and(
        eq(agentTasks.id, taskId),
        eq(agentTasks.tenantId, tenantId),
    )).limit(1))[0];

    if (!task) {
        return c.json({ error: 'Task not found' }, 404);
    }

    const taskWithDefaults = {
        ...task,
        sortOrder: task.sortOrder ?? 0
    };

    const steps = await db.select()
        .from(taskSteps)
        .where(eq(taskSteps.taskId, taskId))
        .orderBy(asc(taskSteps.stepNumber));

    const events = await db.select()
        .from(taskEvents)
        .where(eq(taskEvents.taskId, taskId))
        .orderBy(asc(taskEvents.createdAt));

    return c.json({ data: { task: taskWithDefaults, steps, events } });
});

// PUT /tasks/:taskId/plan/approve — approve or reject a proposed plan
tasksRoutes.put('/:taskId/plan/approve', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];
    const userId = c.get('userId') as string;

    if (!hasPermission(permissions, 'agent_tasks', 'update')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const taskId = c.req.param('taskId');

    const schema = z.object({
        approved: z.boolean(),
        stepFeedback: z.array(z.object({
            stepId: z.string().uuid(),
            feedback: z.string(),
        })).optional(),
        extraContext: z.string().optional(),
    });

    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
        return c.json({ error: result.error.errors[0].message }, 400);
    }

    const task = (await db.select().from(agentTasks).where(and(
        eq(agentTasks.id, taskId),
        eq(agentTasks.tenantId, tenantId),
    )).limit(1))[0];

    if (!task) {
        return c.json({ error: 'Task not found' }, 404);
    }

    if (task.status !== 'awaiting_approval' && task.status !== 'blocked') {
        return c.json({ error: 'Task plan cannot be reviewed in its current state' }, 400);
    }

    const { approved, stepFeedback, extraContext } = result.data;

    if (!approved) {
        if (stepFeedback && stepFeedback.length > 0) {
            await Promise.all(stepFeedback.map(({ stepId, feedback }) =>
                db.update(taskSteps)
                    .set({ humanFeedback: feedback, updatedAt: new Date() })
                    .where(and(eq(taskSteps.id, stepId), eq(taskSteps.taskId, taskId)))
            ));
        }

        await db.insert(taskEvents).values({
            taskId,
            tenantId,
            actorType: 'human',
            actorId: userId,
            eventType: 'plan_rejected',
            payload: { stepFeedback: stepFeedback ?? [] },
        });

        // Collect feedback from pending steps before deleting them
        const pendingSteps: (typeof taskSteps.$inferSelect)[] = await db.select()
            .from(taskSteps)
            .where(and(eq(taskSteps.taskId, taskId), eq(taskSteps.status, 'pending')));

        const stepFeedbackContext = pendingSteps
            .filter((s) => s.humanFeedback)
            .map((s) => `- Step "${s.title}": ${s.humanFeedback}`)
            .join('\n');

        // Write feedbackHistory to each step before hard delete, then build carry-forward map
        const feedbackHistoryMap: Record<string, Array<{ round: number; feedback: string; generalInstruction: string | null; replannedAt: string }>> = {};
        const stepsWithFeedback = pendingSteps.filter((s) => s.humanFeedback);
        if (stepsWithFeedback.length > 0) {
            const replannedAt = new Date().toISOString();
            await Promise.all(stepsWithFeedback.map(async (s) => {
                const existingHistory = (s.feedbackHistory as Array<{ round: number; feedback: string; generalInstruction: string | null; replannedAt: string }>) ?? [];
                const entry = {
                    round: existingHistory.length + 1,
                    feedback: s.humanFeedback!,
                    generalInstruction: extraContext?.trim() ?? null,
                    replannedAt,
                };
                await db.update(taskSteps)
                    .set({ feedbackHistory: sql`COALESCE(${taskSteps.feedbackHistory}, '[]'::jsonb) || ${JSON.stringify([entry])}::jsonb` })
                    .where(eq(taskSteps.id, s.id));
                feedbackHistoryMap[s.title] = [...existingHistory, entry];
            }));
        }

        const parts: string[] = [];
        if (extraContext?.trim()) parts.push(`General instruction: ${extraContext.trim()}`);
        if (stepFeedbackContext) parts.push(stepFeedbackContext);
        const fullFeedbackContext = parts.join('\n');

        console.log('[SQS] Publishing replan_task for task', taskId);
        try {
            await publishToQueue(process.env.AGENT_TASK_QUEUE_URL!, {
                type: 'replan_task',
                taskId,
                traceId: randomUUID(),
                ...(fullFeedbackContext ? { extraContext: fullFeedbackContext } : {}),
                ...(Object.keys(feedbackHistoryMap).length > 0 ? { feedbackHistoryMap } : {}),
            });
        } catch (sqsErr) {
            console.error('[SQS] replan_task publish failed for task', taskId, sqsErr);
            return c.json({ error: 'Failed to queue task for replanning. Please retry.' }, 502);
        }

        // Delete pending steps only after a successful publish — if publish fails above,
        // steps are preserved so the user can retry without losing the plan.
        // BUG-5: Wrap in try/catch. If delete throws after SQS publish succeeded, the
        // replan_task message is already queued and the worker's idempotent delete (BUG-3)
        // will clean up on arrival. Failing the API request here would give the user a
        // confusing 500 despite the replan being successfully enqueued.
        try {
            await db.delete(taskSteps).where(and(
                eq(taskSteps.taskId, taskId),
                eq(taskSteps.status, 'pending'),
            ));
        } catch (deleteErr) {
            console.error('[replan] step delete failed after SQS publish (non-fatal, worker will clean up):', deleteErr);
        }

        const [updatedTask] = await db.update(agentTasks)
            .set({ status: 'planning', planApprovedAt: null, updatedAt: new Date() })
            .where(and(eq(agentTasks.id, taskId), eq(agentTasks.tenantId, tenantId)))
            .returning();

        return c.json({ data: { task: { ...updatedTask, sortOrder: updatedTask.sortOrder ?? 0 }, steps: [] } });
    }

    // approved === true
    // Enforce per-tenant concurrent task limit before transitioning to ready (L2-4)
    const CONCURRENT_TASK_LIMITS: Record<string, number> = {
        free: 1, starter: 3, business: 10, enterprise: 50,
    };
    const plan = requestContext?.tenant?.plan ?? 'free';
    const maxConcurrent = CONCURRENT_TASK_LIMITS[plan] ?? 1;
    const [{ value: activeCount }] = await db
        .select({ value: count() })
        .from(agentTasks)
        .where(and(
            eq(agentTasks.tenantId, tenantId),
            eq(agentTasks.status, 'in_progress'),
        ));
    if (Number(activeCount) >= maxConcurrent) {
        return c.json({
            error: `Concurrent task limit reached (${maxConcurrent} for ${plan} plan). Wait for a running task to complete.`,
            code: 'CONCURRENT_LIMIT',
        }, 429);
    }

    // BUG-6: Add status predicate to make the update atomic with the guard above.
    // Without it, two concurrent double-click requests both pass the guard and both
    // publish execute_task, running the task twice. With it, the second concurrent
    // request updates 0 rows and gets a 409.
    const [updatedTask] = await db.update(agentTasks)
        .set({
            status: 'ready',
            planApprovedAt: new Date(),
            planApprovedBy: userId,
            updatedAt: new Date(),
        })
        .where(and(
            eq(agentTasks.id, taskId),
            eq(agentTasks.tenantId, tenantId),
            eq(agentTasks.status, 'awaiting_approval'),
        ))
        .returning();

    if (!updatedTask) {
        return c.json({ error: 'Task plan cannot be reviewed in its current state' }, 409);
    }

    await db.insert(taskEvents).values({
        taskId,
        tenantId,
        actorType: 'human',
        actorId: userId,
        eventType: 'plan_approved',
        payload: {},
    });

    console.log('[SQS] Publishing execute_task for task', taskId);
    try {
        await publishToQueue(process.env.AGENT_TASK_QUEUE_URL!, { type: 'execute_task', taskId, traceId: randomUUID() });
    } catch (sqsErr) {
        console.error('[SQS] execute_task publish failed for task', taskId, sqsErr);
        await db.update(agentTasks)
            .set({ status: 'blocked', blockedReason: 'Failed to queue task for execution. Please retry.', updatedAt: new Date() })
            .where(and(eq(agentTasks.id, taskId), eq(agentTasks.tenantId, tenantId)));
        return c.json({ error: 'Failed to queue task for execution. Please retry.' }, 502);
    }

    // BUG-7: Push WS event for the 'ready' transition so the board updates immediately
    // after approval — without this the UI is stale until the worker fires 'in_progress'.
    try {
        await pushWebSocketEvent(tenantId, { type: 'task.status.changed', taskId, status: 'ready' });
    } catch (wsErr) {
        console.error('WS push failed (non-fatal):', wsErr);
    }

    return c.json({ data: { task: updatedTask } });
});

// PUT /tasks/:taskId/workflow/approve — approve a suspended Mastra workflow at approvalStep
tasksRoutes.put('/:taskId/workflow/approve', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!hasPermission(permissions, 'agent_tasks', 'update')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const taskId = c.req.param('taskId');

    const task = (await db.select({ id: agentTasks.id, status: agentTasks.status, tenantId: agentTasks.tenantId })
        .from(agentTasks)
        .where(and(eq(agentTasks.id, taskId), eq(agentTasks.tenantId, tenantId)))
        .limit(1))[0];

    if (!task) return c.json({ error: 'Task not found' }, 404);
    if (task.status !== 'awaiting_approval') {
        return c.json({ error: 'Task is not awaiting workflow approval' }, 400);
    }

    const relayUrl = process.env.RELAY_URL;
    if (!relayUrl) {
        return c.json({ error: 'Relay not configured' }, 503);
    }

    const res = await fetch(`${relayUrl}/api/tasks/${taskId}/resume`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-internal-service-key': process.env.INTERNAL_SERVICE_KEY ?? '',
            'x-trace-id': c.get('traceId') ?? randomUUID(),
        },
        body: JSON.stringify({}),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error(`[tasks/workflow/approve] relay resume failed ${res.status}: ${text}`);
        return c.json({ error: 'Failed to resume workflow' }, 502);
    }

    return c.json({ success: true });
});

// POST /tasks/:taskId/plan — manually trigger planning (task must be in todo)
tasksRoutes.post('/:taskId/plan', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];
    const userId = c.get('userId') as string;

    if (!hasPermission(permissions, 'agent_tasks', 'update')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const taskId = c.req.param('taskId');

    const task = (await db.select().from(agentTasks).where(and(
        eq(agentTasks.id, taskId),
        eq(agentTasks.tenantId, tenantId),
    )).limit(1))[0];

    if (!task) {
        return c.json({ error: 'Task not found' }, 404);
    }

    if (task.status !== 'todo') {
        return c.json({ error: 'Task must be in todo status to generate a plan' }, 400);
    }

    if (!task.agentId) {
        return c.json({ error: 'An agent must be assigned to generate a plan' }, 400);
    }

    const [updatedTask] = await db.update(agentTasks)
        .set({ status: 'planning', updatedAt: new Date() })
        .where(and(eq(agentTasks.id, taskId), eq(agentTasks.tenantId, tenantId)))
        .returning();

    await db.insert(taskEvents).values({
        taskId,
        tenantId,
        actorType: 'human',
        actorId: userId,
        eventType: 'status_changed',
        payload: { from: 'todo', to: 'planning' },
    });

    console.log('[SQS] Publishing plan_task for task', taskId);
    try {
        await publishToQueue(process.env.AGENT_TASK_QUEUE_URL!, { type: 'plan_task', taskId, traceId: randomUUID() });
    } catch (sqsErr) {
        console.error('[SQS] plan_task publish failed for task', taskId, sqsErr);
        await db.update(agentTasks)
            .set({ status: 'blocked', blockedReason: 'Failed to queue task for planning. Please retry.', updatedAt: new Date() })
            .where(and(eq(agentTasks.id, taskId), eq(agentTasks.tenantId, tenantId)));
        return c.json({ error: 'Failed to queue task for planning. Please retry.' }, 502);
    }

    try {
        await pushWebSocketEvent(tenantId, { type: 'task.status.changed', taskId, status: 'planning' });
    } catch (wsErr) {
        console.error('WS push failed (non-fatal):', wsErr);
    }

    return c.json({ data: { task: { ...updatedTask, sortOrder: updatedTask.sortOrder ?? 0 } } });
});

// POST /tasks/:taskId/clarify — provide clarification for a blocked task
tasksRoutes.post('/:taskId/clarify', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];
    const userId = c.get('userId') as string;

    if (!hasPermission(permissions, 'agent_tasks', 'update')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const taskId = c.req.param('taskId');

    const schema = z.object({
        answer: z.string().min(1),
    });

    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
        return c.json({ error: result.error.errors[0].message }, 400);
    }

    const task = (await db.select().from(agentTasks).where(and(
        eq(agentTasks.id, taskId),
        eq(agentTasks.tenantId, tenantId),
    )).limit(1))[0];

    if (!task) {
        return c.json({ error: 'Task not found' }, 404);
    }

    if (task.status !== 'blocked') {
        return c.json({ error: 'Task is not awaiting clarification' }, 400);
    }

    const { answer } = result.data;

    await db.insert(taskEvents).values({
        taskId,
        tenantId,
        actorType: 'human',
        actorId: userId,
        eventType: 'clarification_answered',
        payload: { answer },
    });

    const [updatedTask] = await db.update(agentTasks)
        .set({ status: 'planning', blockedReason: null, planApprovedAt: null, updatedAt: new Date() })
        .where(and(eq(agentTasks.id, taskId), eq(agentTasks.tenantId, tenantId)))
        .returning();

    await db.insert(taskEvents).values({
        taskId,
        tenantId,
        actorType: 'system',
        actorId: 'system',
        eventType: 'status_changed',
        payload: { from: 'blocked', to: 'planning' },
    });

    console.log('[SQS] Publishing replan_task (clarification) for task', taskId);
    try {
        await publishToQueue(process.env.AGENT_TASK_QUEUE_URL!, {
            type: 'replan_task',
            taskId,
            traceId: randomUUID(),
            extraContext: 'User clarification: ' + answer,
        });
    } catch (sqsErr) {
        console.error('[SQS] replan_task (clarification) publish failed for task', taskId, sqsErr);
        await db.update(agentTasks)
            .set({ status: 'blocked', blockedReason: 'Failed to queue task for replanning. Please retry.', updatedAt: new Date() })
            .where(and(eq(agentTasks.id, taskId), eq(agentTasks.tenantId, tenantId)));
        return c.json({ error: 'Failed to queue task for replanning. Please retry.' }, 502);
    }

    try {
        await pushWebSocketEvent(tenantId, {
            type: 'task.status.changed',
            taskId,
            status: 'planning',
        });
    } catch (wsErr) {
        console.error('WS push failed (non-fatal):', wsErr);
    }

    return c.json({ data: { task: { ...updatedTask, sortOrder: updatedTask.sortOrder ?? 0 } } });
});

// DELETE /tasks/:taskId — soft-cancel a task
tasksRoutes.delete('/:taskId', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];
    const userId = c.get('userId') as string;

    if (!hasPermission(permissions, 'agent_tasks', 'delete')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const taskId = c.req.param('taskId');

    const task = (await db.select().from(agentTasks).where(and(
        eq(agentTasks.id, taskId),
        eq(agentTasks.tenantId, tenantId),
    )).limit(1))[0];

    if (!task) {
        return c.json({ error: 'Task not found' }, 404);
    }

    if (task.status === 'in_progress') {
        return c.json({ error: 'Cannot delete a running task. Cancel it first.' }, 400);
    }

    await db.update(agentTasks)
        .set({ status: 'cancelled', cancelReason: 'Deleted by user', updatedAt: new Date() })
        .where(and(eq(agentTasks.id, taskId), eq(agentTasks.tenantId, tenantId)));

    try {
        await db.insert(auditLog).values({
            tenantId,
            actorId: userId ?? 'system',
            actorType: 'human',
            action: 'task_deleted',
            resource: 'agent_task',
            resourceId: taskId,
            metadata: {},
            traceId: c.get('traceId') ?? '',
        });
    } catch (auditErr) {
        console.error('Audit log write failed:', auditErr);
    }

    return c.json({ success: true });
});

// PATCH /tasks/:taskId — update task details
tasksRoutes.patch('/:taskId', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];
    const userId = c.get('userId') as string;

    if (!hasPermission(permissions, 'agent_tasks', 'update')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const taskId = c.req.param('taskId');

    const schema = z.object({
        title: z.string().min(1).max(200).optional(),
        description: z.string().nullable().optional(),
        estimatedHours: z.number().positive().nullable().optional(),
        acceptanceCriteria: z.array(z.object({
            text: z.string(),
            checked: z.boolean()
        })).optional(),
        dueDate: z.string().datetime().nullable().optional(),
        status: z.enum(['backlog', 'todo', 'in_progress', 'review', 'blocked', 'done', 'cancelled']).optional(),
        startedAt: z.string().datetime().nullable().optional(),
        links: z.preprocess(
            (v) => {
                const arr = typeof v === 'string' ? JSON.parse(v) : v
                if (!Array.isArray(arr)) return arr
                return arr.map((url: unknown) =>
                    typeof url === 'string' && !/^https?:\/\//i.test(url)
                        ? `https://${url}`
                        : url
                )
            },
            z.array(z.string().url()).optional(),
        ),
        attachmentFileIds: z.preprocess(
            (v) => (typeof v === 'string' ? JSON.parse(v) : v),
            z.array(z.string().uuid()).optional(),
        ),
        sortOrder: z.number().int().optional(),
        priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
        assigneeId: z.string().uuid().nullable().optional(),
        agentId: z.string().uuid().nullable().optional(),
        referenceText: z.string().nullable().optional(),
    });

    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
        return c.json({ error: result.error.errors[0].message }, 400);
    }

    const task = (await db.select().from(agentTasks).where(and(
        eq(agentTasks.id, taskId),
        eq(agentTasks.tenantId, tenantId),
    )).limit(1))[0];

    if (!task) {
        return c.json({ error: 'Task not found' }, 404);
    }

    const { title, description, estimatedHours, acceptanceCriteria, dueDate, status, startedAt, links, attachmentFileIds, sortOrder, priority, assigneeId, agentId, referenceText } = result.data;

    if (agentId) {
        const agent = (await db.select().from(agents).where(and(
            eq(agents.id, agentId),
            eq(agents.tenantId, tenantId),
        )).limit(1))[0];
        if (!agent) return c.json({ error: 'Agent not found in tenant' }, 404);
    }

    const updateValues: Partial<typeof agentTasks.$inferInsert> = {
        updatedAt: new Date(),
    };

    if (title !== undefined) updateValues.title = title;
    if (description !== undefined) updateValues.description = description;
    if (estimatedHours !== undefined) updateValues.estimatedHours = estimatedHours !== null ? String(estimatedHours) : null;
    if (acceptanceCriteria !== undefined) updateValues.acceptanceCriteria = acceptanceCriteria;
    if (dueDate !== undefined) updateValues.dueDate = dueDate !== null ? new Date(dueDate) : null;
    if (status !== undefined && status !== task.status) {
      const allowed = VALID_USER_TRANSITIONS[task.status] ?? [];
      if (!allowed.includes(status)) {
        return c.json({ error: `Cannot transition from ${task.status} to ${status}` }, 400);
      }
    }
    if (status !== undefined) updateValues.status = status;
    if (startedAt !== undefined) updateValues.startedAt = startedAt !== null ? new Date(startedAt) : null;
    if (links !== undefined) updateValues.links = links;
    if (attachmentFileIds !== undefined) {
        (updateValues as any).attachmentFileIds = sql`ARRAY[${sql.join(
            attachmentFileIds.map(id => sql`${id}`),
            sql`, `
        )}]::text[]`;
    }
    if (sortOrder !== undefined) updateValues.sortOrder = sortOrder;
    if (priority !== undefined) updateValues.priority = priority;
    if (assigneeId !== undefined) updateValues.assigneeId = assigneeId;
    if (agentId !== undefined) updateValues.agentId = agentId;
    if (referenceText !== undefined) updateValues.referenceText = referenceText;

    const [updatedTask] = await db.update(agentTasks)
        .set(updateValues)
        .where(and(eq(agentTasks.id, taskId), eq(agentTasks.tenantId, tenantId)))
        .returning();

    if (status === 'todo' && task.status === 'backlog') {
        try {
            await pushWebSocketEvent(tenantId, { type: 'task.status.changed', taskId, status: 'todo' });
        } catch (wsErr) {
            console.error('WS push failed (non-fatal):', wsErr);
        }
    }

    try {
        await db.insert(auditLog).values({
            tenantId,
            actorId: userId ?? 'system',
            actorType: 'human',
            action: 'task_updated',
            resource: 'agent_task',
            resourceId: taskId,
            metadata: { fields: Object.keys(result.data) },
            traceId: c.get('traceId') ?? '',
        });
    } catch (auditErr) {
        console.error('Audit log write failed:', auditErr);
    }

    return c.json({ data: updatedTask });
});

// GET /tasks/:taskId/comments — list comments for a task
tasksRoutes.get('/:taskId/comments', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!hasPermission(permissions, 'agent_tasks', 'read')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const taskId = c.req.param('taskId');

    const task = (await db.select({ id: agentTasks.id }).from(agentTasks).where(and(
        eq(agentTasks.id, taskId),
        eq(agentTasks.tenantId, tenantId),
    )).limit(1))[0];

    if (!task) {
        return c.json({ error: 'Task not found' }, 404);
    }

    const comments = await db
        .select({
            id: taskComments.id,
            taskId: taskComments.taskId,
            authorId: taskComments.authorId,
            authorType: taskComments.authorType,
            authorName: sql<string>`COALESCE(${users.name}, ${agents.name}, 'Unknown')`,
            content: taskComments.content,
            parentId: taskComments.parentId,
            createdAt: taskComments.createdAt,
            updatedAt: taskComments.updatedAt,
        })
        .from(taskComments)
        .leftJoin(users, and(
            eq(taskComments.authorId, users.id),
            eq(taskComments.authorType, 'member'),
        ))
        .leftJoin(agents, and(
            sql`${taskComments.authorId} = ${agents.id}`,
            eq(taskComments.authorType, 'agent'),
        ))
        .where(and(
            eq(taskComments.taskId, taskId),
            eq(taskComments.tenantId, tenantId),
        ))
        .orderBy(asc(taskComments.createdAt));

    return c.json({ data: comments });
});

// POST /tasks/:taskId/comments — post a comment as the current user
tasksRoutes.post('/:taskId/comments', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];
    const userId = c.get('userId') as string;

    if (!hasPermission(permissions, 'agent_tasks', 'update')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const taskId = c.req.param('taskId');

    const schema = z.object({
        content: z.string().min(1),
        parentId: z.string().uuid().optional(),
    });

    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
        return c.json({ error: result.error.errors[0].message }, 400);
    }

    const task = (await db.select().from(agentTasks).where(and(
        eq(agentTasks.id, taskId),
        eq(agentTasks.tenantId, tenantId),
    )).limit(1))[0];

    if (!task) {
        return c.json({ error: 'Task not found' }, 404);
    }

    const [comment] = await db.insert(taskComments).values({
        taskId,
        tenantId,
        authorId: userId,
        authorType: 'member',
        content: result.data.content,
        parentId: result.data.parentId ?? null,
    }).returning();

    await db.insert(taskEvents).values({
        taskId,
        tenantId,
        actorType: 'human',
        actorId: userId,
        eventType: 'comment_added',
        payload: { commentId: comment.id },
    });

    try {
        await pushWebSocketEvent(tenantId, {
            type: 'task.comment.added',
            taskId,
            comment,
        });
    } catch (wsErr) {
        console.error('WS push failed (non-fatal):', wsErr);
    }

    return c.json({ data: comment }, 201);
});

// POST /tasks/bulk — bulk create tasks
tasksRoutes.post('/bulk', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];
    const userId = c.get('userId') as string;

    if (!hasPermission(permissions, 'agent_tasks', 'create')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const schema = z.object({
        tasks: z.array(z.object({
            title:       z.string().min(1).max(200),
            description: z.string().optional(),
            milestoneId: z.string().uuid().optional(),
            planId:      z.string().uuid().optional(),
            priority:    z.enum(['low', 'medium', 'high', 'urgent']).optional(),
            assigneeId:  z.string().uuid().optional(),
        })).min(1).max(50),
    });

    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
        return c.json({ error: result.error.errors[0].message }, 400);
    }

    const rows = result.data.tasks.map(t => ({
        tenantId,
        createdBy:   userId,
        title:       t.title,
        description: t.description ?? null,
        milestoneId: t.milestoneId ?? null,
        planId:      t.planId ?? null,
        priority:    (t.priority ?? 'medium') as 'low' | 'medium' | 'high' | 'urgent',
        assigneeId:  t.assigneeId ?? null,
        status:      'backlog' as const,
        acceptanceCriteria: [],
        links:       [] as string[],
        attachmentFileIds: [] as string[],
    }));

    const created = await db.insert(agentTasks).values(rows).returning();

    return c.json({ data: created }, 201);
});

// PATCH /tasks/bulk — bulk update tasks
tasksRoutes.patch('/bulk', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!hasPermission(permissions, 'agent_tasks', 'update')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const schema = z.object({
        task_ids:   z.array(z.string().uuid()).min(1).max(100),
        properties: z.object({
            status:     z.enum(['backlog', 'todo', 'in_progress', 'review', 'blocked', 'done', 'cancelled']).optional(),
            priority:   z.enum(['low', 'medium', 'high', 'urgent']).optional(),
            assigneeId: z.string().uuid().nullable().optional(),
            milestoneId: z.string().uuid().nullable().optional(),
            planId:      z.string().uuid().nullable().optional(),
        }).refine(obj => Object.keys(obj).length > 0, { message: 'At least one property required' }),
    });

    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
        return c.json({ error: result.error.errors[0].message }, 400);
    }

    const { task_ids, properties } = result.data;

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (properties.status     !== undefined) updates.status     = properties.status;
    if (properties.priority   !== undefined) updates.priority   = properties.priority;
    if (properties.assigneeId !== undefined) updates.assigneeId = properties.assigneeId;
    if (properties.milestoneId !== undefined) updates.milestoneId = properties.milestoneId;
    if (properties.planId     !== undefined) updates.planId     = properties.planId;

    const updated = await db
        .update(agentTasks)
        .set(updates)
        .where(and(
            inArray(agentTasks.id, task_ids),
            eq(agentTasks.tenantId, tenantId),
        ))
        .returning({ id: agentTasks.id });

    return c.json({ data: { updated: updated.length } });
});

// POST /tasks/:taskId/vote — upvote or downvote a task
tasksRoutes.post('/:taskId/vote', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];
    const userId = c.get('userId') as string;

    if (!hasPermission(permissions, 'agent_tasks', 'update')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const taskId = c.req.param('taskId');
    const schema = z.object({
        type: z.enum(['up', 'down']),
    });

    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
        return c.json({ error: 'Invalid vote type' }, 400);
    }

    const column = result.data.type === 'up' ? agentTasks.upvotes : agentTasks.downvotes;

    const [updated] = await db.update(agentTasks)
        .set({ [result.data.type === 'up' ? 'upvotes' : 'downvotes']: sql`${column} + 1` })
        .where(and(eq(agentTasks.id, taskId), eq(agentTasks.tenantId, tenantId)))
        .returning();

    if (!updated) {
        return c.json({ error: 'Task not found' }, 404);
    }

    try {
        await db.insert(auditLog).values({
            tenantId,
            actorId: userId ?? 'system',
            actorType: 'human',
            action: 'task_voted',
            resource: 'agent_task',
            resourceId: taskId,
            metadata: { type: result.data.type },
            traceId: c.get('traceId') ?? '',
        });
    } catch (auditErr) {
        console.error('Audit log write failed:', auditErr);
    }

    return c.json({ data: updated });
});
