import { Hono } from 'hono';
import { z } from 'zod';
import { db, features, roles, tenants, memberships, subscriptions, auditLog } from '@serverless-saas/database';
import { eq, isNull, and, sql } from 'drizzle-orm';
import type { AppEnv } from '../types';

const tenantCreateSchema = z.object({
    name: z.string().min(3).max(50),
});

const generateSlug = (name: string) => {
    return name.toLowerCase().trim().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, '-');
};

const checkSlugAvailability = async (slug: string) => {
    const tenant = await db.query.tenants.findFirst({
        where: eq(tenants.slug, slug),
    });
    return !tenant;
};

const tenantsRoutes = new Hono<AppEnv>();

tenantsRoutes.post('/', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const userId = requestContext?.userId || c.get('userId');
    const entitlements = requestContext?.entitlements ?? {};

    if (!userId) {
        return c.json({ error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const parsed = tenantCreateSchema.safeParse(body);
    if (!parsed.success) {
        return c.json({ error: parsed.error.errors[0].message }, 400);
    }
    const { name } = parsed.data;

    // 1. Check workspace entitlement
    const feature = await db.query.features.findFirst({
        where: eq(features.key, 'workspaces'),
    });

    if (!feature) {
        return c.json({ error: 'Feature configuration missing', code: 'FEATURE_NOT_FOUND' }, 500);
    }

    const entitlement = entitlements[feature.id];
    
    // Default limit if no entitlement found (e.g. free plan default)
    const isUnlimited = entitlement?.unlimited ?? false;
    const limit = entitlement?.valueLimit ?? 1;

    if (!isUnlimited) {
        // Count workspaces where user is 'owner'
        const result = await db
            .select({ count: sql<number>`cast(count(*) as integer)` })
            .from(memberships)
            .innerJoin(roles, eq(memberships.roleId, roles.id))
            .where(
                and(
                    eq(memberships.userId, userId),
                    eq(roles.name, 'owner')
                )
            );
        
        const ownerCount = result[0]?.count || 0;

        if (ownerCount >= limit) {
            return c.json({ 
                error: 'Workspace limit reached. Upgrade your plan.', 
                code: 'FEATURE_NOT_ENTITLED', 
                feature: 'workspaces' 
            }, 403);
        }
    }

    // 2. Create workspace
    const slug = generateSlug(name);
    const isAvailable = await checkSlugAvailability(slug);
    let finalSlug = slug;
    if (!isAvailable) {
        const suffix = Math.random().toString(36).substring(2, 6);
        finalSlug = `${slug}-${suffix}`;
    }

    // Find system owner role
    const role = await db.query.roles.findFirst({
        where: and(eq(roles.name, 'owner'), isNull(roles.tenantId)),
    });
    if (!role) {
        return c.json({ error: 'System configuration error' }, 500);
    }

    const [tenant] = await db.insert(tenants).values({
        name,
        slug: finalSlug,
        type: 'individual',
        status: 'active',
    }).returning();

    await db.insert(memberships).values({
        userId,
        tenantId: tenant.id,
        roleId: role.id,
        memberType: 'human',
        status: 'active',
        joinedAt: new Date(),
    });

    await db.insert(subscriptions).values({
        tenantId: tenant.id,
        plan: 'free',
        status: 'active',
        billingCycle: 'monthly',
        startedAt: new Date(),
    });

    try {
        await db.insert(auditLog).values({
            tenantId: tenant.id,
            actorId: userId,
            actorType: 'human',
            action: 'tenant_created',
            resource: 'tenant',
            resourceId: tenant.id,
            metadata: { slug: finalSlug },
            traceId: c.get('traceId') ?? '',
        });
    } catch (auditErr) {
        console.error('Audit log write failed:', auditErr);
    }

    return c.json({ tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug } }, 201);
});

export { tenantsRoutes };