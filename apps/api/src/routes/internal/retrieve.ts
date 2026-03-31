import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { AppEnv } from '../../types';

const retrieveRoute = new Hono<AppEnv>();

// POST /api/v1/internal/retrieve
retrieveRoute.post(
  '/retrieve',
  zValidator('json', z.object({
    query: z.string().min(1),
    tenantId: z.string().uuid(),
    limit: z.number().int().positive().optional(),
    scoreThreshold: z.number().min(0).max(1).optional(),
  })),
  async (c) => {
    // Auth: service API key header
    const serviceKey = c.req.header('X-Service-Key');
    const internalServiceKey = process.env.INTERNAL_SERVICE_KEY;

    if (!internalServiceKey || serviceKey !== internalServiceKey) {
      return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
    }

    // Stub response for Phase 1B
    return c.json({ context: '', chunks: [] }, 200);
  }
);

export default retrieveRoute;
