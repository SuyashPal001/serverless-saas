import type { Context } from 'hono';
import type { AppEnv } from '../types';

export const isPlatformAdmin = (c: Context<AppEnv>): boolean => {
    const jwtPayload = c.get('jwtPayload') as any;
    return jwtPayload?.['custom:role'] === 'platform_admin';
};
