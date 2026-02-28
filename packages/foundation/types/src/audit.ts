import type { Timestamps } from './common';
import type { ActorType, AuditSource } from './enums';

// ============================================
// Audit Log
// ============================================

export interface AuditLogEntry extends Pick<Timestamps, 'createdAt'> {
  id: string;
  tenantId: string;
  actorId: string;
  actorType: ActorType;
  action: string;
  resource: string;
  resourceId: string | null;
  metadata: AuditMetadata | null;
  ipAddress: string | null;
  traceId: string;
}

export interface AuditMetadata {
  previousValue?: unknown;
  newValue?: unknown;
  reason?: string;
  source?: AuditSource;
  additionalContext?: Record<string, unknown>;
}

export type CreateAuditLogInput = Pick<AuditLogEntry, 'tenantId' | 'actorId' | 'actorType' | 'action' | 'resource' | 'traceId'> & {
  resourceId?: string;
  metadata?: AuditMetadata;
  ipAddress?: string;
};
