import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { and, eq, isNull, desc, ne, inArray, count } from 'drizzle-orm';
import { db } from '@serverless-saas/database';
import { users, sessions } from '@serverless-saas/database/schema/auth';
import { tenants, memberships } from '@serverless-saas/database/schema/tenancy';
import { roles } from '@serverless-saas/database/schema/authorization';
import { auditLog } from '@serverless-saas/database/schema/audit';
import { apiKeys } from '@serverless-saas/database/schema/access';
import { agents, agentWorkflows } from '@serverless-saas/database/schema/agents';
import { webhookEndpoints } from '@serverless-saas/database/schema/webhooks';
import { getCacheClient } from '@serverless-saas/cache';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { SignJWT } from 'jose';
import { z } from 'zod';

import { adminInitiateAuth, deleteUser, setUserPassword } from '@serverless-saas/auth';


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

// POST /auth/set-pending-tenant
authRoutes.post('/set-pending-tenant', async (c) => {
    const userId = c.get('userId') as string;
    const body = await c.req.json();
    const tenantId = body?.tenantId;

    if (!tenantId) {
        return c.json({ error: 'tenantId is required' }, 400);
    }

    const [membership] = await db.select({ id: memberships.id })
        .from(memberships)
        .where(and(
            eq(memberships.userId, userId),
            eq(memberships.tenantId, tenantId),
            eq(memberships.status, 'active')
        ))
        .limit(1);

    if (!membership) {
        return c.json({ error: 'No active membership in target tenant' }, 403);
    }

    await db.update(users).set({ pendingTenantId: tenantId }).where(eq(users.id, userId));

    return c.json({ success: true });
});

