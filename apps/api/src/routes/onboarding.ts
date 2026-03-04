import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '@serverless-saas/database';
import { eq, isNull, and } from 'drizzle-orm';
import { roles } from '@serverless-saas/database/schema/authorization';
import { tenants, memberships } from '@serverless-saas/database/schema/tenancy';
import { subscriptions } from '@serverless-saas/database/schema/billing';
import type { AppEnv } from '../types';

const onboardingSchema = z.object({
    workspaceName: z.string().min(3).max(20),
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

const onboardingRoutes = new Hono<AppEnv>();

onboardingRoutes.post('/complete', async (c) => {
    // Step 1: Validate request body
    const body = await c.req.json();
    const parsed = onboardingSchema.safeParse(body);
    if (!parsed.success) {
        return c.json({ error: parsed.error.errors[0].message }, 400);
    }
    const { workspaceName } = parsed.data;

    // Step 2: Get userId from context (set by userUpsertMiddleware)
    const userId = c.get('userId');
    if (!userId) {
        return c.json({ error: 'Unauthorized' }, 401);
    }

    // Step 3: Generate unique slug
    const slug = generateSlug(workspaceName);
    const isAvailable = await checkSlugAvailability(slug);
    let finalSlug = slug;
    if (!isAvailable) {
        const suffix = Math.random().toString(36).substring(2, 6);
        finalSlug = `${slug}-${suffix}`;
    }

    // Step 4: Find owner role
    const role = await db.query.roles.findFirst({
        where: and(eq(roles.name, 'owner'), isNull(roles.tenantId)),
    });
    if (!role) {
        return c.json({ error: 'System configuration error' }, 500);
    }

    // Step 5: DB transaction
    const { tenantId } = await db.transaction(async (tx) => {
        const [tenant] = await tx.insert(tenants).values({
            name: workspaceName,
            slug: finalSlug,
            type: 'startup',
            status: 'active',
        }).returning();

        await tx.insert(memberships).values({
            userId,
            tenantId: tenant.id,
            roleId: role.id,
            memberType: 'human',
            status: 'active',
        });

        await tx.insert(subscriptions).values({
            tenantId: tenant.id,
            plan: 'free',
            status: 'active',
            billingCycle: 'monthly',
            startedAt: new Date(),
        });

        return { tenantId: tenant.id };
    });

    // Step 6: Return response
    return c.json({ tenantId, slug: finalSlug, message: 'Workspace created successfully' }, 201);
});

export { onboardingRoutes };