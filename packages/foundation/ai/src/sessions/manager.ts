/**
 * Agent Session Manager
 *
 * Persists agent session state in Redis so sessions survive Lambda restarts
 * and are visible across instances.
 *
 * Key structure:
 *   agent:session:conversation:{conversationId}  → sessionId (string, TTL = SESSION_TTL)
 *   agent:session:data:{sessionId}               → SessionData (JSON string, TTL = SESSION_TTL)
 *   agent:session:tenant:{tenantId}:active        → Set of sessionIds
 */

import { getCacheClient } from '@serverless-saas/cache';

// =============================================================================
// CONFIGURATION
// =============================================================================

/** Active session TTL in seconds (1 hour, refreshed on each message) */
const SESSION_TTL = 60 * 60;

/** Ended session TTL in seconds (kept briefly for debugging) */
const ENDED_SESSION_TTL = 5 * 60;

// =============================================================================
// TYPES
// =============================================================================

export interface SessionData {
  sessionId: string;
  conversationId: string;
  tenantId: string;
  agentId: string;
  userId: string;
  startedAt: string;
  lastActivityAt: string;
  status: 'active' | 'ended' | 'error';
  metadata?: Record<string, unknown>;
}

export interface SessionSummary {
  sessionId: string;
  conversationId: string;
  status: SessionData['status'];
  startedAt: string;
  lastActivityAt: string;
}

// =============================================================================
// KEY HELPERS
// =============================================================================

const conversationSessionKey = (conversationId: string): string =>
  `agent:session:conversation:${conversationId}`;

const sessionDataKey = (sessionId: string): string =>
  `agent:session:data:${sessionId}`;

const tenantSessionsKey = (tenantId: string): string =>
  `agent:session:tenant:${tenantId}:active`;

// =============================================================================
// HELPERS
// =============================================================================

function parseSessionData(raw: string | null): SessionData | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionData;
  } catch {
    return null;
  }
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Get the active sessionId for a conversation, or null if none exists.
 */
export async function getSession(conversationId: string): Promise<string | null> {
  const cache = getCacheClient();
  const sessionId = await cache.get(conversationSessionKey(conversationId));
  if (!sessionId) return null;

  // Verify session data still exists and is active
  const raw = await cache.get(sessionDataKey(sessionId));
  const data = parseSessionData(raw);

  if (!data || data.status !== 'active') {
    // Stale pointer — clean up
    await cache.del(conversationSessionKey(conversationId));
    return null;
  }

  return sessionId;
}

/**
 * Get full session data by sessionId.
 */
export async function getSessionData(sessionId: string): Promise<SessionData | null> {
  const cache = getCacheClient();
  const raw = await cache.get(sessionDataKey(sessionId));
  return parseSessionData(raw);
}

/**
 * Store a new session in Redis. If an active session already exists for this
 * conversation, returns the existing sessionId (and extends its TTL).
 */
export async function createSession(params: {
  sessionId: string;
  conversationId: string;
  tenantId: string;
  agentId: string;
  userId: string;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  const cache = getCacheClient();
  const { sessionId, conversationId, tenantId, agentId, userId, metadata } = params;

  // Re-check for an existing session (guard against races)
  const existing = await getSession(conversationId);
  if (existing) {
    await touchSession(existing);
    return existing;
  }

  const now = new Date().toISOString();
  const data: SessionData = {
    sessionId,
    conversationId,
    tenantId,
    agentId,
    userId,
    startedAt: now,
    lastActivityAt: now,
    status: 'active',
    metadata,
  };

  await cache.set(sessionDataKey(sessionId), JSON.stringify(data), { ex: SESSION_TTL });
  await cache.set(conversationSessionKey(conversationId), sessionId, { ex: SESSION_TTL });
  await cache.sadd(tenantSessionsKey(tenantId), sessionId);

  return sessionId;
}

/**
 * Update last activity timestamp and extend TTL.
 * Call on every successful message send.
 */
export async function touchSession(sessionId: string): Promise<boolean> {
  const cache = getCacheClient();
  const raw = await cache.get(sessionDataKey(sessionId));
  const data = parseSessionData(raw);
  if (!data) return false;

  data.lastActivityAt = new Date().toISOString();

  await cache.set(sessionDataKey(sessionId), JSON.stringify(data), { ex: SESSION_TTL });
  await cache.expire(conversationSessionKey(data.conversationId), SESSION_TTL);

  return true;
}

/**
 * Mark a session as ended and remove the conversation → session pointer.
 * Session data is kept briefly for debugging.
 */
export async function endSession(
  sessionId: string,
  reason: 'completed' | 'error' | 'timeout' | 'user_cancelled',
): Promise<void> {
  const cache = getCacheClient();
  const raw = await cache.get(sessionDataKey(sessionId));
  const data = parseSessionData(raw);
  if (!data) return;

  data.status = reason === 'completed' ? 'ended' : 'error';
  data.lastActivityAt = new Date().toISOString();

  await cache.set(sessionDataKey(sessionId), JSON.stringify(data), { ex: ENDED_SESSION_TTL });
  await cache.del(conversationSessionKey(data.conversationId));
  await cache.srem(tenantSessionsKey(data.tenantId), sessionId);
}

/**
 * Remove all session data for a conversation (used on error recovery).
 */
export async function clearSession(conversationId: string): Promise<void> {
  const cache = getCacheClient();
  const sessionId = await cache.get(conversationSessionKey(conversationId));

  if (sessionId) {
    const raw = await cache.get(sessionDataKey(sessionId));
    const data = parseSessionData(raw);
    if (data) {
      await cache.srem(tenantSessionsKey(data.tenantId), sessionId);
    }
    await cache.del(sessionDataKey(sessionId));
  }

  await cache.del(conversationSessionKey(conversationId));
}

/**
 * List all active sessions for a tenant with stale-entry cleanup.
 */
export async function getTenantSessions(tenantId: string): Promise<SessionSummary[]> {
  const cache = getCacheClient();
  const sessionIds = await cache.smembers(tenantSessionsKey(tenantId));
  if (sessionIds.length === 0) return [];

  const summaries: SessionSummary[] = [];

  for (const sessionId of sessionIds) {
    const raw = await cache.get(sessionDataKey(sessionId));
    const data = parseSessionData(raw);

    if (data && data.status === 'active') {
      summaries.push({
        sessionId: data.sessionId,
        conversationId: data.conversationId,
        status: data.status,
        startedAt: data.startedAt,
        lastActivityAt: data.lastActivityAt,
      });
    } else {
      // Prune stale reference from the set
      await cache.srem(tenantSessionsKey(tenantId), sessionId);
    }
  }

  return summaries;
}

/**
 * Count active sessions for a tenant.
 * Uses smembers so also prunes stale entries.
 */
export async function getTenantSessionCount(tenantId: string): Promise<number> {
  const sessions = await getTenantSessions(tenantId);
  return sessions.length;
}

/**
 * Remove all expired session references from a tenant's active set.
 * Safe to call at any time; TTL expiry handles the underlying keys automatically.
 *
 * @returns Number of stale entries removed
 */
export async function cleanupTenantSessions(tenantId: string): Promise<number> {
  const cache = getCacheClient();
  const sessionIds = await cache.smembers(tenantSessionsKey(tenantId));
  if (sessionIds.length === 0) return 0;

  let cleaned = 0;

  for (const sessionId of sessionIds) {
    const raw = await cache.get(sessionDataKey(sessionId));
    if (!raw) {
      await cache.srem(tenantSessionsKey(tenantId), sessionId);
      cleaned++;
    }
  }

  return cleaned;
}
