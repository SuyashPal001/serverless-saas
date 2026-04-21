import { Hono } from 'hono';
import { and, eq, ilike, desc, count, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@serverless-saas/database';
import { tenants, memberships, users, agents, conversations, tenantFeatureOverrides, features, roles } from '@serverless-saas/database/schema';
import { auditLog } from '@serverless-saas/database/schema/audit';
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

    const data = await db.select().from(tenants)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(tenants.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

    return c.json({ tenants: data, page, pageSize });
});

// GET /ops/tenants/:id — tenant detail with members, agents, conversation count, overrides
opsRoutes.get('/tenants/:id', async (c) => {
    if (!isPlatformAdmin(c)) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const tenantId = c.req.param('id');

    const tenant = (await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1))[0];
    if (!tenant) {
        return c.json({ error: 'Tenant not found' }, 404);
    }

    // Members with user info and role name
    const memberRows = await db
        .select({
            membershipId: memberships.id,
            memberType: memberships.memberType,
            status: memberships.status,
            joinedAt: memberships.joinedAt,
            createdAt: memberships.createdAt,
            userId: users.id,
            userName: users.name,
            userEmail: users.email,
            roleName: roles.name,
        })
        .from(memberships)
        .leftJoin(users, eq(memberships.userId, users.id))
        .leftJoin(roles, eq(memberships.roleId, roles.id))
        .where(eq(memberships.tenantId, tenantId))
        .orderBy(desc(memberships.createdAt));

    // Active agent count
    const [agentCountRow] = await db
        .select({ value: count() })
        .from(agents)
        .where(and(eq(agents.tenantId, tenantId), eq(agents.status, 'active')));

    // Total conversation count
    const [convCountRow] = await db
        .select({ value: count() })
        .from(conversations)
        .where(eq(conversations.tenantId, tenantId));

    // Feature overrides for this tenant
    const overrideRows = await db
        .select({
            id: tenantFeatureOverrides.id,
            featureKey: features.key,
            featureName: features.name,
            enabled: tenantFeatureOverrides.enabled,
            valueLimit: tenantFeatureOverrides.valueLimit,
            unlimited: tenantFeatureOverrides.unlimited,
            reason: tenantFeatureOverrides.reason,
            grantedBy: tenantFeatureOverrides.grantedBy,
            expiresAt: tenantFeatureOverrides.expiresAt,
            revokedAt: tenantFeatureOverrides.revokedAt,
            createdAt: tenantFeatureOverrides.createdAt,
        })
        .from(tenantFeatureOverrides)
        .innerJoin(features, eq(tenantFeatureOverrides.featureId, features.id))
        .where(and(
            eq(tenantFeatureOverrides.tenantId, tenantId),
            isNull(tenantFeatureOverrides.deletedAt),
        ))
        .orderBy(desc(tenantFeatureOverrides.createdAt));

    const overridesWithStatus = overrideRows.map((o: typeof overrideRows[number]) => ({
        ...o,
        status: o.revokedAt ? 'revoked' : o.expiresAt && new Date(o.expiresAt) < new Date() ? 'expired' : 'active',
    }));

    return c.json({
        tenant,
        members: memberRows,
        stats: {
            memberCount: memberRows.length,
            activeAgents: agentCountRow?.value ?? 0,
            totalConversations: convCountRow?.value ?? 0,
        },
        overrides: overridesWithStatus,
    });
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

    const existing = (await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1))[0];

    if (!existing) {
        return c.json({ error: 'Tenant not found' }, 404);
    }

    const [updated] = await db.update(tenants)
        .set({ status: result.data.status, updatedAt: new Date() })
        .where(eq(tenants.id, tenantId))
        .returning();

    try {
        await db.insert(auditLog).values({
            tenantId,
            actorId: c.get('userId') ?? 'system',
            actorType: 'human',
            action: result.data.status === 'suspended' ? 'tenant_suspended' : 'tenant_reactivated',
            resource: 'tenant',
            resourceId: tenantId,
            metadata: {},
            traceId: c.get('traceId') ?? '',
        });
    } catch (auditErr) {
        console.error('Audit log write failed:', auditErr);
    }

    return c.json({ data: updated });
});

// GET /ops/overrides — list all feature overrides across platform
opsRoutes.get('/overrides', async (c) => {
    if (!isPlatformAdmin(c)) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const page = parseInt(c.req.query('page') ?? '1');
    const pageSize = parseInt(c.req.query('pageSize') ?? '20');

    const data = await db.select().from(tenantFeatureOverrides).where(and(
        eq(tenantFeatureOverrides.deletedAt, null as any),
        eq(tenantFeatureOverrides.revokedAt, null as any),
    )).orderBy(desc(tenantFeatureOverrides.createdAt)).limit(pageSize).offset((page - 1) * pageSize);

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

    try {
        await db.insert(auditLog).values({
            tenantId: result.data.tenantId,
            actorId: c.get('userId') ?? 'system',
            actorType: 'human',
            action: 'override_granted',
            resource: 'tenant_feature_override',
            resourceId: override.id,
            metadata: { featureId: result.data.featureId, reason: result.data.reason },
            traceId: c.get('traceId') ?? '',
        });
    } catch (auditErr) {
        console.error('Audit log write failed:', auditErr);
    }

    return c.json({ data: override }, 201);
});

// POST /ops/overrides/:id/revoke — revoke a feature override
opsRoutes.post('/overrides/:id/revoke', async (c) => {
    if (!isPlatformAdmin(c)) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const overrideId = c.req.param('id');
    const userId = c.get('userId') as string;

    const existing = (await db.select().from(tenantFeatureOverrides).where(eq(tenantFeatureOverrides.id, overrideId)).limit(1))[0];

    if (!existing) {
        return c.json({ error: 'Override not found' }, 404);
    }

    const [updated] = await db.update(tenantFeatureOverrides)
        .set({ revokedAt: new Date(), revokedBy: userId })
        .where(eq(tenantFeatureOverrides.id, overrideId))
        .returning();

    try {
        await db.insert(auditLog).values({
            tenantId: existing.tenantId,
            actorId: userId ?? 'system',
            actorType: 'human',
            action: 'override_revoked',
            resource: 'tenant_feature_override',
            resourceId: overrideId,
            metadata: {},
            traceId: c.get('traceId') ?? '',
        });
    } catch (auditErr) {
        console.error('Audit log write failed:', auditErr);
    }

    return c.json({ data: updated });
});