import { Hono } from 'hono';
import { eq, isNull, or, and } from 'drizzle-orm';
import { z } from 'zod';
import { db, features, auditLog } from '@serverless-saas/database';
import { roles } from '@serverless-saas/database/schema/authorization';
import { memberships } from '@serverless-saas/database/schema/tenancy';
import { hasPermission } from '@serverless-saas/permissions';
import type { AppEnv } from '../types';

export const rolesRoutes = new Hono<AppEnv>();

// GET /roles — list system roles + tenant custom roles
rolesRoutes.get('/', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!hasPermission(permissions, 'roles', 'read')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const data = await db.select().from(roles).where(or(
        isNull(roles.tenantId),
        eq(roles.tenantId, tenantId)
    ));

    return c.json({ roles: data });
});

// POST /roles — create a custom role (requires custom_roles entitlement)
rolesRoutes.post('/', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];
    const entitlements = requestContext?.entitlements ?? {};

    if (!hasPermission(permissions, 'roles', 'create')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const feature = (await db.select().from(features).where(eq(features.key, 'custom_roles')).limit(1))[0];

    if (!feature) {
        return c.json({ error: 'Feature configuration missing', code: 'FEATURE_NOT_FOUND' }, 500);
    }

    if (!entitlements[feature.id]?.enabled) {
        return c.json({ error: 'Custom roles require a Business plan or above', code: 'FEATURE_NOT_AVAILABLE' }, 403);
    }

    const schema = z.object({
        name: z.string().min(1).max(50),
        description: z.string().max(255).optional(),
    });

    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
        return c.json({ error: result.error.errors[0].message }, 400);
    }

    const [role] = await db.insert(roles).values({
        tenantId,
        name: result.data.name,
        description: result.data.description,
        isDefault: false,
        isAgentRole: false,
    }).returning();

    try {
        await db.insert(auditLog).values({
            tenantId,
            actorId: c.get('userId') ?? 'system',
            actorType: 'human',
            action: 'role_created',
            resource: 'role',
            resourceId: role.id,
            metadata: {},
            traceId: c.get('traceId') ?? '',
        });
    } catch (auditErr) {
        console.error('Audit log write failed:', auditErr);
    }

    return c.json({ data: role }, 201);
});

rolesRoutes.patch('/:id', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!hasPermission(permissions, 'roles', 'update')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT PERMISSIONS' }, 403);
    }
    const roleId = c.req.param('id');

    const [existing] = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
    if (!existing) {
        return c.json({ error: 'Role not found' }, 404);
    }

    if (existing.tenantId !== tenantId) {
        return c.json({ error: 'Cannot modify a system role', code: 'SYSTEM_ROLE_IMMUTABLE' }, 403);
    }

    const schema = z.object({
        name: z.string().min(1).max(50).optional(),
        description: z.string().max(255).optional(),
    });

    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
        return c.json({ error: result.error.errors[0].message }, 400);
    }

    const [updated] = await db.update(roles)
        .set({ ...result.data, updatedAt: new Date() })
        .where(eq(roles.id, roleId))
        .returning();

    try {
        await db.insert(auditLog).values({
            tenantId,
            actorId: c.get('userId') ?? 'system',
            actorType: 'human',
            action: 'role_updated',
            resource: 'role',
            resourceId: updated.id,
            metadata: {},
            traceId: c.get('traceId') ?? '',
        });
    } catch (auditErr) {
        console.error('Audit log write failed:', auditErr);
    }

    return c.json({ data: updated });
});
rolesRoutes.delete('/:id', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!hasPermission(permissions, 'roles', 'delete')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const roleId = c.req.param('id');

    const [existing] = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);

    if (!existing) {
        return c.json({ error: 'Role not found' }, 404);
    }

    if (existing.tenantId !== tenantId) {
        return c.json({ error: 'Cannot delete a system role', code: 'SYSTEM_ROLE_IMMUTABLE' }, 403);
    }

    const activeMemberships = await db.select().from(memberships).where(
        and(
            eq(memberships.roleId, roleId),
            eq(memberships.status, 'active')
        )
    );

    if (activeMemberships.length > 0) {
        return c.json({
            error: 'Cannot delete a role with active members. Reassign members first.',
            code: 'ROLE_HAS_ACTIVE_MEMBERS'
        }, 409);
    }

    await db.delete(roles).where(eq(roles.id, roleId));

    try {
        await db.insert(auditLog).values({
            tenantId,
            actorId: c.get('userId') ?? 'system',
            actorType: 'human',
            action: 'role_deleted',
            resource: 'role',
            resourceId: roleId,
            metadata: {},
            traceId: c.get('traceId') ?? '',
        });
    } catch (auditErr) {
        console.error('Audit log write failed:', auditErr);
    }

    return c.json({ success: true });
});