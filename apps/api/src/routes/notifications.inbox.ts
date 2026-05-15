import { and, eq, desc, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, notificationInbox } from '@serverless-saas/database';
import type { Context } from 'hono';
import type { AppEnv } from '../types';

const inboxQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    unreadOnly: z.enum(['true', 'false']).optional().transform(v => v === 'true'),
});

// GET /notifications/inbox
export async function handleGetInbox(c: Context<AppEnv>) {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const userId = c.get('userId') as string;

    const parsed = inboxQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: parsed.error.errors[0].message }, 400);

    const { page, limit, unreadOnly } = parsed.data;
    const offset = (page - 1) * limit;

    const baseConditions = [eq(notificationInbox.tenantId, tenantId), eq(notificationInbox.userId, userId), eq(notificationInbox.archived, false)];
    if (unreadOnly) baseConditions.push(eq(notificationInbox.read, false));

    const where = and(...baseConditions);
    const unreadWhere = and(eq(notificationInbox.tenantId, tenantId), eq(notificationInbox.userId, userId), eq(notificationInbox.read, false));

    const [items, countResult, unreadResult] = await Promise.all([
        db.select({ id: notificationInbox.id, messageType: notificationInbox.messageType, title: notificationInbox.title, body: notificationInbox.body, metadata: notificationInbox.metadata, read: notificationInbox.read, readAt: notificationInbox.readAt, createdAt: notificationInbox.createdAt })
            .from(notificationInbox).where(where).orderBy(desc(notificationInbox.createdAt)).limit(limit).offset(offset),
        db.select({ total: sql<number>`count(*)::int` }).from(notificationInbox).where(where),
        db.select({ count: sql<number>`count(*)::int` }).from(notificationInbox).where(unreadWhere),
    ]);

    return c.json({ items, total: countResult[0]?.total ?? 0, page, limit, unreadCount: unreadResult[0]?.count ?? 0 });
}

// PATCH /notifications/inbox/:id/read
export async function handleMarkRead(c: Context<AppEnv>) {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const userId = c.get('userId') as string;
    const id = c.req.param('id') as string;

    const [updated] = await db.update(notificationInbox)
        .set({ read: true, readAt: new Date() })
        .where(and(eq(notificationInbox.id, id), eq(notificationInbox.userId, userId), eq(notificationInbox.tenantId, tenantId)))
        .returning({ id: notificationInbox.id });

    if (!updated) return c.json({ error: 'Notification not found' }, 404);
    return c.json({ success: true });
}

// POST /notifications/inbox/read-all
export async function handleMarkAllRead(c: Context<AppEnv>) {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const userId = c.get('userId') as string;

    const updated = await db.update(notificationInbox)
        .set({ read: true, readAt: new Date() })
        .where(and(eq(notificationInbox.userId, userId), eq(notificationInbox.tenantId, tenantId), eq(notificationInbox.read, false)))
        .returning({ id: notificationInbox.id });

    return c.json({ success: true, count: updated.length });
}

// PATCH /notifications/inbox/:id/archive
export async function handleArchive(c: Context<AppEnv>) {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const userId = c.get('userId') as string;
    const id = c.req.param('id') as string;

    const [updated] = await db.update(notificationInbox)
        .set({ archived: true, archivedAt: new Date() })
        .where(and(eq(notificationInbox.id, id), eq(notificationInbox.userId, userId), eq(notificationInbox.tenantId, tenantId)))
        .returning({ id: notificationInbox.id });

    if (!updated) return c.json({ error: 'Notification not found' }, 404);
    return c.json({ success: true });
}
