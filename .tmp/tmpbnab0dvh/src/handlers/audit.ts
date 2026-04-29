import { db } from '../db';
import { auditLog } from '@serverless-saas/database';

interface AuditWriteEvent {
  type: 'audit.write';
  tenantId: string;
  actorId: string;
  actorType: 'human' | 'agent' | 'system';
  action: string;
  resource: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  traceId?: string;
}

export async function handleAudit(body: Record<string, unknown>): Promise<void> {
  const event = body as unknown as AuditWriteEvent;

  await db.insert(auditLog).values({
    tenantId: event.tenantId,
    actorId: event.actorId,
    actorType: event.actorType,
    action: event.action,
    resource: event.resource,
    resourceId: event.resourceId ?? null,
    metadata: event.metadata ?? null,
    ipAddress: event.ipAddress ?? null,
    traceId: event.traceId ?? crypto.randomUUID(),
  });

  console.log('Audit log written', { tenantId: event.tenantId, action: event.action, resource: event.resource });
}
