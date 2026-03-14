import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { and, eq } from 'drizzle-orm';
import { db, memberships, sessions, auditLog } from '@serverless-saas/database';
import { getCacheClient } from '@serverless-saas/cache';

import { adminInitiateAuth } from '@serverless-saas/auth';


export const authRoutes = new Hono<AppEnv>();
export const authPublicRoutes = new Hono<AppEnv>();

// POST /auth/login
authPublicRoutes.post('/login', async (c) => {
    const body = await c.req.json();
    const { email, password } = body;

    if (!email || !password) {
        return c.json({ error: 'Email and password are required' }, 400);
    }

    try {
        const result = await adminInitiateAuth(email, password);

        if (result.ChallengeName) {
            return c.json({
                challenge: result.ChallengeName,
                session: result.Session,
                parameters: result.ChallengeParameters,
            });
        }

        return c.json({
            token: result.AuthenticationResult?.IdToken,
            accessToken: result.AuthenticationResult?.AccessToken,
            refreshToken: result.AuthenticationResult?.RefreshToken,
            expiresIn: result.AuthenticationResult?.ExpiresIn,
        });
    } catch (err: any) {
        console.error('Login error:', err);
        const code = err.name || 'INTERNAL_ERROR';
        const message = err.message || 'Authentication failed';
        return c.json({ error: message, code }, 401);
    }
});

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

    const [invalidatedSession] = await db.update(sessions)
        .set({ status: 'invalidated', invalidatedAt: new Date(), invalidatedReason: 'logout' })
        .where(eq(sessions.jwtId, jti))
        .returning({ id: sessions.id });

    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    if (tenantId) {
        try {
            await db.insert(auditLog).values({
                tenantId,
                actorId: c.get('userId') ?? 'system',
                actorType: 'human',
                action: 'user_logged_out',
                resource: 'session',
                resourceId: invalidatedSession?.id ?? null,
                metadata: {},
                traceId: c.get('traceId') ?? '',
            });
        } catch (auditErr) {
            console.error('Audit log write failed:', auditErr);
        }
    }

    return c.json({ success: true });
});

// POST /auth/switch-tenant
authRoutes.post('/switch-tenant', async (c) => {
    const jwtPayload = c.get('jwtPayload') as any;
    const userId = c.get('userId') as string;
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


