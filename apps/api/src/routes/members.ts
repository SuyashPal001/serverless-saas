import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { memberships } from '@serverless-saas/database/schema/tenancy';
import { db } from '@serverless-saas/database';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { users } from '@serverless-saas/database/schema/auth';


export const membersRoutes = new Hono<AppEnv>();

membersRoutes.get('/', async (c) => {
    const tenantId = c.get('tenantId');
    const requestContext = c.get('requestContext') as any;
    const permissions = requestContext?.permissions ?? [];

    if (!permissions.includes('members:read')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }
    const members = await db.query.memberships.findMany({
        where: and(
            eq(memberships.tenantId, tenantId),
            eq(memberships.status, 'active')
        ),
        with: {
            user: {
                columns: {
                    id: true,
                    email: true,
                    name: true,
                    avatarUrl: true

                }
            },
            role: {
                columns: {
                    id: true,
                    name: true
                }
            }
        }
    });
    return c.json({ members });
});

membersRoutes.post('/invite', async (c) => {
    const tenantId = c.get('tenantId');
    const schema = z.object({

        email: z.string().email(),
        roleId: z.string().uuid()

    });

    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
        return c.json({ error: result.error.errors[0].message }, 400);
    }
    const { email, roleId } = result.data;

    const existingUser = await db.query.users.findFirst({
        where: eq(users.email, email),
    });
    if (existingUser) {
        const existingMembership = await db.query.memberships.findFirst({
            where: and(
                eq(memberships.userId, existingUser.id),
                eq(memberships.tenantId, tenantId),
            ),
        });
        if (existingMembership) {
            return c.json({
                error: 'User is already a member of this tenant'
            }, 409);

        }
    }

    const userId = c.get('userId');

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
// membersRoutes.patch('/:id/role', async (c) => {

// });



// membersRoutes.delete('/:id', async (c) => {


// });
