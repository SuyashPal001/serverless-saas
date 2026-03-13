import { Hono } from 'hono';
import type { AppEnv } from '../types';

export const entitlementsRoutes = new Hono<AppEnv>();

// GET /entitlements — returns plan entitlements for the tenant's current plan
// No permission check — all authenticated users can read their own entitlements
entitlementsRoutes.get('/', async (c) => {
    const requestContext = c.get('requestContext') as any;

    try {
        // Entitlements are already loaded and cached by entitlementsMiddleware
        // Format: { featureId: { enabled, valueLimit, unlimited }, ... }
        const entitlements = requestContext?.entitlements ?? {};

        return c.json({ entitlements });
    } catch (err: any) {
        console.error('Get entitlements error:', err);
        const code = err.name || 'INTERNAL_ERROR';
        const message = err.message || 'Failed to fetch entitlements';
        return c.json({ error: message, code }, 500);
    }
});
