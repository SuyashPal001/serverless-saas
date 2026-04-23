import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, desc, asc, count, sql } from 'drizzle-orm';
import { db } from '@serverless-saas/database';
import { agentTasks, taskSteps, taskEvents, agents } from '@serverless-saas/database/schema/agents';
import { auditLog } from '@serverless-saas/database/schema/audit';
import { hasPermission } from '@serverless-saas/permissions';
import type { AppEnv } from '../types';
import { randomUUID } from 'crypto';

export const tasksRoutes = new Hono<AppEnv>();

interface PlanStep {
    title: string;
    description: string;
    toolName: string | null;
    reasoning: string;
    estimatedHours: number;
    confidenceScore: number;
}

interface PlanResult {
    steps?: PlanStep[];
    clarificationNeeded?: boolean;
    questions?: string[];
}

async function generateTaskPlan(
    task: { id: string; title: string; description: string | null; acceptanceCriteria: unknown },
    tenantId: string,
    agentId: string,
    extraContext?: string,
): Promise<PlanResult> {
    const relayUrl = process.env.RELAY_URL;
    const serviceKey = process.env.INTERNAL_SERVICE_KEY;

    if (!relayUrl || !serviceKey) {
        throw new Error('RELAY_URL or INTERNAL_SERVICE_KEY not configured');
    }

    const planningPrompt = `You are an AI assistant that has been assigned a task by a user.
Before starting, plan how you will complete it step by step.

Task Title: ${task.title}
Description: ${task.description ?? 'No description provided'}
Acceptance Criteria: ${JSON.stringify(task.acceptanceCriteria)}
${extraContext ? `\nAdditional context: ${extraContext}` : ''}

If the task is unclear and you need more information before planning,
respond with:
{"clarificationNeeded": true, "questions": ["question 1", "question 2"]}

If the task is clear, respond ONLY with a JSON array of steps.
No explanation outside the JSON. Each step must have:
- title: string (short, clear action e.g. "Send confirmation email")
- description: string (what will be done in plain English)
- toolName: string | null (exact tool name you will use, or null)
- reasoning: string (why this step is needed and why this tool)
- estimatedHours: number (realistic estimate)
- confidenceScore: number 0 to 1 (how confident you are this step will succeed)`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60_000);

    let response: Response;
    try {
        response = await fetch(`${relayUrl}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Service-Key': serviceKey,
            },
            body: JSON.stringify({
                conversationId: randomUUID(),
                agentId,
                tenantId,
                message: planningPrompt,
                attachments: [],
            }),
            signal: controller.signal,
        });
    } catch (err: any) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
            throw new Error('Planning timed out after 60 seconds');
        }
        throw err;
    }

    if (!response.body) {
        clearTimeout(timeoutId);
        throw new Error('No response body from relay');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let doneText: string | null = null;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            const blocks = buffer.split('\n\n');
            buffer = blocks.pop() ?? '';

            for (const block of blocks) {
                if (!block.trim()) continue;

                const lines = block.split('\n');
                let eventType = '';
                let dataStr = '';

                for (const line of lines) {
                    if (line.startsWith('event:')) {
                        eventType = line.slice(6).trim();
                    } else if (line.startsWith('data:')) {
                        dataStr = line.slice(5).trim();
                    }
                }

                if (eventType === 'done') {
                    const parsed = JSON.parse(dataStr) as { text: string };
                    doneText = parsed.text;
                    break;
                } else if (eventType === 'error') {
                    const parsed = JSON.parse(dataStr) as { message?: string };
                    throw new Error(parsed.message ?? 'Planning error from relay');
                } else if (eventType === 'auth_expired') {
                    throw new Error('Internal service auth expired — check INTERNAL_SERVICE_KEY')
                }
            }

            if (doneText !== null) break;
        }
    } finally {
        clearTimeout(timeoutId);
        reader.releaseLock();
    }

    if (doneText === null) {
        throw new Error('Planning stream ended without a done event');
    }

    const cleaned = doneText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

    let parsed: unknown;
    try {
        parsed = JSON.parse(cleaned);
    } catch {
        throw new Error(`Planning returned non-JSON: ${doneText.slice(0, 200)}`);
    }

    if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'clarificationNeeded' in parsed &&
        (parsed as Record<string, unknown>).clarificationNeeded === true
    ) {
        return {
            clarificationNeeded: true,
            questions: (parsed as Record<string, unknown>).questions as string[] ?? [],
        };
    }

    if (!Array.isArray(parsed)) {
        throw new Error(`Expected JSON array from planner, got: ${typeof parsed}`);
    }

    return { steps: parsed as PlanStep[] };
}

function buildStepValues(steps: PlanStep[], taskId: string, tenantId: string) {
    return steps.map((s, i) => ({
        taskId,
        tenantId,
        stepNumber: i + 1,
        title: s.title,
        description: s.description ?? null,
        toolName: s.toolName,
        reasoning: s.reasoning ?? null,
        estimatedHours: s.estimatedHours !== undefined ? String(s.estimatedHours) : null,
        confidenceScore: s.confidenceScore !== undefined ? String(s.confidenceScore) : null,
        status: 'pending' as const,
    }));
}

function computePlanMetrics(steps: PlanStep[]) {
    const totalEstimatedHours = steps.reduce((sum, s) => sum + (s.estimatedHours ?? 0), 0);
    const overallConfidence = steps.length > 0
        ? steps.reduce((sum, s) => sum + (s.confidenceScore ?? 0), 0) / steps.length
        : null;
    return { totalEstimatedHours, overallConfidence };
}

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
        agentId: z.string().uuid(),
        title: z.string().min(1).max(200),
        description: z.string().optional(),
        acceptanceCriteria: z.array(z.object({
            text: z.string(),
            checked: z.boolean().default(false),
        })).default([]),
        estimatedHours: z.number().positive().optional(),
        links: z.array(z.string().url()).optional(),
    });

    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
        return c.json({ error: result.error.errors[0].message }, 400);
    }

    const { agentId, title, description, acceptanceCriteria, estimatedHours, links } = result.data;

    const agent = (await db.select().from(agents).where(and(
        eq(agents.id, agentId),
        eq(agents.tenantId, tenantId),
    )).limit(1))[0];

    if (!agent) {
        return c.json({ error: 'Agent not found in tenant' }, 404);
    }

    const [task] = await db.insert(agentTasks).values({
        tenantId,
        agentId,
        createdBy: userId,
        title,
        description,
        acceptanceCriteria,
        estimatedHours: estimatedHours !== undefined ? String(estimatedHours) : undefined,
        links: links ?? [],
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
        const planResult = await generateTaskPlan(task, tenantId, agentId);

        if (planResult.clarificationNeeded) {
            await db.insert(taskEvents).values({
                taskId: task.id,
                tenantId,
                actorType: 'agent',
                actorId: agentId,
                eventType: 'clarification_requested',
                payload: { questions: planResult.questions },
            });

            const [updatedTask] = await db.update(agentTasks)
                .set({ status: 'blocked', blockedReason: 'Clarification needed before planning', updatedAt: new Date() })
                .where(and(eq(agentTasks.id, task.id), eq(agentTasks.tenantId, tenantId)))
                .returning();

            try {
                await db.insert(auditLog).values({
                    tenantId,
                    actorId: userId ?? 'system',
                    actorType: 'human',
                    action: 'task_created',
                    resource: 'agent_task',
                    resourceId: task.id,
                    metadata: { agentId, status: 'blocked', clarificationNeeded: true },
                    traceId: c.get('traceId') ?? '',
                });
            } catch (auditErr) {
                console.error('Audit log write failed:', auditErr);
            }

            return c.json({ data: { task: { ...updatedTask, sortOrder: updatedTask.sortOrder ?? 0 }, steps: [], clarificationQuestions: planResult.questions } }, 201);
        }

        const steps = planResult.steps ?? [];
        const stepValues = buildStepValues(steps, task.id, tenantId);
        const insertedSteps = stepValues.length > 0
            ? await db.insert(taskSteps).values(stepValues).returning()
            : [];

        const { totalEstimatedHours, overallConfidence } = computePlanMetrics(steps);

        const [updatedTask] = await db.update(agentTasks)
            .set({
                ...(overallConfidence !== null ? { confidenceScore: String(overallConfidence) } : {}),
                status: 'backlog',
                updatedAt: new Date(),
            })
            .where(and(eq(agentTasks.id, task.id), eq(agentTasks.tenantId, tenantId)))
            .returning();

        await db.insert(taskEvents).values({
            taskId: task.id,
            tenantId,
            actorType: 'agent',
            actorId: agentId,
            eventType: 'plan_proposed',
            payload: { stepCount: insertedSteps.length, totalEstimatedHours },
        });

        try {
            await db.insert(auditLog).values({
                tenantId,
                actorId: userId ?? 'system',
                actorType: 'human',
                action: 'task_created',
                resource: 'agent_task',
                resourceId: task.id,
                metadata: { agentId, stepCount: insertedSteps.length },
                traceId: c.get('traceId') ?? '',
            });
        } catch (auditErr) {
            console.error('Audit log write failed:', auditErr);
        }

        return c.json({ data: { task: { ...updatedTask, sortOrder: updatedTask.sortOrder ?? 0 }, steps: insertedSteps } }, 201);

    } catch (err: any) {
        await db.insert(taskEvents).values({
            taskId: task.id,
            tenantId,
            actorType: 'system',
            actorId: 'system',
            eventType: 'status_changed',
            payload: { error: err.message, note: 'planning failed' },
        });

        const [updatedTask] = await db.update(agentTasks)
            .set({ status: 'blocked', blockedReason: 'Planning failed: ' + err.message, updatedAt: new Date() })
            .where(and(eq(agentTasks.id, task.id), eq(agentTasks.tenantId, tenantId)))
            .returning();

        try {
            await db.insert(auditLog).values({
                tenantId,
                actorId: userId ?? 'system',
                actorType: 'human',
                action: 'task_created',
                resource: 'agent_task',
                resourceId: task.id,
                metadata: { agentId, planningFailed: true, error: err.message },
                traceId: c.get('traceId') ?? '',
            });
        } catch (auditErr) {
            console.error('Audit log write failed:', auditErr);
        }

        return c.json({
            data: {
                task: updatedTask,
                steps: [],
                warning: 'Task created but planning failed: ' + err.message,
            },
        }, 201);
    }
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

    const taskList = await db.select()
        .from(agentTasks)
        .where(and(
            eq(agentTasks.tenantId, tenantId),
            statusFilter ? eq(agentTasks.status, statusFilter as any) : undefined,
            agentIdFilter ? eq(agentTasks.agentId, agentIdFilter) : undefined,
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

    if (task.status !== 'backlog' && task.status !== 'blocked') {
        return c.json({ error: 'Task plan cannot be reviewed in its current state' }, 400);
    }

    const { approved, stepFeedback } = result.data;

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

        await db.delete(taskSteps).where(and(
            eq(taskSteps.taskId, taskId),
            eq(taskSteps.status, 'pending'),
        ));

        const extraContext = stepFeedback && stepFeedback.length > 0
            ? 'The previous plan was rejected. Feedback: ' + JSON.stringify(stepFeedback)
            : 'The previous plan was rejected.';

        const agentId = task.agentId;
        let newSteps: (typeof taskSteps.$inferSelect)[] = [];

        try {
            const planResult = await generateTaskPlan(task, tenantId, agentId, extraContext);

            if (planResult.clarificationNeeded) {
                await db.insert(taskEvents).values({
                    taskId,
                    tenantId,
                    actorType: 'agent',
                    actorId: agentId,
                    eventType: 'clarification_requested',
                    payload: { questions: planResult.questions },
                });

                const [updatedTask] = await db.update(agentTasks)
                    .set({ status: 'blocked', blockedReason: 'Clarification needed before planning', updatedAt: new Date() })
                    .where(and(eq(agentTasks.id, taskId), eq(agentTasks.tenantId, tenantId)))
                    .returning();

                return c.json({ data: { task: { ...updatedTask, sortOrder: updatedTask.sortOrder ?? 0 }, steps: [], clarificationQuestions: planResult.questions } });
            }

            const steps = planResult.steps ?? [];
            const stepValues = buildStepValues(steps, taskId, tenantId);
            newSteps = stepValues.length > 0
                ? await db.insert(taskSteps).values(stepValues).returning()
                : [];

            const { totalEstimatedHours, overallConfidence } = computePlanMetrics(steps);

            await db.update(agentTasks)
                .set({
                    ...(overallConfidence !== null ? { confidenceScore: String(overallConfidence) } : {}),
                    status: 'backlog',
                    updatedAt: new Date(),
                })
                .where(and(eq(agentTasks.id, taskId), eq(agentTasks.tenantId, tenantId)));

            await db.insert(taskEvents).values({
                taskId,
                tenantId,
                actorType: 'agent',
                actorId: agentId,
                eventType: 'plan_proposed',
                payload: { stepCount: newSteps.length, totalEstimatedHours },
            });
        } catch (err: any) {
            console.error('[tasks] Re-planning failed after rejection:', err);
        }

        const [refreshedTask] = await db.select().from(agentTasks).where(and(
            eq(agentTasks.id, taskId),
            eq(agentTasks.tenantId, tenantId),
        )).limit(1);

        return c.json({ data: { task: refreshedTask, steps: newSteps } });
    }

    // approved === true
    const [updatedTask] = await db.update(agentTasks)
        .set({
            status: 'ready',
            planApprovedAt: new Date(),
            planApprovedBy: userId,
            updatedAt: new Date(),
        })
        .where(and(eq(agentTasks.id, taskId), eq(agentTasks.tenantId, tenantId)))
        .returning();

    await db.insert(taskEvents).values({
        taskId,
        tenantId,
        actorType: 'human',
        actorId: userId,
        eventType: 'plan_approved',
        payload: {},
    });

    return c.json({ data: { task: updatedTask } });
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

    const agentId = task.agentId;
    const planResult = await generateTaskPlan(task, tenantId, agentId, 'User clarification: ' + answer);

    if (planResult.clarificationNeeded) {
        await db.insert(taskEvents).values({
            taskId,
            tenantId,
            actorType: 'agent',
            actorId: agentId,
            eventType: 'clarification_requested',
            payload: { questions: planResult.questions },
        });

        const [updatedTask] = await db.update(agentTasks)
            .set({ blockedReason: 'Further clarification needed', updatedAt: new Date() })
            .where(and(eq(agentTasks.id, taskId), eq(agentTasks.tenantId, tenantId)))
            .returning();

        return c.json({ data: { task: { ...updatedTask, sortOrder: updatedTask.sortOrder ?? 0 }, clarificationQuestions: planResult.questions } });
    }

    await db.delete(taskSteps).where(and(
        eq(taskSteps.taskId, taskId),
        eq(taskSteps.status, 'pending'),
    ));

    const steps = planResult.steps ?? [];
    const stepValues = buildStepValues(steps, taskId, tenantId);
    const insertedSteps = stepValues.length > 0
        ? await db.insert(taskSteps).values(stepValues).returning()
        : [];

    const { totalEstimatedHours } = computePlanMetrics(steps);

    const [updatedTask] = await db.update(agentTasks)
        .set({ status: 'backlog', blockedReason: null, updatedAt: new Date() })
        .where(and(eq(agentTasks.id, taskId), eq(agentTasks.tenantId, tenantId)))
        .returning();

    await db.insert(taskEvents).values({
        taskId,
        tenantId,
        actorType: 'agent',
        actorId: agentId,
        eventType: 'plan_proposed',
        payload: { stepCount: insertedSteps.length, totalEstimatedHours },
    });

    return c.json({ data: { task: { ...updatedTask, sortOrder: updatedTask.sortOrder ?? 0 }, steps: insertedSteps } });
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
        status: z.enum(['backlog', 'ready', 'in_progress', 'review', 'blocked', 'done', 'cancelled']).optional(),
        startedAt: z.string().datetime().nullable().optional(),
        links: z.array(z.string().url()).optional(),
        attachmentFileIds: z.array(z.object({
            fileId: z.string(),
            name: z.string(),
            size: z.number(),
            type: z.string(),
        })).optional(),
        sortOrder: z.number().int().optional(),
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

    const { title, description, estimatedHours, acceptanceCriteria, dueDate, status, startedAt, links, attachmentFileIds, sortOrder } = result.data;

    const updateValues: Partial<typeof agentTasks.$inferInsert> = {
        updatedAt: new Date(),
    };

    if (title !== undefined) updateValues.title = title;
    if (description !== undefined) updateValues.description = description;
    if (estimatedHours !== undefined) updateValues.estimatedHours = estimatedHours !== null ? String(estimatedHours) : null;
    if (acceptanceCriteria !== undefined) updateValues.acceptanceCriteria = acceptanceCriteria;
    if (dueDate !== undefined) updateValues.dueDate = dueDate !== null ? new Date(dueDate) : null;
    if (status !== undefined) updateValues.status = status;
    if (startedAt !== undefined) updateValues.startedAt = startedAt !== null ? new Date(startedAt) : null;
    if (links !== undefined) updateValues.links = links;
    if (attachmentFileIds !== undefined) updateValues.attachmentFileIds = attachmentFileIds;
    if (sortOrder !== undefined) updateValues.sortOrder = sortOrder;

    const [updatedTask] = await db.update(agentTasks)
        .set(updateValues)
        .where(and(eq(agentTasks.id, taskId), eq(agentTasks.tenantId, tenantId)))
        .returning();

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

// POST /tasks/:taskId/comments — add a comment event to the task
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
        comment: z.string().min(1),
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

    const [event] = await db.insert(taskEvents).values({
        taskId,
        tenantId,
        actorType: 'human',
        actorId: userId,
        eventType: 'comment',
        payload: { comment: result.data.comment },
    }).returning();

    return c.json({ data: event }, 201);
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
