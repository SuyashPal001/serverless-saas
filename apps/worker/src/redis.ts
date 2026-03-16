import { getCacheClient } from '@serverless-saas/cache';
import type { CacheClient } from '@serverless-saas/cache';

export { CacheClient };

export const getRedis = (): CacheClient => getCacheClient();
