import { getCacheClient, pushToConnection } from '@serverless-saas/cache';

export async function pushWebSocketEvent(
  tenantId: string,
  payload: Record<string, unknown>
): Promise<void> {
  const cache = getCacheClient();
  let cursor = 0;

  do {
    const [nextCursor, keys] = await cache.scan(cursor, {
      match: `ws:tenant:${tenantId}:user:*`,
      count: 100,
    });
    cursor = Number(nextCursor);

    await Promise.all(
      (keys as string[]).map(async (key) => {
        const connectionIds = await cache.smembers(key);
        await Promise.all(
          connectionIds.map(async (connectionId) => {
            const ok = await pushToConnection(connectionId, payload);
            if (!ok) await cache.srem(key, connectionId);
          })
        );
      })
    );
  } while (cursor !== 0);
}
