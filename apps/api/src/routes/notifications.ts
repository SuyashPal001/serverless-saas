import { Hono } from 'hono';
import { and, eq, desc, sql, isNull } from 'drizzle-orm';
import { z } from 'zod';
import {
    db,
    notificationInbox,
    notificationPreferences,
    notificationWorkflows,
    notificationWorkflowSteps,
    notificationTemplates,
} from '@serverless-saas/database';
import type { AppEnv } from '../types';

export const notificationsRoutes = new Hono<AppEnv>();

// ── Inbox routes ──────────────────────────────────────────────────────────────

const inboxQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    unreadOnly: z.enum(['true', 'false']).optional().transform(v => v === 'true'),
});

// GET /notifications/inbox — paginated inbox for current user
notificationsRoutes.get('/inbox', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const userId = c.get('userId') as string;

    const parsed = inboxQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
        return c.json({ error: parsed.error.errors[0].message }, 400);
    }

    const { page, limit, unreadOnly } = parsed.data;
    const offset = (page - 1) * limit;

    const baseConditions = [
        eq(notificationInbox.tenantId, tenantId),
        eq(notificationInbox.userId, userId),
        eq(notificationInbox.archived, false),
    ];

    if (unreadOnly) {
        baseConditions.push(eq(notificationInbox.read, false));
    }

    const where = and(...baseConditions);

    const unreadConditions = [
        eq(notificationInbox.tenantId, tenantId),
        eq(notificationInbox.userId, userId),
        eq(notificationInbox.read, false),
    ];

    const [items, countResult, unreadResult] = await Promise.all([
        db.select({
            id: notificationInbox.id,
            messageType: notificationInbox.messageType,
            title: notificationInbox.title,
            body: notificationInbox.body,
            metadata: notificationInbox.metadata,
            read: notificationInbox.read,
            readAt: notificationInbox.readAt,
            createdAt: notificationInbox.createdAt,
        })
            .from(notificationInbox)
            .where(where)
            .orderBy(desc(notificationInbox.createdAt))
            .limit(limit)
            .offset(offset),
        db.select({ total: sql<number>`count(*)::int` })
            .from(notificationInbox)
            .where(where),
        db.select({ count: sql<number>`count(*)::int` })
            .from(notificationInbox)
            .where(and(...unreadConditions)),
    ]);

    return c.json({
        items,
        total: countResult[0]?.total ?? 0,
        page,
        limit,
        unreadCount: unreadResult[0]?.count ?? 0,
    });
});

// PATCH /notifications/inbox/:id/read — mark single notification as read
notificationsRoutes.patch('/inbox/:id/read', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const userId = c.get('userId') as string;
    const id = c.req.param('id');

    const [updated] = await db
        .update(notificationInbox)
        .set({ read: true, readAt: new Date() })
        .where(and(
            eq(notificationInbox.id, id),
            eq(notificationInbox.userId, userId),
            eq(notificationInbox.tenantId, tenantId),
        ))
        .returning({ id: notificationInbox.id });

    if (!updated) {
        return c.json({ error: 'Notification not found' }, 404);
    }

    return c.json({ success: true });
});

// POST /notifications/inbox/read-all — mark all notifications as read
notificationsRoutes.post('/inbox/read-all', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const userId = c.get('userId') as string;

    const updated = await db
        .update(notificationInbox)
        .set({ read: true, readAt: new Date() })
        .where(and(
            eq(notificationInbox.userId, userId),
            eq(notificationInbox.tenantId, tenantId),
            eq(notificationInbox.read, false),
        ))
        .returning({ id: notificationInbox.id });

    return c.json({ success: true, count: updated.length });
});

// PATCH /notifications/inbox/:id/archive — archive a notification
notificationsRoutes.patch('/inbox/:id/archive', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const userId = c.get('userId') as string;
    const id = c.req.param('id');

    const [updated] = await db
        .update(notificationInbox)
        .set({ archived: true, archivedAt: new Date() })
        .where(and(
            eq(notificationInbox.id, id),
            eq(notificationInbox.userId, userId),
            eq(notificationInbox.tenantId, tenantId),
        ))
        .returning({ id: notificationInbox.id });

    if (!updated) {
        return c.json({ error: 'Notification not found' }, 404);
    }

    return c.json({ success: true });
});

// ── Preferences routes ────────────────────────────────────────────────────────

