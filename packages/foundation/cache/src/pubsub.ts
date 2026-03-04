import type { Redis } from '@upstash/redis';
import type { PubSubChannel } from './keys';

// ============================================
// Invalidation message types
// ============================================

export interface CacheInvalidationMessage {
  type: 'tenant_context' | 'permissions' | 'entitlements' | 'all';
  tenantId: string;
  userId?: string;
  timestamp: string;
}

export interface SessionInvalidationMessage {
  jti: string;
  tenantId: string;
  reason: string;
  timestamp: string;
}

export type PubSubMessage = CacheInvalidationMessage | SessionInvalidationMessage;

// ============================================
// Publish helpers
// ============================================

export const publishCacheInvalidation = async (
  redis: Redis,
  channel: PubSubChannel,
  message: PubSubMessage,
): Promise<void> => {
  await redis.publish(channel, JSON.stringify(message));
};

export const invalidateTenantContext = async (
  redis: Redis,
  tenantId: string,
): Promise<void> => {
  await publishCacheInvalidation(redis, 'cache:invalidation', {
    type: 'tenant_context',
    tenantId,
    timestamp: new Date().toISOString(),
  });
};

export const invalidatePermissions = async (
  redis: Redis,
  tenantId: string,
  userId: string,
): Promise<void> => {
  await publishCacheInvalidation(redis, 'cache:invalidation', {
    type: 'permissions',
    tenantId,
    userId,
    timestamp: new Date().toISOString(),
  });
};

export const invalidateEntitlements = async (
  redis: Redis,
  tenantId: string,
): Promise<void> => {
  await publishCacheInvalidation(redis, 'cache:invalidation', {
    type: 'entitlements',
    tenantId,
    timestamp: new Date().toISOString(),
  });
};

export const invalidateAllTenantCache = async (
  redis: Redis,
  tenantId: string,
): Promise<void> => {
  await publishCacheInvalidation(redis, 'cache:invalidation', {
    type: 'all',
    tenantId,
    timestamp: new Date().toISOString(),
  });
};
