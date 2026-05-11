import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, isNull, count, sql, inArray } from 'drizzle-orm';
import { db } from '@serverless-saas/database';
import { projectPlans, projectMilestones, type ProjectMilestone } from '@serverless-saas/database/schema/pm';
import { agentTasks } from '@serverless-saas/database/schema/agents';
import { hasPermission } from '@serverless-saas/permissions';
import { nextSequenceId } from '../lib/sequence';
import type { AppEnv } from '../types';

export const plansRoutes = new Hono<AppEnv>();

export const VALID_PLAN_TRANSITIONS: Record<string, string[]> = {
    draft:     ['active', 'archived'],
    active:    ['completed', 'archived'],
    completed: [],
    archived:  [],
};

// ─── POST / — create plan ────────────────────────────────────────────────────

plansRoutes.post('/', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const userId = c.get('userId') as string;
    const permissions = requestContext?.permissions ?? [];

    if (!hasPermission(permissions, 'project_plans', 'create')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const schema = z.object({
        title:       z.string().min(1).max(200),
        description: z.string().optional(),
        startDate:   z.string().datetime().optional(),
        targetDate:  z.string().datetime().optional(),
    });

    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
        return c.json({ error: result.error.errors[0].message }, 400);
    }

    const { title, description, startDate, targetDate } = result.data;
    const sequenceId = await nextSequenceId(tenantId, 'plan');

    const [plan] = await db.insert(projectPlans).values({
        tenantId,
        sequenceId,
        title,
        description:  description ?? null,
        status:       'draft',
        startDate:    startDate  ? new Date(startDate)  : null,
        targetDate:   targetDate ? new Date(targetDate) : null,
        createdBy:    userId,
    }).returning();

    return c.json({ data: plan }, 201);
});

// ─── GET / — list plans ──────────────────────────────────────────────────────

plansRoutes.get('/', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!hasPermission(permissions, 'project_plans', 'read')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const plans = await db
        .select()
        .from(projectPlans)
        .where(and(
            eq(projectPlans.tenantId, tenantId),
            isNull(projectPlans.deletedAt),
        ))
        .orderBy(projectPlans.sequenceId);

    return c.json({ data: plans });
});

// ─── GET /:planId — get single plan ─────────────────────────────────────────

plansRoutes.get('/:planId', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!hasPermission(permissions, 'project_plans', 'read')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const { planId } = c.req.param();

    const plan = (await db.select().from(projectPlans).where(and(
        eq(projectPlans.id, planId),
        eq(projectPlans.tenantId, tenantId),
        isNull(projectPlans.deletedAt),
    )).limit(1))[0];

    if (!plan) return c.json({ error: 'Plan not found' }, 404);

    return c.json({ data: plan });
});

// ─── GET /:planId/summary — milestone + task counts ──────────────────────────

plansRoutes.get('/:planId/summary', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!hasPermission(permissions, 'project_plans', 'read')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const { planId } = c.req.param();

    // Verify plan exists and belongs to tenant
    const plan = (await db.select({ id: projectPlans.id }).from(projectPlans).where(and(
        eq(projectPlans.id, planId),
        eq(projectPlans.tenantId, tenantId),
        isNull(projectPlans.deletedAt),
    )).limit(1))[0];

    if (!plan) return c.json({ error: 'Plan not found' }, 404);

    // Milestone counts — single query
    const [milestoneCounts] = await db
        .select({
            total:     count(),
            completed: sql<number>`count(*) filter (where ${projectMilestones.status} = 'completed')`,
        })
        .from(projectMilestones)
        .where(and(
            eq(projectMilestones.planId, planId),
            isNull(projectMilestones.deletedAt),
        ));

    // Task counts — single query scoped by planId
    const [taskCounts] = await db
        .select({
            total:     count(),
            completed: sql<number>`count(*) filter (where ${agentTasks.status} = 'done')`,
        })
        .from(agentTasks)
        .where(and(
            eq(agentTasks.planId, planId),
            eq(agentTasks.tenantId, tenantId),
        ));

    return c.json({
        data: {
            totalMilestones:     Number(milestoneCounts.total),
            completedMilestones: Number(milestoneCounts.completed),
            totalTasks:          Number(taskCounts.total),
            completedTasks:      Number(taskCounts.completed),
        },
    });
});

// ─── GET /:planId/milestones — list milestones with task counts ──────────────

plansRoutes.get('/:planId/milestones', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!hasPermission(permissions, 'project_milestones', 'read')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const { planId } = c.req.param();

    const plan = (await db.select({ id: projectPlans.id }).from(projectPlans).where(and(
        eq(projectPlans.id, planId),
        eq(projectPlans.tenantId, tenantId),
        isNull(projectPlans.deletedAt),
    )).limit(1))[0];

    if (!plan) return c.json({ error: 'Plan not found' }, 404);

    const milestones: ProjectMilestone[] = await db
        .select()
        .from(projectMilestones)
        .where(and(
            eq(projectMilestones.planId, planId),
            isNull(projectMilestones.deletedAt),
        ))
        .orderBy(projectMilestones.sequenceId);

    if (milestones.length === 0) return c.json({ data: [] });

    // Single aggregate query for task counts — not N+1
    type CountRow = { milestoneId: string | null; total: number; completed: number };
    const milestoneIds = milestones.map((m) => m.id);
    const taskCounts: CountRow[] = await db
        .select({
            milestoneId: agentTasks.milestoneId,
            total:       count(),
            completed:   sql<number>`count(*) filter (where ${agentTasks.status} = 'done')`,
        })
        .from(agentTasks)
        .where(and(
            inArray(agentTasks.milestoneId, milestoneIds),
            eq(agentTasks.tenantId, tenantId),
        ))
        .groupBy(agentTasks.milestoneId);

    const countMap = new Map<string, CountRow>(
        taskCounts
            .filter((r): r is CountRow & { milestoneId: string } => r.milestoneId !== null)
            .map((r) => [r.milestoneId, r])
    );

    const data = milestones.map((m) => {
        const counts = countMap.get(m.id);
        return {
            ...m,
            totalTasks:     counts ? Number(counts.total)     : 0,
            completedTasks: counts ? Number(counts.completed) : 0,
        };
    });

    return c.json({ data });
});

