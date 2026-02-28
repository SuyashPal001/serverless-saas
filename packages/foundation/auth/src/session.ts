import type { Redis } from '@upstash/redis';
import { sessionBlacklistKey, TTL } from '@serverless-saas/cache';

export class SessionManager {
  constructor(private redis: Redis) {}

  async isBlacklisted(jti: string): Promise<boolean> {
    const exists = await this.redis.exists(sessionBlacklistKey(jti));
    return exists === 1;
  }

  async blacklist(jti: string, reason: string, ttlSeconds?: number): Promise<void> {
    const key = sessionBlacklistKey(jti);
    await this.redis.set(
      key,
      JSON.stringify({ reason, blacklistedAt: new Date().toISOString() }),
      { ex: ttlSeconds ?? TTL.SESSION_BLACKLIST },
    );
  }

  async blacklistMany(
    jtis: string[],
    reason: string,
    ttlSeconds?: number,
  ): Promise<void> {
    const pipeline = this.redis.pipeline();
    const ttl = ttlSeconds ?? TTL.SESSION_BLACKLIST;
    for (const jti of jtis) {
      pipeline.set(
        sessionBlacklistKey(jti),
        JSON.stringify({ reason, blacklistedAt: new Date().toISOString() }),
        { ex: ttl },
      );
    }
    await pipeline.exec();
  }
}
