import { createHmac } from 'crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { webhookEndpoints, webhookDeliveryLog } from '@serverless-saas/database';

export interface WebhookDeliverEvent {
  type: 'webhook.deliver';
  tenantId: string;
  event: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export async function handleWebhookDelivery(body: Record<string, unknown>): Promise<void> {
  const msg = body as unknown as WebhookDeliverEvent;
  const { tenantId, event, payload, timestamp } = msg;

  // Find all active endpoints for this tenant that subscribe to this event
  const endpoints = await db
    .select()
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.tenantId, tenantId),
        eq(webhookEndpoints.status, 'active'),
        sql`${webhookEndpoints.events} @> ARRAY[${event}]::text[]`,
      ),
    );

  if (endpoints.length === 0) {
    console.log('No active webhook endpoints for event', { tenantId, event });
    return;
  }

  const payloadString = JSON.stringify({ event, payload, timestamp });

  for (const endpoint of endpoints) {
    const signature = createHmac('sha256', endpoint.secret)
      .update(payloadString)
      .digest('hex');

    let httpStatus: number | null = null;
    let responseBody: string | null = null;
    let error: string | null = null;
    let status: 'delivered' | 'failed' = 'delivered';

    try {
      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': `sha256=${signature}`,
          'X-Webhook-Event': event,
          'X-Webhook-Timestamp': timestamp,
        },
        body: payloadString,
        signal: AbortSignal.timeout(10_000),
      });

      httpStatus = response.status;
      responseBody = await response.text().catch(() => null);

      if (!response.ok) {
        status = 'failed';
        error = `HTTP ${response.status}`;
      }
    } catch (err) {
      status = 'failed';
      error = err instanceof Error ? err.message : String(err);
    }

    await db.insert(webhookDeliveryLog).values({
      endpointId: endpoint.id,
      tenantId,
      event,
      payload,
      status,
      attempts: 1,
      httpStatus,
      responseBody,
      error,
    });

    console.log('Webhook delivery attempt', {
      endpointId: endpoint.id,
      url: endpoint.url,
      event,
      status,
      httpStatus,
    });

    // Re-throw on failure so SQS marks this message as failed and retries
    if (status === 'failed') {
      throw new Error(`Webhook delivery failed for endpoint ${endpoint.id}: ${error}`);
    }
  }
}
