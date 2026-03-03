import { Hono } from 'hono';
import { getCacheClient } from '@serverless-saas/cache';
import { db } from '@serverless-saas/database';
import { sql } from 'drizzle-orm';
import type { AppEnv } from '../types';

const healthRoutes = new Hono<AppEnv>();

// Basic liveness — Lambda is running
healthRoutes.get('/', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.APP_VERSION ?? '0.0.1',
  });
});

// Readiness — dependencies healthy
healthRoutes.get('/ready', async (c) => {
  const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};
  let allHealthy = true;

  // Cache check
  try {
    const start = Date.now();
    const redis = getCacheClient();
    await redis.ping();
    checks.cache = { status: 'ok', latencyMs: Date.now() - start };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    checks.cache = { status: 'error', error: message };
    allHealthy = false;
  }

  // Database check
  try {
    const start = Date.now();
    await db.execute(sql`SELECT 1`);
    checks.database = { status: 'ok', latencyMs: Date.now() - start };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    checks.database = { status: 'error', error: message };
    allHealthy = false;
  }

  const status = allHealthy ? 'ready' : 'degraded';
  return c.json({ status, checks }, allHealthy ? 200 : 503);
});

export { healthRoutes };
