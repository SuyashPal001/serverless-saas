import { getCacheClient, type CacheClient } from '@serverless-saas/cache';

export type { CacheClient };

export const getRedis = (): CacheClient => getCacheClient();
