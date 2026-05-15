import { getRedis } from '../redis';

interface CachePayload {
  keys: string[];
}

export async function handleCacheInvalidate(body: Record<string, unknown>): Promise<void> {
  const payload = body.payload as CachePayload;
  const redis = getRedis();

  for (const key of payload.keys) {
    await redis.del(key);
  }

  console.log('Cache keys invalidated', { count: payload.keys.length, keys: payload.keys });
}