import { Hono } from 'hono';
import { and, eq, desc } from 'drizzle-orm';
import { db } from '@serverless-saas/database';
import { notificationInbox } from '@serverless-saas/database/schema/notifications';
import type { AppEnv } from '../types';

export const notificationsRoutes = new Hono<AppEnv>();

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