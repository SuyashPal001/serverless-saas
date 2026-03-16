import { getRedis } from '../redis';

interface CacheInvalidateEvent {
  type: 'cache.invalidate';
  keys: string[];
}

export async function handleCacheInvalidate(body: Record<string, unknown>): Promise<void> {
  const event = body as unknown as CacheInvalidateEvent;
  const redis = getRedis();

  for (const key of event.keys) {
    await redis.del(key);
  }

  console.log('Cache keys invalidated', { count: event.keys.length, keys: event.keys });
}
