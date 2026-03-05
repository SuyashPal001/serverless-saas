import { createMiddleware } from 'hono/factory';
import { createHash } from 'crypto';
import { eq, and } from 'drizzle-orm';
import { db } from '@serverless-saas/database';
import { apiKeys } from '@serverless-saas/database/schema/access';
import { agents } from '@serverless-saas/database/schema/auth';
import { memberships } from '@serverless-saas/database/schema/tenancy';
import { rolePermissions, permissions } from '@serverless-saas/database/schema/authorization';
import type { AppEnv } from '../types';

export const apiKeyAuthMiddleware = createMiddleware<AppEnv>(async (c, next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader) return c.json({ error: 'Missing Authorization header' }, 401);

    const token = authHeader.replace('Bearer ', '').trim();

    // Human flow — JWT validated upstream by Cognito + API Gateway, pass through
    if (token.startsWith('eyJ')) return next();

    // Unknown credential format — fail fast before any DB work
    if (!token.startsWith('ak_')) {
        return c.json({ error: 'Invalid Authorization header format' }, 401);
    }

    // --- Agent flow (ak_ prefix) ---

    // Hash before lookup — raw keys are never stored (ADR security principle)
    const keyHash = createHash('sha256').update(token).digest('hex');

    const apiKey = await db.query.apiKeys.findFirst({
        where: and(
            eq(apiKeys.keyHash, keyHash),
            eq(apiKeys.status, 'active'),
            eq(apiKeys.type, 'agent')
        ),
    });

    if (!apiKey) return c.json({ error: 'Invalid API key' }, 401);

    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
        return c.json({ error: 'API key expired' }, 401);
    }

    if (!apiKey.agentId) {
        return c.json({ error: 'API key is not linked to an agent' }, 401);
    }

    // Confirm agent is still active
    const agent = await db.query.agents.findFirst({
        where: eq(agents.id, apiKey.agentId),
    });

    if (!agent || agent.status !== 'active') {
        return c.json({ error: 'Agent is not active' }, 401);
    }

    // Membership gives us the role — no membership means no access
    // 403 not 401: we know who it is, it just isn't permitted here
    const membership = await db.query.memberships.findFirst({
        where: and(
            eq(memberships.agentId, agent.id),
            eq(memberships.tenantId, apiKey.tenantId),
            eq(memberships.status, 'active')
        ),
    });

    if (!membership) {
        return c.json({ error: 'Agent has no active membership in this tenant' }, 403);
    }

    // Resolve permissions from role → role_permissions → permissions
    const permissionRows = await db
        .select({ resource: permissions.resource, action: permissions.action })
        .from(rolePermissions)
        .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
        .where(eq(rolePermissions.roleId, membership.roleId));

    // Flatten to "resource:action" strings — same format used across the whole platform
    const resolvedPermissions = permissionRows.map(p => `${p.resource}:${p.action}`);

    // Set apiKeyContext — the correct context type for programmatic access
    // Routes read this the same way regardless of whether caller is human or agent
    c.set('apiKeyContext', {
        keyId: apiKey.id,
        tenantId: apiKey.tenantId,
        type: apiKey.type,
        permissions: resolvedPermissions,
    });

    // Non-blocking usage tracking — failure here must never block the request
    db.update(apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiKeys.id, apiKey.id))
        .catch(() => { });

    return next();
});