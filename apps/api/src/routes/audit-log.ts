import { Hono } from 'hono';
import { and, eq, ilike, gte, lte, desc, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, auditLog } from '@serverless-saas/database';
import type { AppEnv } from '../types';

export const auditLogRoutes = new Hono<AppEnv>();

const querySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    actorType: z.enum(['human', 'agent', 'system']).optional(),
    action: z.string().optional(),
    dateFrom: z.string().datetime().optional(),
    dateTo: z.string().datetime().optional(),
});

// GET /audit-log — paginated, filtered audit entries for tenant
auditLogRoutes.get('/', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!permissions.includes('audit_log:read')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const parsed = querySchema.safeParse(c.req.query());
    if (!parsed.success) {
        return c.json({ error: parsed.error.errors[0].message }, 400);
    }

    const { page, pageSize, actorType, action, dateFrom, dateTo } = parsed.data;
    const offset = (page - 1) * pageSize;

    const conditions = [eq(auditLog.tenantId, tenantId)];
    if (actorType) conditions.push(eq(auditLog.actorType, actorType));
    if (action)    conditions.push(ilike(auditLog.action, `%${action}%`));
    if (dateFrom)  conditions.push(gte(auditLog.createdAt, new Date(dateFrom)));
    if (dateTo)    conditions.push(lte(auditLog.createdAt, new Date(dateTo)));

    const where = and(...conditions);

    const [entries, countResult] = await Promise.all([
        db.select().from(auditLog)
            .where(where)
            .orderBy(desc(auditLog.createdAt))
            .limit(pageSize)
            .offset(offset),
        db.select({ total: sql<number>`count(*)::int` }).from(auditLog).where(where),
    ]);

    const total = countResult[0]?.total ?? 0;

    return c.json({ data: { entries, total, page, pageSize } });
});
