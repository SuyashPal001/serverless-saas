import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { and, eq } from 'drizzle-orm';
import { db } from '@serverless-saas/database';
import { sessions } from '@serverless-saas/database/schema/auth';
import { memberships } from '@serverless-saas/database';
import { getCacheClient } from '@serverless-saas/cache';


export const authRoutes = new Hono<AppEnv>();

authRoutes.get('/me', (c) => {
    const requestContext = c.get('requestContext') as any;
    const userId = c.get('userId');

    return c.json({
        userId,
        tenantId: requestContext?.tenant?.id,
        slug: requestContext?.tenant?.slug,
        status: requestContext?.tenant?.status,
        permissions: requestContext?.permissions ?? [],
        needsOnboarding: requestContext?.needsOnboarding ?? false,
    });
});

// POST /auth/logout
authRoutes.post('/logout', async (c) => {
    const jwtPayload = c.get('jwtPayload') as any;
    const jti = jwtPayload?.jti;
    const exp = jwtPayload?.exp;

    if (!jti) {
        return c.json({ error: 'No active session' }, 400);
    }

    const now = Math.floor(Date.now() / 1000);
    const ttl = exp ? exp - now : 3600;

    await getCacheClient().set(
        `session:blacklist:${jti}`,
        '1',
        { ex: ttl > 0 ? ttl : 1 }
    );

    await db.update(sessions)
        .set({ status: 'invalidated', invalidatedAt: new Date(), invalidatedReason: 'logout' })
        .where(eq(sessions.jwtId, jti));

    return c.json({ success: true });
});

// POST /auth/switch-tenant
authRoutes.post('/switch-tenant', async (c) => {
    const jwtPayload = c.get('jwtPayload') as any;
    const requestContext = c.get('requestContext') as any;
    const userId = requestContext?.user?.id;
    const jti = jwtPayload?.jti;
    const exp = jwtPayload?.exp;

    const body = await c.req.json();
    const targetTenantId = body?.tenantId;

    if (!targetTenantId) {
        return c.json({ error: 'tenantId is required' }, 400);
    }

    const membership = await db.query.memberships.findFirst({
        where: and(
            eq(memberships.userId, userId),
            eq(memberships.tenantId, targetTenantId),
            eq(memberships.status, 'active')
        ),
    });

    if (!membership) {
        return c.json({ error: 'You do not belong to this tenant', code: 'TENANT_ACCESS_DENIED' }, 403);
    }

    if (jti) {
        const now = Math.floor(Date.now() / 1000);
        const ttl = exp ? exp - now : 3600;

        await getCacheClient().set(
            `session:blacklist:${jti}`,
            '1',
            { ex: ttl > 0 ? ttl : 1 }
        );

        await db.update(sessions)
            .set({ status: 'invalidated', invalidatedAt: new Date(), invalidatedReason: null })
            .where(eq(sessions.jwtId, jti));
    }

    return c.json({ success: true, targetTenantId });
});


