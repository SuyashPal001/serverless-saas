import { Hono } from 'hono';
import { z } from 'zod';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { db } from '@serverless-saas/database';
import { knowledgeGaps } from '@serverless-saas/database/schema/intelligence';
import type { AppEnv } from '../../types';

const ssm = new SSMClient({ region: process.env.AWS_REGION ?? 'ap-south-1' });
let cachedServiceKey: string | null = null;

async function getServiceKey(): Promise<string> {
  if (cachedServiceKey) return cachedServiceKey;
  const env = process.env.NODE_ENV || 'dev';
  const project = process.env.PROJECT || 'serverless-saas';
  try {
    const result = await ssm.send(new GetParameterCommand({
      Name: `/${project}/${env}/internal-service-key`,
      WithDecryption: true,
    }));
    cachedServiceKey = result.Parameter?.Value || '';
    return cachedServiceKey;
  } catch {
    return process.env.INTERNAL_SERVICE_KEY || '';
  }
}

async function authServiceKey(c: any): Promise<boolean> {
  const provided = c.req.header('X-Service-Key');
  if (!provided) return false;
  const expected = await getServiceKey();
  return provided === expected;
}

const internalKnowledgeGapsRoute = new Hono<AppEnv>();

// POST /internal/knowledge-gaps — relay calls this when RAG fires but returns no chunks
internalKnowledgeGapsRoute.post('/', async (c) => {
  if (!await authServiceKey(c)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const schema = z.object({
    tenantId:       z.string().uuid(),
    conversationId: z.string().uuid().optional(),
    query:          z.string().min(1),
    ragScore:       z.number().min(0).max(1).optional(),
  });

  const result = schema.safeParse(await c.req.json());
  if (!result.success) {
    return c.json({ error: result.error.errors[0].message }, 400);
  }

  const d = result.data;

  try {
    await db.insert(knowledgeGaps).values({
      tenantId:       d.tenantId,
      conversationId: d.conversationId ?? null,
      query:          d.query,
      ragScore:       d.ragScore?.toString() ?? null,
    });
  } catch (err) {
    console.error('[internal/knowledge-gaps] insert failed:', err);
  }

  return c.json({ success: true }, 200);
});

export default internalKnowledgeGapsRoute;
