/**
 * Session Management Routes
 *
 * Admin endpoints for viewing and managing active agent sessions.
 * Sessions are tracked in Redis by the message relay.
 */

import { Hono } from 'hono';
import {
    getTenantSessions,
    getTenantSessionCount,
    getSessionData,
    endSession,
    cleanupTenantSessions,
} from '@serverless-saas/ai';
import type { AppEnv } from '../types';

export const sessionsRoutes = new Hono<AppEnv>();

// GET /api/v1/sessions — list active sessions for current tenant
sessionsRoutes.get('/', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;

    const [sessions, total] = await Promise.all([
        getTenantSessions(tenantId),
        getTenantSessionCount(tenantId),
    ]);

    return c.json({ sessions, total });
});

// GET /api/v1/sessions/:sessionId — get session details
sessionsRoutes.get('/:sessionId', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const sessionId = c.req.param('sessionId');

    const session = await getSessionData(sessionId);

    if (!session || session.tenantId !== tenantId) {
        return c.json({ error: 'Session not found', code: 'NOT_FOUND' }, 404);
    }

    return c.json({ data: session });
});

// POST /api/v1/sessions/:sessionId/end — manually end a session
sessionsRoutes.post('/:sessionId/end', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const sessionId = c.req.param('sessionId');

    const session = await getSessionData(sessionId);

    if (!session || session.tenantId !== tenantId) {
        return c.json({ error: 'Session not found', code: 'NOT_FOUND' }, 404);
    }

    await endSession(sessionId, 'user_cancelled');

    return c.json({ success: true });
});

// POST /api/v1/sessions/cleanup — prune stale session references from Redis set
sessionsRoutes.post('/cleanup', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;

    const cleaned = await cleanupTenantSessions(tenantId);

    return c.json({ cleaned });
});
