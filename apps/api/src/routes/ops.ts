import { Hono } from 'hono';
import { and, eq, ilike, desc } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@serverless-saas/database';
import { tenants } from '@serverless-saas/database/schema';
import { tenantFeatureOverrides } from '@serverless-saas/database/schema';
import type { AppEnv } from '../types';

export const opsRoutes = new Hono<AppEnv>();

// Platform admin guard — applied to every handler in this file
const isPlatformAdmin = (c: any): boolean => {
    const jwtPayload = c.get('jwtPayload') as any;
    return jwtPayload?.['custom:role'] === 'platform_admin';
};

// GET /ops/tenants — list all tenants across platform
opsRoutes.get('/tenants', async (c) => {
    if (!isPlatformAdmin(c)) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const page = parseInt(c.req.query('page') ?? '1');
    const pageSize = parseInt(c.req.query('pageSize') ?? '20');
    const search = c.req.query('search');
    const status = c.req.query('status');

    const conditions = [];
    if (search) conditions.push(ilike(tenants.name, `%${search}%`));
    if (status) conditions.push(eq(tenants.status, status as any));

    const data = await db.query.tenants.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        orderBy: desc(tenants.createdAt),
        limit: pageSize,
        offset: (page - 1) * pageSize,
    });

    return c.json({ tenants: data, page, pageSize });
});

// PATCH /ops/tenants/:id — suspend or reactivate a tenant
opsRoutes.patch('/tenants/:id', async (c) => {
    if (!isPlatformAdmin(c)) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const tenantId = c.req.param('id');

    const schema = z.object({
        status: z.enum(['active', 'suspended']),
    });

    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
        return c.json({ error: result.error.errors[0].message }, 400);
    }

    const existing = await db.query.tenants.findFirst({
        where: eq(tenants.id, tenantId),
    });

    if (!existing) {
        return c.json({ error: 'Tenant not found' }, 404);
    }

    const [updated] = await db.update(tenants)
        .set({ status: result.data.status, updatedAt: new Date() })
        .where(eq(tenants.id, tenantId))
        .returning();

    return c.json({ data: updated });
});

// GET /ops/overrides — list all feature overrides across platform
opsRoutes.get('/overrides', async (c) => {
    if (!isPlatformAdmin(c)) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const page = parseInt(c.req.query('page') ?? '1');
    const pageSize = parseInt(c.req.query('pageSize') ?? '20');

    const data = await db.query.tenantFeatureOverrides.findMany({
        where: and(
            eq(tenantFeatureOverrides.deletedAt, null as any),
            eq(tenantFeatureOverrides.revokedAt, null as any),
        ),
        orderBy: desc(tenantFeatureOverrides.createdAt),
        limit: pageSize,
        offset: (page - 1) * pageSize,
    });

    return c.json({ overrides: data, page, pageSize });
});

// POST /ops/overrides — grant a feature override to a tenant
opsRoutes.post('/overrides', async (c) => {
    if (!isPlatformAdmin(c)) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const grantedBy = c.get('requestContext') as any;
    const userId = grantedBy?.user?.id;

    const schema = z.object({
        tenantId: z.string().uuid(),
        featureId: z.string().uuid(),
        enabled: z.boolean().optional(),
        valueLimit: z.number().int().optional(),
        unlimited: z.boolean().optional(),
        reason: z.string().min(1),
        expiresAt: z.string().datetime().optional(),
    });

    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
        return c.json({ error: result.error.errors[0].message }, 400);
    }

    const [override] = await db.insert(tenantFeatureOverrides).values({
        tenantId: result.data.tenantId,
        featureId: result.data.featureId,
        enabled: result.data.enabled,
        valueLimit: result.data.valueLimit,
        unlimited: result.data.unlimited,
        reason: result.data.reason,
        grantedBy: userId,
        expiresAt: result.data.expiresAt ? new Date(result.data.expiresAt) : null,
    }).returning();

    return c.json({ data: override }, 201);
});

// POST /ops/overrides/:id/revoke — revoke a feature override
opsRoutes.post('/overrides/:id/revoke', async (c) => {
    if (!isPlatformAdmin(c)) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const overrideId = c.req.param('id');
    const requestContext = c.get('requestContext') as any;
    const userId = requestContext?.user?.id;

    const existing = await db.query.tenantFeatureOverrides.findFirst({
        where: eq(tenantFeatureOverrides.id, overrideId),
    });

    if (!existing) {
        return c.json({ error: 'Override not found' }, 404);
    }

    const [updated] = await db.update(tenantFeatureOverrides)
        .set({ revokedAt: new Date(), revokedBy: userId })
        .where(eq(tenantFeatureOverrides.id, overrideId))
        .returning();

    return c.json({ data: updated });
});