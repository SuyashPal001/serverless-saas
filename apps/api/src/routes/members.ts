import { Hono } from 'hono';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db, memberships, users, roles, agents, auditLog } from '@serverless-saas/database';
import type { AppEnv } from '../types';

export const membersRoutes = new Hono<AppEnv>();

// GET /members
// Returns all active members in the tenant with their user and role details
membersRoutes.get('/', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!permissions.includes('members:read')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    try {
        // Plain join — avoids Drizzle relational API (db.query...with) which requires
        // a fully resolved relations map that is broken by circular schema imports
        const members = await db
            .select({
                id: memberships.id,
                status: memberships.status,
                memberType: memberships.memberType,
                joinedAt: memberships.joinedAt,
                userId: memberships.userId,
                userEmail: users.email,
                userName: users.name,
                userAvatarUrl: users.avatarUrl,
                roleId: roles.id,
                roleName: roles.name,
                agentId: memberships.agentId,
                agentName: agents.name,
                agentType: agents.type,
            })
            .from(memberships)
            .leftJoin(users, and(eq(memberships.userId, users.id), isNull(users.deletedAt)))
            .leftJoin(roles, eq(memberships.roleId, roles.id))
            .leftJoin(agents, eq(memberships.agentId, agents.id))
            .where(and(
                eq(memberships.tenantId, tenantId),
                inArray(memberships.status, ['active', 'invited', 'suspended']),
            ));

        return c.json({ members });
    } catch (err: any) {
        console.error('Get members error:', err);
        const code = err.name || 'INTERNAL_ERROR';
        const message = err.message || 'Failed to fetch members';
        return c.json({ error: message, code }, 500);
    }
});

// PATCH /members/:id/role
// Changes a member's role within the tenant
membersRoutes.patch('/:id/role', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const memberId = c.req.param('id');
    const permissions = requestContext?.permissions ?? [];

    if (!permissions.includes('members:update')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const schema = z.object({
        roleId: z.string().uuid(),
    });

    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
        return c.json({ error: result.error.errors[0].message }, 400);
    }

    const { roleId } = result.data;

    // Scope update to both id AND tenantId — prevents cross-tenant updates
    const [updated] = await db
        .update(memberships)
        .set({ roleId })
        .where(and(
            eq(memberships.id, memberId),
            eq(memberships.tenantId, tenantId)
        ))
        .returning();

    if (!updated) {
        return c.json({ error: 'Member not found' }, 404);
    }

    try {
        await db.insert(auditLog).values({
            tenantId,
            actorId: c.get('userId') ?? 'system',
            actorType: 'human',
            action: 'member_role_changed',
            resource: 'membership',
            resourceId: updated.id,
            metadata: { roleId },
            traceId: c.get('traceId') ?? '',
        });
    } catch (auditErr) {
        console.error('Audit log write failed:', auditErr);
    }

    return c.json({ membership: updated });
});

// PATCH /members/:id/status
// Updates membership status — used to reactivate or suspend a member
membersRoutes.patch('/:id/status', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const memberId = c.req.param('id');
    const permissions = requestContext?.permissions ?? [];

    if (!permissions.includes('members:update')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const schema = z.object({
        status: z.enum(['active', 'suspended']),
    });

    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
        return c.json({ error: result.error.errors[0].message }, 400);
    }

    // Scope update to both id AND tenantId — prevents cross-tenant updates
    const [updated] = await db
        .update(memberships)
        .set({ status: result.data.status })
        .where(and(
            eq(memberships.id, memberId),
            eq(memberships.tenantId, tenantId)
        ))
        .returning();

    if (!updated) {
        return c.json({ error: 'Member not found' }, 404);
    }

    try {
        await db.insert(auditLog).values({
            tenantId,
            actorId: c.get('userId') ?? 'system',
            actorType: 'human',
            action: result.data.status === 'suspended' ? 'member_suspended' : 'member_reactivated',
            resource: 'membership',
            resourceId: updated.id,
            metadata: {},
            traceId: c.get('traceId') ?? '',
        });
    } catch (auditErr) {
        console.error('Audit log write failed:', auditErr);
    }

    return c.json({ membership: updated });
});

// DELETE /members/:id
// Soft deletes a member by suspending their membership (ADR-009)
// Row is preserved for audit trail — hard deleted after 30 day retention window
membersRoutes.delete('/:id', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const memberId = c.req.param('id');
    const permissions = requestContext?.permissions ?? [];

    if (!permissions.includes('members:delete')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const userId = c.get('userId');

    // Prevent self-suspension — look up the membership first
    const target = await db.query.memberships.findFirst({
        where: and(
            eq(memberships.id, memberId),
            eq(memberships.tenantId, tenantId)
        ),
    });

    if (!target) {
        return c.json({ error: 'Member not found' }, 404);
    }

    if (target.userId === userId) {
        return c.json({ error: 'Cannot suspend your own membership', code: 'SELF_SUSPEND_FORBIDDEN' }, 403);
    }

    // Soft delete — status: suspended, not a hard DELETE from DB
    const [removed] = await db
        .update(memberships)
        .set({ status: 'suspended' })
        .where(and(
            eq(memberships.id, memberId),
            eq(memberships.tenantId, tenantId)
        ))
        .returning();

    if (!removed) {
        return c.json({ error: 'Member not found' }, 404);
    }

    try {
        await db.insert(auditLog).values({
            tenantId,
            actorId: userId ?? 'system',
            actorType: 'human',
            action: 'member_suspended',
            resource: 'membership',
            resourceId: removed.id,
            metadata: {},
            traceId: c.get('traceId') ?? '',
        });
    } catch (auditErr) {
        console.error('Audit log write failed:', auditErr);
    }

    return c.json({ success: true });
});