// DELETE /auth/account
// Permanently deletes the authenticated user's account.
//
// Flow:
//   1. Sole-owner guard — if user is the only owner in a tenant that has OTHER
//      active members, refuse (frontend should prompt "transfer ownership first").
//   2. Auto-delete any tenant where user is the sole member (owner + no one else).
//   3. Suspend all remaining memberships.
//   4. Revoke all API keys created by the user.
//   5. Invalidate all sessions in DB + blacklist current JWT in Redis.
//   6. Purge Redis permission cache keys for this user.
//   7. Soft-delete the user row (preserves FK integrity for audit records).
//   8. Hard-delete from Cognito (blocks future login).
authRoutes.delete('/account', async (c) => {
    const userId = c.get('userId') as string;
    const jwtPayload = c.get('jwtPayload') as any;
    const jti = jwtPayload?.jti;
    const exp = jwtPayload?.exp;

    if (!userId) {
        return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
    }

    try {
        // ── 1. Fetch user row (need email for Cognito delete) ──────────────────
        const [user] = await db
            .select({ id: users.id, email: users.email })
            .from(users)
            .where(and(eq(users.id, userId), isNull(users.deletedAt)))
            .limit(1);

        if (!user) {
            return c.json({ error: 'User not found', code: 'NOT_FOUND' }, 404);
        }

        // ── 2. Fetch all active/invited memberships for this user ──────────────
        const userMemberships = await db
            .select({
                membershipId: memberships.id,
                tenantId: memberships.tenantId,
                roleId: memberships.roleId,
                roleName: roles.name,
            })
            .from(memberships)
            .innerJoin(roles, eq(memberships.roleId, roles.id))
            .where(
                and(
                    eq(memberships.userId, userId),
                    inArray(memberships.status, ['active', 'invited'])
                )
            );

        // ── 3. Sole-owner guard ────────────────────────────────────────────────
        // Block deletion if the user is the only owner in a tenant that still
        // has other active members — those members would be left without an owner.
        const blockerTenantIds: string[] = [];
        const soloTenantIds: string[] = []; // tenants where user is the only member

        for (const m of userMemberships) {
            if (m.roleName !== 'owner') continue;

            // Count other active members in this tenant (excluding the user)
            const [{ totalMembers }] = await db
                .select({ totalMembers: count() })
                .from(memberships)
                .where(
                    and(
                        eq(memberships.tenantId, m.tenantId),
                        inArray(memberships.status, ['active', 'invited']),
                        ne(memberships.userId, userId)
                    )
                );

            if (totalMembers === 0) {
                // User is the only member — safe to auto-delete the tenant
                soloTenantIds.push(m.tenantId);
            } else {
                // Other members exist — check if there's at least one other owner
                const [{ otherOwners }] = await db
                    .select({ otherOwners: count() })
                    .from(memberships)
                    .innerJoin(roles, eq(memberships.roleId, roles.id))
                    .where(
                        and(
                            eq(memberships.tenantId, m.tenantId),
                            eq(roles.name, 'owner'),
                            inArray(memberships.status, ['active']),
                            ne(memberships.userId, userId)
                        )
                    );

                if (otherOwners === 0) {
                    blockerTenantIds.push(m.tenantId);
                }
            }
        }

        if (blockerTenantIds.length > 0) {
            const blockerTenants = await db
                .select({ id: tenants.id, name: tenants.name, slug: tenants.slug })
                .from(tenants)
                .where(inArray(tenants.id, blockerTenantIds));

            return c.json({
                error: 'You are the sole owner of one or more workspaces that have other members. Transfer ownership or remove all members before deleting your account.',
                code: 'SOLE_OWNER_BLOCKER',
                workspaces: blockerTenants.map((t: { id: string; name: string; slug: string }) => ({ id: t.id, name: t.name, slug: t.slug })),
            }, 409);
        }

        // ── 4. Soft-delete tenants where user is the only member ───────────────
        // Also wind down all tenant-scoped resources so nothing is left active
        // under a deleted tenant. A future ops job can hard-delete these rows
        // after a retention window (e.g. 30 days) once audit requirements are met.
        // TODO: add a scheduled ops route (DELETE /ops/purge-deleted-tenants) that
        //       hard-deletes tenants + their resources in FK-safe order after 30 days.
        if (soloTenantIds.length > 0) {
            const now = new Date();

            // Mark the tenant rows as deleted
            await db
                .update(tenants)
                .set({ status: 'deleted', deletedAt: now })
                .where(inArray(tenants.id, soloTenantIds));

            // Retire all agents in these tenants
            await db
                .update(agents)
                .set({ status: 'retired' })
                .where(inArray(agents.tenantId, soloTenantIds));

            // Archive all agent workflows in these tenants
            await db
                .update(agentWorkflows)
                .set({ status: 'archived' })
                .where(inArray(agentWorkflows.tenantId, soloTenantIds));

            // Revoke all API keys scoped to these tenants
            // (distinct from the per-user revoke in step 6 — catches keys
            //  created by other users/agents if any ever existed)
            await db
                .update(apiKeys)
                .set({ status: 'revoked', revokedAt: now })
                .where(
                    and(
                        inArray(apiKeys.tenantId, soloTenantIds),
                        eq(apiKeys.status, 'active')
                    )
                );

            // Soft-delete all webhook endpoints in these tenants
            await db
                .update(webhookEndpoints)
                .set({ status: 'inactive', deletedAt: now })
                .where(
                    and(
                        inArray(webhookEndpoints.tenantId, soloTenantIds),
                        eq(webhookEndpoints.status, 'active')
                    )
                );
        }

        // ── 5. Suspend ALL memberships for this user ───────────────────────────
        if (userMemberships.length > 0) {
            const membershipIds = userMemberships.map((m: { membershipId: string }) => m.membershipId);
            await db
                .update(memberships)
                .set({ status: 'suspended' })
                .where(inArray(memberships.id, membershipIds));
        }

        // ── 6. Revoke all active API keys created by the user ─────────────────
        await db
            .update(apiKeys)
            .set({ status: 'revoked', revokedAt: new Date() })
            .where(
                and(
                    eq(apiKeys.createdBy, userId),
                    eq(apiKeys.status, 'active')
                )
            );

        // ── 7. Invalidate all DB sessions ──────────────────────────────────────
        await db
            .update(sessions)
            .set({
                status: 'invalidated',
                invalidatedAt: new Date(),
                invalidatedReason: 'logout',
            })
            .where(eq(sessions.userId, userId));

        // ── 8. Blacklist current JWT + flush Redis permission caches ───────────
        try {
            const cache = await getCacheClient();

            if (jti) {
                const now = Math.floor(Date.now() / 1000);
                const ttl = exp ? exp - now : 3600;
                await cache.set(
                    `session:blacklist:${jti}`,
                    '1',
                    { ex: ttl > 0 ? ttl : 1 }
                );
            }

            // Flush per-user permission caches for all tenants
            for (const m of userMemberships) {
                await cache.del(`tenant:${m.tenantId}:user:${userId}:perms`);
            }
        } catch (cacheErr) {
            // Cache failures are non-fatal — log and continue
            console.error('Cache cleanup error during account deletion:', cacheErr);
        }

        // ── 9. Soft-delete the user row ────────────────────────────────────────
        await db
            .update(users)
            .set({ deletedAt: new Date() })
            .where(eq(users.id, userId));

        // ── 10. Audit log ──────────────────────────────────────────────────────
        // Write before Cognito delete. Use first tenantId found; skip if there's none.
        const auditTenantId = userMemberships[0]?.tenantId ?? null;
        if (auditTenantId) {
            try {
                await db.insert(auditLog).values({
                    tenantId: auditTenantId,
                    actorId: userId,
                    actorType: 'human',
                    action: 'account_deleted',
                    resource: 'user',
                    resourceId: userId,
                    metadata: {
                        email: user.email,
                        tenantsDeleted: soloTenantIds,
                        tenantsLeft: userMemberships
                            .filter((m: { tenantId: string }) => !soloTenantIds.includes(m.tenantId))
                            .map((m: { tenantId: string }) => m.tenantId),
                    },
                    traceId: c.get('traceId') ?? '',
                });
            } catch (auditErr) {
                console.error('Audit log write failed during account deletion:', auditErr);
            }
        }

        // ── 11. Hard-delete from Cognito (point of no return) ─────────────────
        try {
            await deleteUser(user.email);
        } catch (cognitoErr: any) {
            // UserNotFoundException = Cognito already doesn't know this user
            // (e.g. Google OAuth user removed via console) — treat as success.
            if (cognitoErr?.name !== 'UserNotFoundException') {
                console.error('Cognito delete failed:', cognitoErr);
                // Do not roll back — DB is already cleaned up. Ops can manually
                // purge Cognito if needed. User is effectively locked out anyway
                // because the DB row is soft-deleted.
            }
        }

        return c.json({ success: true });
    } catch (error) {
        console.error('Account deletion failed:', error);
        return c.json({ error: 'Failed to delete account', code: 'INTERNAL_ERROR' }, 500);
    }
});

