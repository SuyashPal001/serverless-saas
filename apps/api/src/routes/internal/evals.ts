import { Hono } from 'hono';
import { z } from 'zod';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { db } from '@serverless-saas/database';
import { conversationMetrics } from '@serverless-saas/database/schema/conversations';
import { publishToQueue } from '../../lib/sqs';
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
    // Fall back to env var for local dev
    return process.env.INTERNAL_SERVICE_KEY || '';
  }
}

async function authServiceKey(c: any): Promise<boolean> {
  const provided = c.req.header('X-Service-Key');
  if (!provided) return false;
  const expected = await getServiceKey();
  return provided === expected;
}

const internalEvalsRoute = new Hono<AppEnv>();

// POST /internal/evals/metrics — relay calls this after each response
internalEvalsRoute.post('/metrics', async (c) => {
  if (!await authServiceKey(c)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const schema = z.object({
    conversationId: z.string().uuid(),
    tenantId: z.string().uuid(),
    ragFired: z.boolean(),
    ragChunksRetrieved: z.number().int().min(0).default(0),
    responseTimeMs: z.number().int().min(0).optional(),
    totalTokens: z.number().int().min(0).default(0),
    userMessageCount: z.number().int().min(0).default(0),
  });

  const result = schema.safeParse(await c.req.json());
  if (!result.success) {
    return c.json({ error: result.error.errors[0].message }, 400);
  }

  const d = result.data;

  await db
    .insert(conversationMetrics)
    .values({
      conversationId: d.conversationId,
      tenantId: d.tenantId,
      ragFired: d.ragFired,
      ragChunksRetrieved: d.ragChunksRetrieved,
      responseTimeMs: d.responseTimeMs ?? null,
      totalTokens: d.totalTokens,
      userMessageCount: d.userMessageCount,
    })
    .onConflictDoUpdate({
      target: conversationMetrics.conversationId,
      set: {
        ragFired: d.ragFired,
        ragChunksRetrieved: d.ragChunksRetrieved,
        responseTimeMs: d.responseTimeMs ?? null,
        totalTokens: d.totalTokens,
        userMessageCount: d.userMessageCount,
        updatedAt: new Date(),
      },
    });

  return c.json({ success: true }, 200);
});

// POST /internal/evals/auto — relay queues an AI eval job
internalEvalsRoute.post('/auto', async (c) => {
  if (!await authServiceKey(c)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const schema = z.object({
    conversationId: z.string().uuid(),
    messageId: z.string().uuid(),
    tenantId: z.string().uuid(),
    question: z.string().min(1),
    retrievedChunks: z.array(z.string()),
    answer: z.string().min(1),
  });

  const result = schema.safeParse(await c.req.json());
  if (!result.success) {
    return c.json({ error: result.error.errors[0].message }, 400);
  }

  const queueUrl = process.env.SQS_PROCESSING_QUEUE_URL;
  if (!queueUrl) {
    console.error('[internal/evals/auto] SQS_PROCESSING_QUEUE_URL not set');
    return c.json({ error: 'Queue not configured' }, 500);
  }

  await publishToQueue(queueUrl, { type: 'eval.auto', payload: result.data });

  return c.json({ queued: true }, 202);
});

export default internalEvalsRoute;
