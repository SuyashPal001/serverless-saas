import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types";
import { getCacheClient } from '@serverless-saas/cache';

export const sessionValidationMiddleware = createMiddleware<AppEnv>(async (c, next) => {
    const sessionPayload = c.get('jwtPayload');
    const jti = sessionPayload?.['jti'];

    if (!jti) {
        return next();
    }
    const blacklistKey = `session:blacklist:${jti}`;
    const isBlacklisted = await getCacheClient().get(blacklistKey);

    if (isBlacklisted) {
        console.log('401 reason: session invalidated', { jti, blacklistKey, path: c.req.path });
        return c.json({ error: 'Session has been invalidated', code: 'SESSION_INVALIDATED' }, 401);
    }

    return next();

})