// POST /auth/change-password
// Verifies the current password then sets a new one via Cognito AdminSetUserPassword.
// Google / SSO users who have no Cognito password will get SOCIAL_ACCOUNT_NO_PASSWORD.
authRoutes.post('/change-password', async (c) => {
    const userId = c.get('userId') as string;
    if (!userId) return c.json({ error: 'Unauthorized' }, 401);

    const body = await c.req.json();
    const { currentPassword, newPassword } = body;

    if (!currentPassword || !newPassword) {
        return c.json({ error: 'currentPassword and newPassword are required' }, 400);
    }

    if (newPassword.length < 8) {
        return c.json({ error: 'New password must be at least 8 characters', code: 'VALIDATION_ERROR' }, 400);
    }

    // Fetch user email (needed for Cognito)
    const [user] = await db
        .select({ email: users.email })
        .from(users)
        .where(and(eq(users.id, userId), isNull(users.deletedAt)))
        .limit(1);

    if (!user) return c.json({ error: 'User not found', code: 'NOT_FOUND' }, 404);

    try {
        // Verify the current password — throws NotAuthorizedException on wrong password
        await adminInitiateAuth(user.email, currentPassword);
    } catch (err: any) {
        const code = err.name || '';
        if (code === 'NotAuthorizedException') {
            return c.json({ error: 'Current password is incorrect', code: 'WRONG_CURRENT_PASSWORD' }, 401);
        }
        if (code === 'UserNotFoundException') {
            // OAuth-only user — no Cognito password set
            return c.json({
                error: 'Password change is not available for accounts that sign in with Google or SSO.',
                code: 'SOCIAL_ACCOUNT_NO_PASSWORD',
            }, 409);
        }
        console.error('Password verification failed:', err);
        return c.json({ error: 'Failed to verify current password', code: 'INTERNAL_ERROR' }, 500);
    }

    try {
        await setUserPassword(user.email, newPassword);
    } catch (err: any) {
        const code = err.name || '';
        if (code === 'InvalidPasswordException') {
            return c.json({ error: err.message || 'New password does not meet requirements', code: 'INVALID_NEW_PASSWORD' }, 400);
        }
        console.error('Password update failed:', err);
        return c.json({ error: 'Failed to update password', code: 'INTERNAL_ERROR' }, 500);
    }

    return c.json({ success: true });
});
