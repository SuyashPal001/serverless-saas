import { sendEmail } from '@serverless-saas/notifications';

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
  tenantId?: string;
}

export async function handleEmail(body: Record<string, unknown>): Promise<void> {
  const payload = body.payload as EmailPayload;

  await sendEmail({
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
  });

  console.log('Direct email sent', { to: payload.to, subject: payload.subject, tenantId: payload.tenantId });
}