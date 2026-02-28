import { Redis } from '@upstash/redis';

let instance: Redis | null = null;

export interface CacheConfig {
  url: string;
  token: string;
}

export const createCacheClient = (config: CacheConfig): Redis => {
  return new Redis({
    url: config.url,
    token: config.token,
  });
};

export const getCacheClient = (config?: CacheConfig): Redis => {
  if (!instance) {
    if (!config) {
      const url = process.env.UPSTASH_REDIS_URL;
      const token = process.env.UPSTASH_REDIS_TOKEN;
      if (!url || !token) {
        throw new Error('UPSTASH_REDIS_URL and UPSTASH_REDIS_TOKEN must be set');
      }
      instance = createCacheClient({ url, token });
    } else {
      instance = createCacheClient(config);
    }
  }
  return instance;
};

/** Reset singleton — used in tests */
export const resetCacheClient = (): void => {
  instance = null;
};
