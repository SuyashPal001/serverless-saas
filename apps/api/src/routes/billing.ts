import { Hono } from 'hono';
import { and, eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@serverless-saas/database';
import { subscriptions, invoices } from '@serverless-saas/database/schema';
import type { AppEnv } from '../types';


export const billingRoutes = new Hono<AppEnv>();

// GET /billing/plan — get current active subscription
billingRoutes.get('/plan', async (c) => {
    const tenantId = c.get('tenantId');
    const requestContext = c.get('requestContext') as any;
    const permissions = requestContext?.permissions ?? [];

    if (!permissions.includes('billing:read')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const data = await db.query.subscriptions.findFirst({
        where: and(
            eq(subscriptions.tenantId, tenantId),
            eq(subscriptions.status, 'active')
        ),
    });

    return c.json({ data: data ?? null });
});

// POST /billing/upgrade — change plan in DB
// TODO: wire payment provider (Stripe/Paddle) before going live
billingRoutes.post('/upgrade', async (c) => {
    const tenantId = c.get('tenantId');
    const requestContext = c.get('requestContext') as any;
    const permissions = requestContext?.permissions ?? [];

    if (!permissions.includes('billing:update')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const schema = z.object({
        plan: z.enum(['free', 'starter', 'business', 'enterprise']),
        billingCycle: z.enum(['monthly', 'annual']),
    });

    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
        return c.json({ error: result.error.errors[0].message }, 400);
    }

    // End current active subscription
    await db.update(subscriptions)
        .set({ status: 'cancelled', endedAt: new Date() })
        .where(and(
            eq(subscriptions.tenantId, tenantId),
            eq(subscriptions.status, 'active')
        ));

    // Create new subscription record
    const [newSub] = await db.insert(subscriptions).values({
        tenantId,
        plan: result.data.plan,
        billingCycle: result.data.billingCycle,
        status: 'active',
        startedAt: new Date(),
    }).returning();

    return c.json({ data: newSub }, 201);
});

// POST /billing/cancel — cancel active subscription
// TODO: wire payment provider cancellation before going live
billingRoutes.post('/cancel', async (c) => {
    const tenantId = c.get('tenantId');
    const requestContext = c.get('requestContext') as any;
    const permissions = requestContext?.permissions ?? [];

    if (!permissions.includes('billing:update')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const existing = await db.query.subscriptions.findFirst({
        where: and(
            eq(subscriptions.tenantId, tenantId),
            eq(subscriptions.status, 'active')
        ),
    });

    if (!existing) {
        return c.json({ error: 'No active subscription found' }, 404);
    }

    const [cancelled] = await db.update(subscriptions)
        .set({ status: 'cancelled', endedAt: new Date() })
        .where(eq(subscriptions.id, existing.id))
        .returning();

    return c.json({ data: cancelled });
});

// GET /billing/invoices — list invoices for tenant
billingRoutes.get('/invoices', async (c) => {
    const tenantId = c.get('tenantId');
    const requestContext = c.get('requestContext') as any;
    const permissions = requestContext?.permissions ?? [];

    if (!permissions.includes('billing:read')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const data = await db.query.invoices.findMany({
        where: eq(invoices.tenantId, tenantId),
        orderBy: desc(invoices.createdAt),
        limit: 50,
    });

    return c.json({ data });
});