import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../types';

export const queryScopeMiddleware = createMiddleware<AppEnv>(async (c, next) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    c.set('tenantId', tenantId ?? '');
    return next();



});