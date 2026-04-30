import { getCacheClient, pushToConnection } from '@serverless-saas/cache';

export async function pushWebSocketEvent(
  tenantId: string,
  payload: Record<string, unknown>
): Promise<void> {
  const key = `ws:tenant:${tenantId}:connections`;
  const cache = getCacheClient();
  const connectionIds = await cache.smembers(key);
  await Promise.allSettled(
    connectionIds.map(async (connectionId) => {
      const ok = await pushToConnection(connectionId, payload);
      if (!ok) await cache.srem(key, connectionId);
    })
  );
}
