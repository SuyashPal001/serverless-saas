import { Hono } from 'hono';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@serverless-saas/database';
import { memberships } from '@serverless-saas/database/schema/tenancy';
import { users } from '@serverless-saas/database/schema/auth';
import { roles } from '@serverless-saas/database/schema/authorization';
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
            })
            .from(memberships)
            .leftJoin(users, eq(memberships.userId, users.id))
            .leftJoin(roles, eq(memberships.roleId, roles.id))
            .where(and(
                eq(memberships.tenantId, tenantId),
                inArray(memberships.status, ['active', 'invited']),
                isNull(users.deletedAt)
            ));

        return c.json({ members });
    } catch (err: any) {
        console.error('Get members error:', err);
        const code = err.name || 'INTERNAL_ERROR';
        const message = err.message || 'Failed to fetch members';
        return c.json({ error: message, code }, 500);
    }
});

// POST /members/invite
// Invites a user to the tenant by email and assigns them a role
// Creates membership with status 'invited' — not active until accepted
membersRoutes.post('/invite', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!permissions.includes('members:create')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const schema = z.object({
        email: z.string().email(),
        roleId: z.string().uuid(),
    });

    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
        return c.json({ error: result.error.errors[0].message }, 400);
    }

    const { email, roleId } = result.data;

    // Check if user exists in the platform already
    const existingUser = await db.query.users.findFirst({
        where: eq(users.email, email),
    });

    // If user exists, make sure they're not already a member of this tenant
    if (existingUser) {
        const existingMembership = await db.query.memberships.findFirst({
            where: and(
                eq(memberships.userId, existingUser.id),
                eq(memberships.tenantId, tenantId),
            ),
        });

        if (existingMembership) {
            return c.json({ error: 'User is already a member of this tenant' }, 409);
        }
    }

    const userId = c.get('userId');

    // Create membership with status 'invited' — invitedBy tracks who sent the invite
    const [membership] = await db.insert(memberships).values({
        userId: existingUser?.id,
        tenantId,
        roleId,
        memberType: 'human',
        status: 'invited',
        invitedBy: userId,
        invitedAt: new Date(),
    }).returning();

    return c.json({ membership }, 201);
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

    return c.json({ success: true });
});
