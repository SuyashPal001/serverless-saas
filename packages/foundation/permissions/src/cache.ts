import type { Redis } from '@upstash/redis';
import type { PermissionSet } from '@serverless-saas/types';
import { permissionSetKey, TTL } from '@serverless-saas/cache';
import { toPermissionStrings, fromPermissionStrings } from './check';
import type { PermissionString } from '@serverless-saas/types';

export class PermissionCache {
  constructor(private redis: Redis) {}

  async get(tenantId: string, userId: string): Promise<PermissionSet | null> {
    const key = permissionSetKey(tenantId, userId);
    const cached = await this.redis.get<string>(key);
    if (!cached) return null;

    try {
      const strings = JSON.parse(cached) as PermissionString[];
      return fromPermissionStrings(strings);
    } catch {
      await this.redis.del(key);
      return null;
    }
  }

  async set(tenantId: string, userId: string, permissions: PermissionSet): Promise<void> {
    const key = permissionSetKey(tenantId, userId);
    const strings = toPermissionStrings(permissions);
    await this.redis.set(key, JSON.stringify(strings), { ex: TTL.PERMISSION_SET });
  }

  async invalidate(tenantId: string, userId: string): Promise<void> {
    const key = permissionSetKey(tenantId, userId);
    await this.redis.del(key);
  }
}
