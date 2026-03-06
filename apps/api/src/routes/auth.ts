import { Hono } from 'hono';
import type { AppEnv } from '../types';


const authRoutes = new Hono<AppEnv>();

authRoutes.get('/me', (c) => {
    const requestContext = c.get('requestContext') as any;
    const userId = c.get('userId');

    return c.json({
        userId,
        tenantId: requestContext?.tenant?.id,
        slug: requestContext?.tenant?.slug,
        status: requestContext?.tenant?.status,
        permissions: requestContext?.permissions ?? [],
        needsOnboarding: requestContext?.needsOnboarding ?? false,
    });
});

export { authRoutes };