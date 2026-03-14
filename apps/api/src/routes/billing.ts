import { Hono } from 'hono';
import { and, eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import { db, subscriptions, invoices, auditLog } from '@serverless-saas/database';
import type { AppEnv } from '../types';


export const billingRoutes = new Hono<AppEnv>();

// GET /billing/subscription — get current active subscription
billingRoutes.get('/subscription', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!permissions.includes('billing:read')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    try {
        const subscription = await db.query.subscriptions.findFirst({
            where: and(
                eq(subscriptions.tenantId, tenantId),
                eq(subscriptions.status, 'active')
            ),
        });

        return c.json({ subscription: subscription ?? null });
    } catch (err: any) {
        console.error('Get subscription error:', err);
        const code = err.name || 'INTERNAL_ERROR';
        const message = err.message || 'Failed to fetch subscription';
        return c.json({ error: message, code }, 500);
    }
});

// GET /billing/plan — get current active subscription
billingRoutes.get('/plan', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
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
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
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

    try {
        await db.insert(auditLog).values({
            tenantId,
            actorId: c.get('userId') ?? 'system',
            actorType: 'human',
            action: 'subscription_updated',
            resource: 'subscription',
            resourceId: newSub.id,
            metadata: { plan: result.data.plan },
            traceId: c.get('traceId') ?? '',
        });
    } catch (auditErr) {
        console.error('Audit log write failed:', auditErr);
    }

    return c.json({ data: newSub }, 201);
});

// POST /billing/cancel — cancel active subscription
// TODO: wire payment provider cancellation before going live
billingRoutes.post('/cancel', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
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

    try {
        await db.insert(auditLog).values({
            tenantId,
            actorId: c.get('userId') ?? 'system',
            actorType: 'human',
            action: 'subscription_updated',
            resource: 'subscription',
            resourceId: cancelled.id,
            metadata: { plan: cancelled.plan },
            traceId: c.get('traceId') ?? '',
        });
    } catch (auditErr) {
        console.error('Audit log write failed:', auditErr);
    }

    return c.json({ data: cancelled });
});

// GET /billing/invoices — list invoices for tenant
billingRoutes.get('/invoices', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
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