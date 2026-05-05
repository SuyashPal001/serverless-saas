import { timingSafeEqual } from 'crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { retrieveChunks, formatContextBlock } from '@serverless-saas/ai';
import type { AppEnv } from '../../types';

function isAuthorized(provided: string): boolean {
  const expected = process.env.INTERNAL_SERVICE_KEY;
  if (!expected) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}

const bodySchema = z.object({
  query: z.string().min(1),
  tenantId: z.string().uuid(),
  limit: z.number().int().min(1).max(10).default(5),
  scoreThreshold: z.number().min(0).max(1).default(0.5),
});

const retrieveRoute = new Hono<AppEnv>();

// POST /api/v1/internal/retrieve
retrieveRoute.post(
  '/retrieve',
  zValidator('json', bodySchema),
  async (c) => {
    try {
      if (!isAuthorized(c.req.header('x-internal-service-key') ?? '')) {
        return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
      }

      const body = c.req.valid('json');
      const chunks = await retrieveChunks(
        body.query,
        body.tenantId,
        body.limit,
        body.scoreThreshold
      );

      const context = formatContextBlock(chunks);

      return c.json({ context, chunks }, 200);
    } catch (error) {
      console.error('Retrieve failed:', error);
      return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
    }
  }
);

export default retrieveRoute;
