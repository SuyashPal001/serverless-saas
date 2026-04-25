import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, desc, asc, count, sql } from 'drizzle-orm';
import { db } from '@serverless-saas/database';
import { publishToQueue } from '../lib/sqs';
import { agentTasks, taskSteps, taskEvents, taskComments, agents } from '@serverless-saas/database/schema/agents';
import { users } from '@serverless-saas/database/schema/auth';
import { auditLog } from '@serverless-saas/database/schema/audit';
import { hasPermission } from '@serverless-saas/permissions';
import { pushWebSocketEvent } from '../lib/websocket';
import type { AppEnv } from '../types';
export const tasksRoutes = new Hono<AppEnv>();

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
            (v) => (typeof v === 'string' ? JSON.parse(v) : v),
            z.array(z.string().url()).optional(),
        ),
        attachmentFileIds: z.preprocess(
            (v) => (typeof v === 'string' ? JSON.parse(v) : v),
            z.array(z.string().uuid()).optional(),
        ),
    });

    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
        return c.json({ error: result.error.errors[0].message }, 400);
    }

    const { agentId, assigneeId, title, description, referenceText, acceptanceCriteria, estimatedHours, priority, links, attachmentFileIds } = result.data;

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
        attachmentFileIds: (() => {
            const ids = Array.isArray(attachmentFileIds) ? attachmentFileIds : [];
            return sql`ARRAY[${sql.join(ids.map(id => sql`${id}`), sql`, `)}]::text[]`;
        })(),
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

    if (task.status !== 'awaiting_approval' && task.status !== 'blocked') {
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

        await publishToQueue(process.env.AGENT_TASK_QUEUE_URL!, { type: 'replan_task', taskId });

        const [updatedTask] = await db.update(agentTasks)
            .set({ status: 'planning', updatedAt: new Date() })
            .where(and(eq(agentTasks.id, taskId), eq(agentTasks.tenantId, tenantId)))
            .returning();

        return c.json({ data: { task: { ...updatedTask, sortOrder: updatedTask.sortOrder ?? 0 }, steps: [] } });
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

    await publishToQueue(process.env.AGENT_TASK_QUEUE_URL!, { type: 'execute_task', taskId });

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

    const [updatedTask] = await db.update(agentTasks)
        .set({ status: 'planning', blockedReason: null, updatedAt: new Date() })
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

    await publishToQueue(process.env.AGENT_TASK_QUEUE_URL!, {
        type: 'replan_task',
        taskId,
        extraContext: 'User clarification: ' + answer,
    });

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
        links: z.array(z.string().url()).optional(),
        attachmentFileIds: z.array(z.string().uuid()).optional(),
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
    if (attachmentFileIds !== undefined) {
        // text[] column — use explicit ARRAY constructor so Drizzle doesn't emit "[]" as a plain string
        (updateValues as any).attachmentFileIds = sql`ARRAY[${sql.join(attachmentFileIds.map(id => sql`${id}`), sql`, `)}]::text[]`;
    }
    if (sortOrder !== undefined) updateValues.sortOrder = sortOrder;

    const [updatedTask] = await db.update(agentTasks)
        .set(updateValues)
        .where(and(eq(agentTasks.id, taskId), eq(agentTasks.tenantId, tenantId)))
        .returning();

    // backlog → todo: trigger planning only if an agent is assigned
    if (status === 'todo' && task.status === 'backlog') {
        if (task.agentId) {
            await publishToQueue(process.env.AGENT_TASK_QUEUE_URL!, { type: 'plan_task', taskId });
        }
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

    if (task.agentId) {
        await publishToQueue(process.env.AGENT_TASK_QUEUE_URL!, {
            type: 'plan_task',
            taskId,
            triggerCommentId: comment.id,
        });
    }

    return c.json({ data: comment }, 201);
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
