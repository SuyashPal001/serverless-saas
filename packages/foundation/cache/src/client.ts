import { Redis as UpstashRedis } from '@upstash/redis';
import Redis from 'ioredis';

// Unified interface — both clients expose ping, get, set, del
export type CacheClient = {
  ping: () => Promise<string>;
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, options?: { ex?: number }) => Promise<string | null>;
  del: (...keys: string[]) => Promise<number>;
  exists: (...keys: string[]) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<number>;
  incr: (key: string) => Promise<number>;
};

let instance: CacheClient | null = null;

const isLocalRedis = (url: string): boolean =>
  url.startsWith('redis://') || url.startsWith('rediss://');

const createUpstashClient = (url: string, token: string): CacheClient => {
  const client = new UpstashRedis({ url, token });
  return {
    ping: () => client.ping(),
    get: (key) => client.get(key),
    set: (key, value, opts) =>
      client.set(key, value, opts?.ex ? { ex: opts.ex } : undefined) as Promise<string | null>,
    del: (...keys) => client.del(...keys),
    exists: (...keys) => client.exists(...keys),
    expire: (key, seconds) => client.expire(key, seconds),
    incr: (key) => client.incr(key),
  };
};

const createIoRedisClient = (url: string): CacheClient => {
  const client = new Redis(url);
  return {
    ping: () => client.ping(),
    get: (key) => client.get(key),
    set: (key, value, opts) =>
      opts?.ex
        ? client.set(key, value, 'EX', opts.ex)
        : client.set(key, value),
    del: (...keys) => client.del(...keys),
    exists: (...keys) => client.exists(...keys),
    expire: (key, seconds) => client.expire(key, seconds),
    incr: (key) => client.incr(key),
  };
};

export const getCacheClient = (): CacheClient => {
  if (!instance) {
    const url = process.env.UPSTASH_REDIS_URL;
    const token = process.env.UPSTASH_REDIS_TOKEN;

    if (!url) {
      throw new Error('UPSTASH_REDIS_URL must be set');
    }

    if (isLocalRedis(url)) {
      // Local dev — use ioredis with standard Redis protocol
      instance = createIoRedisClient(url);
    } else {
      // Production — use Upstash REST client
      if (!token) {
        throw new Error('UPSTASH_REDIS_TOKEN must be set for Upstash');
      }
      instance = createUpstashClient(url, token);
    }
  }
  return instance;
};

export const resetCacheClient = (): void => {
  instance = null;
};
