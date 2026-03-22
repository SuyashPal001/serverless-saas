import { createMiddleware } from 'hono/factory';
import { and, eq } from 'drizzle-orm';
import { db } from '@serverless-saas/database';
import { memberships } from '@serverless-saas/database/schema/tenancy';
import { rolePermissions, permissions } from '@serverless-saas/database/schema/authorization';
import { getCacheClient } from '@serverless-saas/cache';
import type { AppEnv } from '../types';

// 15 minutes — same TTL as tenant and entitlements cache
// Invalidated via Redis Pub/Sub on role change (ADR-013)
const PERMISSIONS_CACHE_TTL_SECONDS = 900;

export const permissionsMiddleware = createMiddleware<AppEnv>(async (c, next) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const userId = c.get('userId');

    // Skip if no tenantId (onboarding flow) or no userId (agent request)
    // Agents have permissions resolved in apiKeyAuthMiddleware already
    if (!tenantId || !userId) return next();

    // Cache check — avoid DB round trip on every request
    // Key convention: tenant:{tenantId}:user:{userId}:permissions
    const cacheKey = `tenant:${tenantId}:user:${userId}:permissions`;
    const cached = await getCacheClient().get(cacheKey);

    if (cached) {
        requestContext.permissions = typeof cached === 'string' ? JSON.parse(cached) : cached;
        return next();
    }

    // Load membership to get the user's roleId for this tenant
    const [membership] = await db.select().from(memberships).where(
        and(
            eq(memberships.userId, userId),
            eq(memberships.tenantId, tenantId),
            eq(memberships.status, 'active')
        )
    ).limit(1);

    // No membership = pass through with no permissions set
    // Route handlers decide if a permission is required
    if (!membership) return next();

    // Join role_permissions → permissions to get full permission set for this role
    // Result flattened to "resource:action" strings e.g. ["incidents:create", "billing:read"]
    const permissionRows = await db
        .select({ resource: permissions.resource, action: permissions.action })
        .from(rolePermissions)
        .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
        .where(eq(rolePermissions.roleId, membership.roleId));

    const resolvedPermissions = permissionRows.map((p: { resource: string; action: string }) => `${p.resource}:${p.action}`);

    // Cache and attach to context for route handlers to read
    await getCacheClient().set(cacheKey, JSON.stringify(resolvedPermissions), { ex: PERMISSIONS_CACHE_TTL_SECONDS });

    requestContext.permissions = resolvedPermissions;
    return next();
});

