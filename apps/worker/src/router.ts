import { handleNotification } from './handlers/notification';
import { handleStep } from './handlers/step';
import { handleEmail } from './handlers/email';
import { handleAudit } from './handlers/audit';
import { handleCacheInvalidate } from './handlers/cache';
import { handleWebhookDelivery } from './handlers/webhookDelivery';

export async function route(body: Record<string, unknown>): Promise<void> {
  const type = body.type as string | undefined;

  switch (type) {
    case 'notification.fire':
      await handleNotification(body);
      break;
    case 'notification.step':
      await handleStep(body);
      break;
    case 'email.send':
      await handleEmail(body);
      break;
    case 'audit.write':
      await handleAudit(body);
      break;
    case 'cache.invalidate':
      await handleCacheInvalidate(body);
      break;
    case 'webhook.deliver':
      await handleWebhookDelivery(body);
      break;
    default:
      console.log('Worker received unknown job type — skipping', { type });
  }
}
