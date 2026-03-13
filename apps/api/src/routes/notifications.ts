import { Hono } from 'hono';
import { and, eq, desc } from 'drizzle-orm';
import { db } from '@serverless-saas/database';
import { notificationInbox } from '@serverless-saas/database/schema';
import type { AppEnv } from '../types';

export const notificationsRoutes = new Hono<AppEnv>();

// GET /notifications/inbox — returns paginated notification_inbox records for current user
notificationsRoutes.get('/inbox', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const userId = requestContext?.user?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!permissions.includes('notifications:read')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    try {
        // Query params for pagination
        const page = parseInt(c.req.query('page') || '1', 10);
        const pageSize = Math.min(parseInt(c.req.query('pageSize') || '20', 10), 100);
        const offset = (page - 1) * pageSize;

        const notifications = await db.query.notificationInbox.findMany({
            where: and(
                eq(notificationInbox.tenantId, tenantId),
                eq(notificationInbox.userId, userId),
                eq(notificationInbox.archived, false)
            ),
            orderBy: desc(notificationInbox.createdAt),
            limit: pageSize,
            offset: offset,
        });

        return c.json({
            notifications,
            page,
            pageSize,
            hasMore: notifications.length === pageSize,
        });
    } catch (err: any) {
        console.error('Get notification inbox error:', err);
        const code = err.name || 'INTERNAL_ERROR';
        const message = err.message || 'Failed to fetch notifications';
        return c.json({ error: message, code }, 500);
    }
});

// GET /notifications — list inbox items for current user
notificationsRoutes.get('/', async (c) => {
    const tenantId = c.get('tenantId');
    const requestContext = c.get('requestContext') as any;
    const userId = requestContext?.user?.id;

    // Optional filter — unread only
    const unreadOnly = c.req.query('unread') === 'true';

    const conditions = [
        eq(notificationInbox.tenantId, tenantId),
        eq(notificationInbox.userId, userId),
        eq(notificationInbox.archived, false),
    ];

    if (unreadOnly) {
        conditions.push(eq(notificationInbox.read, false));
    }

    const data = await db.query.notificationInbox.findMany({
        where: and(...conditions),
        orderBy: desc(notificationInbox.createdAt),
        limit: 50,
    });

    return c.json({ data });
});

// PATCH /notifications/:id — mark as read
notificationsRoutes.patch('/:id', async (c) => {
    const tenantId = c.get('tenantId');
    const requestContext = c.get('requestContext') as any;
    const userId = requestContext?.user?.id;

    const notificationId = c.req.param('id');

    const existing = await db.query.notificationInbox.findFirst({
        where: and(
            eq(notificationInbox.id, notificationId),
            eq(notificationInbox.tenantId, tenantId),
            eq(notificationInbox.userId, userId)
        ),
    });

    if (!existing) {
        return c.json({ error: 'Notification not found' }, 404);
    }

    const [updated] = await db.update(notificationInbox)
        .set({ read: true, readAt: new Date() })
        .where(eq(notificationInbox.id, notificationId))
        .returning();

    return c.json({ data: updated });
});