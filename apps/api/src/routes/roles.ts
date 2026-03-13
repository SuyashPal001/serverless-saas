import { Hono } from 'hono';
import { eq, isNull, or, and } from 'drizzle-orm';
import { z } from 'zod';
import { db, memberships } from '@serverless-saas/database';
import { roles } from '@serverless-saas/database/schema/authorization';
import { features } from '@serverless-saas/database/schema/entitlements';
import type { AppEnv } from '../types';

export const rolesRoutes = new Hono<AppEnv>();

// GET /roles — list system roles + tenant custom roles
rolesRoutes.get('/', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!permissions.includes('roles:read')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const data = await db.query.roles.findMany({
        where: or(
            isNull(roles.tenantId),
            eq(roles.tenantId, tenantId)
        ),
    });

    return c.json({ roles: data });
});

// POST /roles — create a custom role (requires custom_roles entitlement)
rolesRoutes.post('/', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];
    const entitlements = requestContext?.entitlements ?? {};

    if (!permissions.includes('roles:create')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const feature = await db.query.features.findFirst({
        where: eq(features.key, 'custom_roles'),
    });

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

    return c.json({ data: role }, 201);
});

rolesRoutes.patch('/:id', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!permissions.includes('roles:update')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT PERMISSIONS' }, 403);
    }
    const roleId = c.req.param('id');

    const existing = await db.query.roles.findFirst({
        where: eq(roles.id, roleId)
    });
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

    return c.json({ data: updated });
});
rolesRoutes.delete('/:id', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!permissions.includes('roles:delete')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const roleId = c.req.param('id');

    const existing = await db.query.roles.findFirst({
        where: eq(roles.id, roleId),
    });

    if (!existing) {
        return c.json({ error: 'Role not found' }, 404);
    }

    if (existing.tenantId !== tenantId) {
        return c.json({ error: 'Cannot delete a system role', code: 'SYSTEM_ROLE_IMMUTABLE' }, 403);
    }

    const activeMemberships = await db.query.memberships.findMany({
        where: and(
            eq(memberships.roleId, roleId),
            eq(memberships.status, 'active')
        ),
    });

    if (activeMemberships.length > 0) {
        return c.json({
            error: 'Cannot delete a role with active members. Reassign members first.',
            code: 'ROLE_HAS_ACTIVE_MEMBERS'
        }, 409);
    }

    await db.delete(roles).where(eq(roles.id, roleId));

    return c.json({ success: true });
});