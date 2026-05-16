import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db } from '@serverless-saas/database';
import { agentPrds } from '@serverless-saas/database/schema/pm';
import { hasPermission } from '@serverless-saas/permissions';
import type { AppEnv } from '../types';

export const prdsRoutes = new Hono<AppEnv>();

// GET /prds/:id
prdsRoutes.get('/:id', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!hasPermission(permissions, 'project_plans', 'read'))
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);

    const { id } = c.req.param();
    const prd = (await db
        .select()
        .from(agentPrds)
        .where(and(eq(agentPrds.id, id), eq(agentPrds.tenantId, tenantId)))
        .limit(1))[0];

    if (!prd) return c.json({ error: 'PRD not found' }, 404);
    return c.json({ data: prd });
});

// PATCH /prds/:id/approve
prdsRoutes.patch('/:id/approve', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!hasPermission(permissions, 'project_plans', 'update'))
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);

    const { id } = c.req.param();
    const [updated] = await db
        .update(agentPrds)
        .set({ status: 'approved', updatedAt: new Date() })
        .where(and(eq(agentPrds.id, id), eq(agentPrds.tenantId, tenantId)))
        .returning({ id: agentPrds.id, status: agentPrds.status });

    if (!updated) return c.json({ error: 'PRD not found' }, 404);
    return c.json({ data: updated });
});