// ─── POST /:planId/milestones — create milestone ─────────────────────────────

plansRoutes.post('/:planId/milestones', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const userId = c.get('userId') as string;
    const permissions = requestContext?.permissions ?? [];

    if (!hasPermission(permissions, 'project_milestones', 'create')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const { planId } = c.req.param();

    const plan = (await db.select({ id: projectPlans.id }).from(projectPlans).where(and(
        eq(projectPlans.id, planId),
        eq(projectPlans.tenantId, tenantId),
        isNull(projectPlans.deletedAt),
    )).limit(1))[0];

    if (!plan) return c.json({ error: 'Plan not found' }, 404);

    const schema = z.object({
        title:       z.string().min(1).max(200),
        description: z.string().optional(),
        targetDate:  z.string().datetime().optional(),
        assigneeId:  z.string().uuid().optional(),
        priority:    z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    });

    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
        return c.json({ error: result.error.errors[0].message }, 400);
    }

    const { title, description, targetDate, assigneeId, priority } = result.data;
    const sequenceId = await nextSequenceId(tenantId, 'milestone');

    const [milestone] = await db.insert(projectMilestones).values({
        tenantId,
        planId,
        sequenceId,
        title,
        description:  description ?? null,
        status:       'backlog',
        targetDate:   targetDate ? new Date(targetDate) : null,
        assigneeId:   assigneeId ?? null,
        priority:     priority ?? 'medium',
        createdBy:    userId,
    }).returning();

    return c.json({ data: milestone }, 201);
});

// ─── GET /:planId/tasks — all tasks in plan ──────────────────────────────────

plansRoutes.get('/:planId/tasks', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!hasPermission(permissions, 'agent_tasks', 'read')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const { planId } = c.req.param();
    const floating = c.req.query('floating') === 'true';

    const plan = (await db.select({ id: projectPlans.id }).from(projectPlans).where(and(
        eq(projectPlans.id, planId),
        eq(projectPlans.tenantId, tenantId),
        isNull(projectPlans.deletedAt),
    )).limit(1))[0];

    if (!plan) return c.json({ error: 'Plan not found' }, 404);

    const tasks = await db
        .select()
        .from(agentTasks)
        .where(and(
            eq(agentTasks.planId, planId),
            eq(agentTasks.tenantId, tenantId),
            floating ? isNull(agentTasks.milestoneId) : undefined,
        ))
        .orderBy(agentTasks.sortOrder);

    return c.json({ data: tasks });
});

// ─── PATCH /:planId — update plan ────────────────────────────────────────────

plansRoutes.patch('/:planId', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!hasPermission(permissions, 'project_plans', 'update')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const { planId } = c.req.param();

    const schema = z.object({
        title:       z.string().min(1).max(200).optional(),
        description: z.string().nullable().optional(),
        status:      z.enum(['draft', 'active', 'completed', 'archived']).optional(),
        startDate:   z.string().datetime().nullable().optional(),
        targetDate:  z.string().datetime().nullable().optional(),
    });

    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
        return c.json({ error: result.error.errors[0].message }, 400);
    }

    const plan = (await db.select().from(projectPlans).where(and(
        eq(projectPlans.id, planId),
        eq(projectPlans.tenantId, tenantId),
        isNull(projectPlans.deletedAt),
    )).limit(1))[0];

    if (!plan) return c.json({ error: 'Plan not found' }, 404);

    const { title, description, status, startDate, targetDate } = result.data;

    if (status !== undefined && status !== plan.status) {
        const allowed = VALID_PLAN_TRANSITIONS[plan.status] ?? [];
        if (!allowed.includes(status)) {
            return c.json({ error: `Cannot transition plan from ${plan.status} to ${status}` }, 400);
        }
    }

    const updates: Partial<typeof projectPlans.$inferInsert> = { updatedAt: new Date() };
    if (title       !== undefined) updates.title       = title;
    if (description !== undefined) updates.description = description;
    if (status      !== undefined) updates.status      = status;
    if (startDate   !== undefined) updates.startDate   = startDate  ? new Date(startDate)  : null;
    if (targetDate  !== undefined) updates.targetDate  = targetDate ? new Date(targetDate) : null;

    const [updated] = await db
        .update(projectPlans)
        .set(updates)
        .where(and(eq(projectPlans.id, planId), eq(projectPlans.tenantId, tenantId)))
        .returning();

    return c.json({ data: updated });
});

// ─── DELETE /:planId — soft delete ───────────────────────────────────────────

plansRoutes.delete('/:planId', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!hasPermission(permissions, 'project_plans', 'delete')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const { planId } = c.req.param();

    const [updated] = await db
        .update(projectPlans)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(
            eq(projectPlans.id, planId),
            eq(projectPlans.tenantId, tenantId),
            isNull(projectPlans.deletedAt),
        ))
        .returning({ id: projectPlans.id });

    if (!updated) return c.json({ error: 'Plan not found' }, 404);

    return c.json({ success: true });
});
