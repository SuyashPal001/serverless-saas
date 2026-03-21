import { createMiddleware } from 'hono/factory';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import type { AppEnv } from '../types';

// Initialize SQS client once per lambda execution environment
const sqs = new SQSClient({ region: process.env.AWS_REGION ?? 'ap-south-1' });

export const usageRecordingMiddleware = createMiddleware<AppEnv>(async (c, next) => {
    // 1. Await next to allow the request to finish processing
    await next();

    // 2. Only record successful requests
    if (c.res.status >= 300) {
        return;
    }

    // 3. Skip health check routes
    const path = c.req.path;
    if (path.startsWith('/health')) {
        return;
    }

    // 4. Retrieve context
    const tenantId = c.get('tenantId');
    if (!tenantId) {
        return; // Skip public/unauthenticated routes where tenant context is not set
    }

    const userId = c.get('userId');
    const agentId = c.get('agentId');
    const apiKeyId = c.get('apiKeyId');
    const actorId = userId || agentId;
    const actorType = c.get('actorType') || 'human';

    if (!actorId) {
        return; // Should not happen on secure routes, but safety first
    }

    const queueUrl = process.env.SQS_PROCESSING_QUEUE_URL;
    if (!queueUrl) {
        console.warn('SQS_PROCESSING_QUEUE_URL not set — skipping usage recording');
        return;
    }

    // 5. Fire and forget to SQS
    const message = {
        type: 'usage.record',
        tenantId,
        actorId,
        actorType,
        apiKeyId: apiKeyId || null,
        metric: 'api_calls',
        quantity: 1,
        recordedAt: new Date().toISOString(),
    };

    const command = new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(message),
    });

    void sqs.send(command).catch(err => {
        console.error('Failed to send usage record to SQS:', err);
    });
});
