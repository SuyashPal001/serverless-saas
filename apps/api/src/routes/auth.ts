import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { and, eq, isNull, desc } from 'drizzle-orm';
import { db } from '@serverless-saas/database';
import { users, sessions } from '@serverless-saas/database/schema/auth';
import { tenants, memberships } from '@serverless-saas/database/schema/tenancy';
import { roles } from '@serverless-saas/database/schema/authorization';
import { auditLog } from '@serverless-saas/database/schema/audit';
import { getCacheClient } from '@serverless-saas/cache';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { SignJWT } from 'jose';
import { z } from 'zod';

import { adminInitiateAuth } from '@serverless-saas/auth';


export const authRoutes = new Hono<AppEnv>();
export const authPublicRoutes = new Hono<AppEnv>();

// --- WebSocket Token ---
let wsTokenSecret: Uint8Array | undefined;

async function getWsTokenSecret(): Promise<Uint8Array> {
    if (wsTokenSecret) {
        return wsTokenSecret;
    }

    // NOTE: In a real app, this would come from an environment variable set by Terraform
    const secretName = '/serverless-saas/dev/ws-token-secret';

    const ssm = new SSMClient({});

    try {
        const command = new GetParameterCommand({
            Name: secretName,
            WithDecryption: true,
        });
        const output = await ssm.send(command);

        const secretValue = output.Parameter?.Value;
        if (!secretValue) {
            throw new Error('SSM parameter value for ws-token-secret is empty.');
        }

        wsTokenSecret = new TextEncoder().encode(secretValue);
        return wsTokenSecret;
    } catch (error) {
        console.error('Failed to fetch ws-token-secret from SSM:', error);
        throw new Error('Could not load WebSocket token secret.');
    }
}

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

// GET /auth/check-email?email=xxx
authPublicRoutes.get('/check-email', async (c) => {
    const email = c.req.query('email');

    if (!email) {
        return c.json({ error: 'Email is required' }, 400);
    }

    // Validate email format
    const emailSchema = z.string().email();
    const result = emailSchema.safeParse(email);
    if (!result.success) {
        return c.json({ error: 'Invalid email format' }, 400);
    }

    const validatedEmail = result.data;

    const cacheClient = await getCacheClient();
    const rateLimitKey = `ratelimit:check-email:${validatedEmail.toLowerCase()}`;
    const count = await cacheClient.incr(rateLimitKey);

    // Set expiry on first request
    if (count === 1) {
        await cacheClient.expire(rateLimitKey, 60);
    }

    if (count > 5) {
        return c.json({ 
            error: 'Too many requests. Please try again later.', 
            code: 'RATE_LIMIT_EXCEEDED',
            retryAfter: 60 
        }, 429);
    }

    // Check if user exists: SELECT id FROM users WHERE email = ? AND deleted_at IS NULL LIMIT 1
    const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(
            and(
                eq(users.email, result.data),
                isNull(users.deletedAt)
            )
        )
        .limit(1);

    return c.json({ exists: !!user });
});

authRoutes.get('/me', (c) => {
    const requestContext = c.get('requestContext') as any;
    const userId = c.get('userId');

    // permissionsMiddleware stores {resource, action} objects — normalise to
    // "resource:action" strings so the frontend can() helper can use includes()
    const rawPermissions: any[] = requestContext?.permissions ?? [];
    const permissionStrings: string[] = rawPermissions.map((p: any) =>
        typeof p === 'string' ? p : `${p.resource}:${p.action}`
    );

    return c.json({
        userId,
        tenantId: requestContext?.tenant?.id,
        slug: requestContext?.tenant?.slug,
        status: requestContext?.tenant?.status,
        permissions: permissionStrings,
        needsOnboarding: requestContext?.needsOnboarding ?? false,
    });
});

// GET /auth/tenants
authRoutes.get('/tenants', async (c) => {
    const userId = c.get('userId');
    const currentTenantId = c.get('tenantId');

    if (!userId) {
        return c.json({ error: 'Unauthorized' }, 401);
    }

    const userMemberships = await db
        .select({
            tenantId: tenants.id,
            name: tenants.name,
            slug: tenants.slug,
            role: roles.name,
            joinedAt: memberships.joinedAt,
        })
        .from(memberships)
        .innerJoin(tenants, eq(memberships.tenantId, tenants.id))
        .innerJoin(roles, eq(memberships.roleId, roles.id))
        .where(
            and(
                eq(memberships.userId, userId as string),
                eq(memberships.status, 'active')
            )
        )
        .orderBy(desc(memberships.joinedAt));

    const result = userMemberships.map((m: { 
        tenantId: string; 
        name: string; 
        slug: string; 
        role: string; 
        joinedAt: Date | null; 
    }) => ({
        tenantId: m.tenantId,
        name: m.name,
        slug: m.slug,
        role: m.role,
        joinedAt: m.joinedAt,
        isCurrent: m.tenantId === currentTenantId,
    }));

    return c.json({ tenants: result });
});

authRoutes.get('/ws-token', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const userId = c.get('userId');
    const tenantId = requestContext?.tenant?.id;

    if (!userId || !tenantId) {
        return c.json({ error: 'User or tenant not found', code: 'UNAUTHORIZED' }, 401);
    }

    try {
        const secret = await getWsTokenSecret();
        const token = await new SignJWT({ userId, tenantId, type: 'ws' })
            .setProtectedHeader({ alg: 'HS256' })
            .setIssuedAt()
            .setExpirationTime('5m')
            .sign(secret);

        return c.json({ token });
    } catch (error) {
        console.error('Failed to generate ws-token:', error);
        return c.json({ error: 'Failed to generate token', code: 'INTERNAL_ERROR' }, 500);
    }
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

    const membership = (await db.select().from(memberships).where(and(
        eq(memberships.userId, userId),
        eq(memberships.tenantId, targetTenantId),
        eq(memberships.status, 'active')
    )).limit(1))[0];

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
