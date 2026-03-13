import { Hono } from 'hono';
import { and, eq, desc } from 'drizzle-orm';
import { db } from '@serverless-saas/database';
import { auditLog } from '@serverless-saas/database/schema/audit';
import type { AppEnv } from '../types';

export const auditLogRoutes = new Hono<AppEnv>();

// GET /audit-log — list audit entries for tenant, newest first
auditLogRoutes.get('/', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!permissions.includes('audit_log:read')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    try {
        // Query params for pagination
        const page = parseInt(c.req.query('page') || '1', 10);
        const pageSize = Math.min(parseInt(c.req.query('pageSize') || '50', 10), 100);
        const offset = (page - 1) * pageSize;

        // Optional filters via query params
        const actorId = c.req.query('actorId');
        const resource = c.req.query('resource');
        const actorType = c.req.query('actorType');

        const conditions = [eq(auditLog.tenantId, tenantId)];

        if (actorId) conditions.push(eq(auditLog.actorId, actorId));
        if (resource) conditions.push(eq(auditLog.resource, resource));
        if (actorType) conditions.push(eq(auditLog.actorType, actorType as any));

        const logs = await db.query.auditLog.findMany({
            where: and(...conditions),
            orderBy: desc(auditLog.createdAt),
            limit: pageSize,
            offset: offset,
        });

        return c.json({
            logs,
            page,
            pageSize,
            hasMore: logs.length === pageSize,
        });
    } catch (err: any) {
        console.error('Get audit log error:', err);
        const code = err.name || 'INTERNAL_ERROR';
        const message = err.message || 'Failed to fetch audit logs';
        return c.json({ error: message, code }, 500);
    }
});