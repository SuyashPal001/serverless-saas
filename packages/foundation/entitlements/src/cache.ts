import type { Redis } from '@upstash/redis';
import type { EntitlementSet } from '@serverless-saas/types';
import { entitlementSetKey, TTL } from '@serverless-saas/cache';

export class EntitlementCache {
  constructor(private redis: Redis) {}

  async get(tenantId: string): Promise<EntitlementSet | null> {
    const key = entitlementSetKey(tenantId);
    const cached = await this.redis.get<string>(key);
    if (!cached) return null;

    try {
      return JSON.parse(cached) as EntitlementSet;
    } catch {
      await this.redis.del(key);
      return null;
    }
  }

  async set(tenantId: string, entitlements: EntitlementSet): Promise<void> {
    const key = entitlementSetKey(tenantId);
    await this.redis.set(key, JSON.stringify(entitlements), { ex: TTL.ENTITLEMENT_SET });
  }

  async invalidate(tenantId: string): Promise<void> {
    const key = entitlementSetKey(tenantId);
    await this.redis.del(key);
  }
}
