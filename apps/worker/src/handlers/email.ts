import { sendEmail } from '@serverless-saas/notifications';

interface EmailSendEvent {
  type: 'email.send';
  to: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  tenantId?: string;
}

export async function handleEmail(body: Record<string, unknown>): Promise<void> {
  const event = body as unknown as EmailSendEvent;

  await sendEmail({
    to: event.to,
    subject: event.subject,
    html: event.htmlBody,
  });

  console.log('Direct email sent', { to: event.to, subject: event.subject, tenantId: event.tenantId });
}
