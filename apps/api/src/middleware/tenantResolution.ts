import { createMiddleware } from 'hono/factory';
import { eq } from 'drizzle-orm';
import { db } from '@serverless-saas/database';
import { tenants } from '@serverless-saas/database/schema/tenancy';
import { getCacheClient } from '@serverless-saas/cache';
import type { AppEnv } from '../types';

// Routes accessible before onboarding is complete (ADR-026)
// Everything else gets 403 ONBOARDING_REQUIRED until workspace is created
const ONBOARDING_ALLOWED_PATHS = [
    '/api/v1/onboarding/complete',
    '/api/v1/auth/me',
];

// 15 minutes — balances performance with freshness
// Tenant status changes (suspension, plan upgrade) reflect within this window
// Invalidated early via Redis Pub/Sub on critical changes (ADR-013)
const TENANT_CACHE_TTL_SECONDS = 900;

export const tenantResolutionMiddleware = createMiddleware<AppEnv>(async (c, next) => {
    // tenantId is stamped into the JWT by the pre-token Lambda at login (ADR-008)
    // API Gateway validates the JWT signature upstream — we just read the claims
    const tenantId = c.get('jwtPayload')?.['custom:tenantId'];

    // Empty tenantId = new user who hasn't created a workspace yet
    // Set onboarding flag and only allow specific routes through
    if (!tenantId) {
        c.set('requestContext', { needsOnboarding: true } as any);

        const path = c.req.path;
        if (!ONBOARDING_ALLOWED_PATHS.some(p => path.startsWith(p))) {
            return c.json({ error: 'Onboarding required', code: 'ONBOARDING_REQUIRED' }, 403);
        }

        return next();
    }

    // Cache check — avoid DB round trip on every request
    // Key convention: tenant:{tenantId}:context (from cache key ADR)
    const cacheKey = `tenant:${tenantId}:context`;
    const cached = await getCacheClient().get(cacheKey);

    if (cached) {
        // Cache hit — parse JSON string back to object and attach to context
        c.set('requestContext', JSON.parse(cached as string));
        return next();
    }

    // Cache miss — load from DB
    const tenant = await db.query.tenants.findFirst({
        where: eq(tenants.id, tenantId),
    });

    if (!tenant) {
        return c.json({ error: 'Tenant not found', code: 'TENANT_NOT_FOUND' }, 404);
    }

    // Suspended tenants are blocked before any business logic runs
    // 403 not 404 — tenant exists, it just isn't permitted (ADR-002)
    if (tenant.status === 'suspended') {
        return c.json({ error: 'Tenant is suspended', code: 'TENANT_SUSPENDED' }, 403);
    }

    // Only store what downstream middleware and routes actually need
    // Plan lives on subscriptions table — loaded separately in entitlements middleware
    const tenantContext = {
        id: tenant.id,
        slug: tenant.slug,
        status: tenant.status,
    };


    // Store in Redis for subsequent requests
    // JSON.stringify because Redis only stores strings, not objects
    await getCacheClient().set(cacheKey, JSON.stringify(tenantContext), { ex: TENANT_CACHE_TTL_SECONDS });

    c.set('requestContext', { tenant: tenantContext } as any);
    return next();
});