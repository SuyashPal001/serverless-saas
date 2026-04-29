import { eq, and, isNull } from 'drizzle-orm';
import type { DB } from '../db';
import { notificationPreferences } from '@serverless-saas/database';

export async function checkPreference(
  db: DB,
  userId: string,
  tenantId: string,
  messageType: string,
  channel: string,
): Promise<{ enabled: boolean; readOnly: boolean }> {
  // Specific preference first
  const specific = await db
    .select({ enabled: notificationPreferences.enabled, readOnly: notificationPreferences.readOnly })
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.tenantId, tenantId),
        eq(notificationPreferences.messageType, messageType),
        eq(notificationPreferences.channel, channel as 'email' | 'in_app' | 'sms' | 'slack'),
      ),
    )
    .limit(1);

  if (specific.length > 0) {
    return { enabled: specific[0].enabled, readOnly: specific[0].readOnly };
  }

  // Global preference (messageType IS NULL)
  const global = await db
    .select({ enabled: notificationPreferences.enabled, readOnly: notificationPreferences.readOnly })
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.tenantId, tenantId),
        isNull(notificationPreferences.messageType),
        eq(notificationPreferences.channel, channel as 'email' | 'in_app' | 'sms' | 'slack'),
      ),
    )
    .limit(1);

  if (global.length > 0) {
    return { enabled: global[0].enabled, readOnly: global[0].readOnly };
  }

  return { enabled: true, readOnly: false };
}
