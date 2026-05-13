import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db, notificationPreferences } from '@serverless-saas/database';
import type { Context } from 'hono';
import type { AppEnv } from '../types';

// GET /notifications/preferences
export async function handleGetPreferences(c: Context<AppEnv>) {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const userId = c.get('userId') as string;

    const prefs = await db
        .select({ channel: notificationPreferences.channel, messageType: notificationPreferences.messageType, enabled: notificationPreferences.enabled, readOnly: notificationPreferences.readOnly, setBy: notificationPreferences.setBy })
        .from(notificationPreferences)
        .where(and(eq(notificationPreferences.userId, userId), eq(notificationPreferences.tenantId, tenantId)));

    const global: Array<{ channel: string; enabled: boolean; readOnly: boolean; setBy: string }> = [];
    const byMessageType: Record<string, Array<{ channel: string; enabled: boolean; readOnly: boolean; setBy: string }>> = {};

    for (const pref of prefs) {
        const entry = { channel: pref.channel, enabled: pref.enabled, readOnly: pref.readOnly, setBy: pref.setBy };
        if (pref.messageType === null) {
            global.push(entry);
        } else {
            if (!byMessageType[pref.messageType]) byMessageType[pref.messageType] = [];
            byMessageType[pref.messageType].push(entry);
        }
    }

    return c.json({ global, byMessageType });
}

// PUT /notifications/preferences
export async function handleUpsertPreference(c: Context<AppEnv>) {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const userId = c.get('userId') as string;

    const result = z.object({ messageType: z.string().nullable(), channel: z.enum(['email', 'in_app', 'sms', 'slack']), enabled: z.boolean() }).safeParse(await c.req.json());
    if (!result.success) return c.json({ error: result.error.errors[0].message }, 400);

    const { messageType, channel, enabled } = result.data;

    const conditions = [
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.tenantId, tenantId),
        eq(notificationPreferences.channel, channel),
        messageType === null ? isNull(notificationPreferences.messageType) : eq(notificationPreferences.messageType, messageType),
    ];

    const existing = await db.select({ readOnly: notificationPreferences.readOnly }).from(notificationPreferences).where(and(...conditions)).limit(1);
    if (existing[0]?.readOnly) return c.json({ error: 'PREFERENCE_LOCKED', message: 'This preference is locked by your tenant admin' }, 403);

    await db.insert(notificationPreferences).values({ userId, tenantId, messageType, channel, enabled, setBy: 'user' })
        .onConflictDoUpdate({
            target: [notificationPreferences.userId, notificationPreferences.tenantId, notificationPreferences.messageType, notificationPreferences.channel],
            set: { enabled, updatedAt: new Date() },
        });

    return c.json({ success: true });
}
