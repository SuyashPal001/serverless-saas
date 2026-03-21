import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({ region: process.env.AWS_REGION ?? 'ap-south-1' });

/**
 * Enqueue a webhook delivery job for a tenant event.
 *
 * The worker picks this up from SQS, queries matching active webhook_endpoints,
 * signs the payload, and POSTs to each subscribed URL.
 *
 * Fire-and-forget — do not await in hot paths if latency matters.
 */
export async function fireWebhookEvent(
  tenantId: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const queueUrl = process.env.SQS_PROCESSING_QUEUE_URL;
  if (!queueUrl) {
    console.warn('SQS_PROCESSING_QUEUE_URL not set — webhook event not enqueued', { tenantId, event });
    return;
  }

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({
        type: 'webhook.deliver',
        tenantId,
        event,
        payload,
        timestamp: new Date().toISOString(),
      }),
    }),
  );
}