// GET /notifications/preferences — get current user's preferences
notificationsRoutes.get('/preferences', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const userId = c.get('userId') as string;

    const prefs = await db
        .select({
            channel: notificationPreferences.channel,
            messageType: notificationPreferences.messageType,
            enabled: notificationPreferences.enabled,
            readOnly: notificationPreferences.readOnly,
            setBy: notificationPreferences.setBy,
        })
        .from(notificationPreferences)
        .where(and(
            eq(notificationPreferences.userId, userId),
            eq(notificationPreferences.tenantId, tenantId),
        ));

    const global: Array<{ channel: string; enabled: boolean; readOnly: boolean; setBy: string }> = [];
    const byMessageType: Record<string, Array<{ channel: string; enabled: boolean; readOnly: boolean; setBy: string }>> = {};

    for (const pref of prefs) {
        const entry = {
            channel: pref.channel,
            enabled: pref.enabled,
            readOnly: pref.readOnly,
            setBy: pref.setBy,
        };
        if (pref.messageType === null) {
            global.push(entry);
        } else {
            if (!byMessageType[pref.messageType]) {
                byMessageType[pref.messageType] = [];
            }
            byMessageType[pref.messageType].push(entry);
        }
    }

    return c.json({ global, byMessageType });
});

const updatePreferenceSchema = z.object({
    messageType: z.string().nullable(),
    channel: z.enum(['email', 'in_app', 'sms', 'slack']),
    enabled: z.boolean(),
});

// PUT /notifications/preferences — upsert a single preference
notificationsRoutes.put('/preferences', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const userId = c.get('userId') as string;

    const result = updatePreferenceSchema.safeParse(await c.req.json());
    if (!result.success) {
        return c.json({ error: result.error.errors[0].message }, 400);
    }

    const { messageType, channel, enabled } = result.data;

    // Check if preference exists and is readOnly
    const conditions = [
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.tenantId, tenantId),
        eq(notificationPreferences.channel, channel),
        messageType === null
            ? isNull(notificationPreferences.messageType)
            : eq(notificationPreferences.messageType, messageType),
    ];

    const existing = await db
        .select({ readOnly: notificationPreferences.readOnly })
        .from(notificationPreferences)
        .where(and(...conditions))
        .limit(1);

    if (existing[0]?.readOnly) {
        return c.json({
            error: 'PREFERENCE_LOCKED',
            message: 'This preference is locked by your tenant admin',
        }, 403);
    }

    await db
        .insert(notificationPreferences)
        .values({
            userId,
            tenantId,
            messageType: messageType,
            channel,
            enabled,
            setBy: 'user',
        })
        .onConflictDoUpdate({
            target: [
                notificationPreferences.userId,
                notificationPreferences.tenantId,
                notificationPreferences.messageType,
                notificationPreferences.channel,
            ],
            set: { enabled, updatedAt: new Date() },
        });

    return c.json({ success: true });
});

// ── Workflow routes (admin only) ──────────────────────────────────────────────

// GET /notifications/workflows — list workflows for tenant
notificationsRoutes.get('/workflows', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!permissions.includes('notifications:read')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const workflows = await db
        .select({
            id: notificationWorkflows.id,
            messageType: notificationWorkflows.messageType,
            critical: notificationWorkflows.critical,
            status: notificationWorkflows.status,
            createdAt: notificationWorkflows.createdAt,
            stepCount: sql<number>`count(${notificationWorkflowSteps.id})::int`,
        })
        .from(notificationWorkflows)
        .leftJoin(
            notificationWorkflowSteps,
            eq(notificationWorkflowSteps.workflowId, notificationWorkflows.id),
        )
        .where(eq(notificationWorkflows.tenantId, tenantId))
        .groupBy(
            notificationWorkflows.id,
            notificationWorkflows.messageType,
            notificationWorkflows.critical,
            notificationWorkflows.status,
            notificationWorkflows.createdAt,
        )
        .orderBy(desc(notificationWorkflows.createdAt));

    return c.json({ items: workflows });
});

// GET /notifications/workflows/:id — get single workflow with steps
notificationsRoutes.get('/workflows/:id', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!permissions.includes('notifications:read')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const workflowId = c.req.param('id');

    const workflow = await db
        .select({
            id: notificationWorkflows.id,
            messageType: notificationWorkflows.messageType,
            critical: notificationWorkflows.critical,
            status: notificationWorkflows.status,
        })
        .from(notificationWorkflows)
        .where(and(
            eq(notificationWorkflows.id, workflowId),
            eq(notificationWorkflows.tenantId, tenantId),
        ))
        .limit(1);

    if (!workflow[0]) {
        return c.json({ error: 'Workflow not found' }, 404);
    }

    const steps = await db
        .select({
            id: notificationWorkflowSteps.id,
            order: notificationWorkflowSteps.order,
            type: notificationWorkflowSteps.type,
            config: notificationWorkflowSteps.config,
            templateId: notificationWorkflowSteps.templateId,
            templateName: notificationTemplates.name,
        })
        .from(notificationWorkflowSteps)
        .leftJoin(
            notificationTemplates,
            eq(notificationTemplates.id, notificationWorkflowSteps.templateId),
        )
        .where(eq(notificationWorkflowSteps.workflowId, workflowId))
        .orderBy(notificationWorkflowSteps.order);

    return c.json({
        ...workflow[0],
        steps: steps.map((s: typeof steps[number]) => ({
            id: s.id,
            order: s.order,
            type: s.type,
            config: s.config,
            templateId: s.templateId ?? null,
            templateName: s.templateName ?? null,
        })),
    });
});
