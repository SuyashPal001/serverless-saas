// ============================================
// Tenant context
// ============================================

export const tenantContextKey = (tenantId: string): string =>
  `tenant:${tenantId}:context`;

// ============================================
// Permissions
// ============================================

export const permissionSetKey = (tenantId: string, userId: string): string =>
  `tenant:${tenantId}:user:${userId}:perms`;

// ============================================
// Entitlements
// ============================================

export const entitlementSetKey = (tenantId: string): string =>
  `tenant:${tenantId}:entitlements`;

// ============================================
// Rate limiting
// ============================================

export const rateLimitKey = (tenantId: string, window: string): string =>
  `tenant:${tenantId}:ratelimit:${window}`;

// ============================================
// Session blacklist
// ============================================

export const sessionBlacklistKey = (jti: string): string =>
  `session:blacklist:${jti}`;

// ============================================
// Idempotency
// ============================================

export const idempotencyKey = (domain: string, id: string): string =>
  `idempotency:${domain}:${id}`;

// ============================================
// WebSocket connections (notification inbox)
// ============================================

export const wsConnectionKey = (tenantId: string, userId: string): string =>
  `ws:${tenantId}:${userId}:connectionId`;

// ============================================
// Pub/Sub channels
// ============================================

export const PUBSUB_CHANNELS = {
  CACHE_INVALIDATION: 'cache:invalidation',
  SESSION_INVALIDATION: 'session:invalidation',
} as const;

export type PubSubChannel = (typeof PUBSUB_CHANNELS)[keyof typeof PUBSUB_CHANNELS];

// ============================================
// TTL constants (seconds)
// ============================================

export const TTL = {
  TENANT_CONTEXT: 15 * 60,       // 15 minutes
  PERMISSION_SET: 15 * 60,       // 15 minutes
  ENTITLEMENT_SET: 15 * 60,      // 15 minutes
  SESSION_BLACKLIST: 60 * 60,    // 1 hour (match JWT expiry)
  IDEMPOTENCY: 48 * 60 * 60,    // 48 hours
  USAGE_COUNTER: 60,             // 60 seconds
  WS_CONNECTION: 24 * 60 * 60,  // 24 hours
} as const;
