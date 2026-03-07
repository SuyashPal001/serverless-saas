import { Hono } from 'hono';
import { and, eq, desc } from 'drizzle-orm';
import { db } from '@serverless-saas/database';
import { auditLog } from '@serverless-saas/database/schema/audit';
import type { AppEnv } from '../types';

export const auditLogRoutes = new Hono<AppEnv>();

// GET /audit-log — list audit entries for tenant, newest first
auditLogRoutes.get('/', async (c) => {
    const tenantId = c.get('tenantId');
    const requestContext = c.get('requestContext') as any;
    const permissions = requestContext?.permissions ?? [];

    if (!permissions.includes('audit_log:read')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    // Optional filters via query params
    const actorId = c.req.query('actorId');
    const resource = c.req.query('resource');
    const actorType = c.req.query('actorType');

    const conditions = [eq(auditLog.tenantId, tenantId)];

    if (actorId) conditions.push(eq(auditLog.actorId, actorId));
    if (resource) conditions.push(eq(auditLog.resource, resource));
    if (actorType) conditions.push(eq(auditLog.actorType, actorType as any));

    const data = await db.query.auditLog.findMany({
        where: and(...conditions),
        orderBy: desc(auditLog.createdAt),
        limit: 100,
    });

    return c.json({ data });
});