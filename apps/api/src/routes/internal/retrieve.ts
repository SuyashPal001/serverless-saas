import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import type { AppEnv } from '../../types';

const ssm = new SSMClient({ region: process.env.AWS_REGION ?? 'ap-south-1' });
let cachedServiceKey: string | null = null;

async function getServiceKey(): Promise<string> {
  if (cachedServiceKey) return cachedServiceKey;
  
  const env = process.env.NODE_ENV || 'dev';
  const project = process.env.PROJECT || 'serverless-saas';
  const paramName = `/${project}/${env}/internal-service-key`;

  try {
    const result = await ssm.send(new GetParameterCommand({
      Name: paramName,
      WithDecryption: true,
    }));
    cachedServiceKey = result.Parameter?.Value || '';
    return cachedServiceKey;
  } catch (error) {
    console.error('Failed to fetch internal-service-key from SSM:', error);
    throw error;
  }
}

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
    try {
      // Auth: service API key header
      const serviceKey = await getServiceKey();
      const provided = c.req.header('X-Service-Key');

      if (!provided || provided !== serviceKey) {
        return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
      }

      // Stub response for Phase 1B
      return c.json({ context: '', chunks: [] }, 200);
    } catch (error) {
      return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
    }
  }
);

export default retrieveRoute;
