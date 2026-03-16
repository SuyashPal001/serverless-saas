import { eq } from 'drizzle-orm';
import type { DB } from '../db';
import {
  notificationTemplates,
  notificationDeliveryLog,
  notificationInbox,
  users,
} from '@serverless-saas/database';
import { sendEmail } from '@serverless-saas/notifications';
import { renderTemplate } from './template';

interface DeliverEmailParams {
  jobId: string;
  tenantId: string;
  templateId: string;
  recipientId: string;
  data: Record<string, unknown>;
}

interface DeliverInAppParams {
  jobId: string;
  tenantId: string;
  workflowId: string;
  templateId: string;
  recipientId: string;
  messageType: string;
  data: Record<string, unknown>;
}

export async function deliverEmail(db: DB, params: DeliverEmailParams): Promise<string> {
  const { jobId, tenantId, templateId, recipientId, data } = params;

  const templates = await db
    .select()
    .from(notificationTemplates)
    .where(eq(notificationTemplates.id, templateId))
    .limit(1);

  if (templates.length === 0) {
    throw new Error(`Template not found: ${templateId}`);
  }

  const template = templates[0];

  // Look up recipient email from users table
  const recipientRows = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, recipientId))
    .limit(1);

  if (recipientRows.length === 0) {
    throw new Error(`Recipient user not found: ${recipientId}`);
  }

  const recipientEmail = recipientRows[0].email;
  const subject = renderTemplate(template.subject ?? '', data);
  const html = renderTemplate(template.body, data);

  await sendEmail({ to: recipientEmail, subject, html });

  const trackingToken = crypto.randomUUID();

  const rows = await db
    .insert(notificationDeliveryLog)
    .values({
      jobId,
      tenantId,
      channel: 'email',
      provider: 'ses',
      status: 'sent',
      trackingToken,
      sentAt: new Date(),
    })
    .returning({ id: notificationDeliveryLog.id });

  return rows[0].id;
}

export async function deliverInApp(db: DB, params: DeliverInAppParams): Promise<string> {
  const { jobId, tenantId, workflowId, templateId, recipientId, messageType, data } = params;

  const templates = await db
    .select()
    .from(notificationTemplates)
    .where(eq(notificationTemplates.id, templateId))
    .limit(1);

  if (templates.length === 0) {
    throw new Error(`Template not found: ${templateId}`);
  }

  const template = templates[0];
  const title = renderTemplate(template.subject ?? messageType, data);
  const body = renderTemplate(template.body, data);

  await db.insert(notificationInbox).values({
    tenantId,
    userId: recipientId,
    jobId,
    workflowId,
    messageType,
    title,
    body,
    metadata: data,
  });

  const trackingToken = crypto.randomUUID();

  const rows = await db
    .insert(notificationDeliveryLog)
    .values({
      jobId,
      tenantId,
      channel: 'in_app',
      provider: 'platform',
      status: 'delivered',
      trackingToken,
      deliveredAt: new Date(),
    })
    .returning({ id: notificationDeliveryLog.id });

  return rows[0].id;
}
