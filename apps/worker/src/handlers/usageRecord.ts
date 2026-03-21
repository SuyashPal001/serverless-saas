import { db } from '../db';
import { usageRecords } from '@serverless-saas/database';

export interface UsageRecordEvent {
    type: 'usage.record';
    tenantId: string;
    actorId: string;
    actorType: 'human' | 'agent';
    apiKeyId?: string | null;
    metric: string;
    quantity: number;
    recordedAt: string;
}

export async function handleUsageRecord(body: Record<string, unknown>): Promise<void> {
    const msg = body as unknown as UsageRecordEvent;

    // Validate minimal required fields
    if (!msg.tenantId || !msg.actorId || !msg.metric) {
        console.warn('Missing required fields in usage.record event', msg);
        return;
    }

    try {
        await db.insert(usageRecords).values({
            tenantId: msg.tenantId,
            actorId: msg.actorId,
            actorType: msg.actorType || 'human',
            apiKeyId: msg.apiKeyId || null,
            metric: msg.metric,
            quantity: msg.quantity?.toString() || '1',
            recordedAt: new Date(msg.recordedAt || Date.now()),
        });
        
        console.log('Successfully recorded usage', {
            tenantId: msg.tenantId,
            metric: msg.metric,
            quantity: msg.quantity,
            apiKeyId: msg.apiKeyId || null
        });
    } catch (error) {
        console.error('Failed to insert usage record:', error);
        throw error; // Re-throw to allow SQS retry
    }
}