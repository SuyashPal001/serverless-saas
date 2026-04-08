import { Hono } from 'hono';
import { and, eq, sql, desc } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@serverless-saas/database';
import {
  conversations,
  messages,
  conversationFeedback,
  conversationMetrics,
} from '@serverless-saas/database/schema/conversations';
import { hasPermission } from '@serverless-saas/permissions';
import type { AppEnv } from '../types';

// ── Feedback route — mounted at /conversations ────────────────────────────────
// POST /conversations/:conversationId/messages/:messageId/feedback

export const evalsFeedbackRoutes = new Hono<AppEnv>();

evalsFeedbackRoutes.post('/:conversationId/messages/:messageId/feedback', async (c) => {
  const requestContext = c.get('requestContext') as any;
  const tenantId = requestContext?.tenant?.id;
  const permissions = requestContext?.permissions ?? [];
  const userId = requestContext?.userId as string | undefined;

  if (!hasPermission(permissions, 'conversations', 'update')) {
    return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
  }

  const { conversationId, messageId } = c.req.param();

  // Verify the message belongs to this tenant's conversation
  const [msg] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.tenantId, tenantId), eq(messages.conversationId, conversationId)))
    .limit(1);

  if (!msg) {
    return c.json({ error: 'Message not found', code: 'NOT_FOUND' }, 404);
  }

  const schema = z.object({
    rating: z.enum(['up', 'down']),
    comment: z.string().max(200).optional(),
  });

  const result = schema.safeParse(await c.req.json());
  if (!result.success) {
    return c.json({ error: result.error.errors[0].message }, 400);
  }

  await db
    .insert(conversationFeedback)
    .values({
      messageId,
      conversationId,
      tenantId,
      userId: userId ?? null,
      rating: result.data.rating,
      comment: result.data.comment ?? null,
    })
    .onConflictDoNothing(); // unique(messageId, userId) — no re-rating

  return c.json({ success: true }, 201);
});

// ── Analytics routes — mounted at /evals ─────────────────────────────────────

export const evalsRoutes = new Hono<AppEnv>();

// GET /evals/summary
evalsRoutes.get('/summary', async (c) => {
  const requestContext = c.get('requestContext') as any;
  const tenantId = requestContext?.tenant?.id;
  const permissions = requestContext?.permissions ?? [];

  if (!hasPermission(permissions, 'analytics', 'read')) {
    return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
  }

  const [{ totalConversations }] = await db
    .select({ totalConversations: sql<number>`COUNT(*)::int` })
    .from(conversations)
    .where(eq(conversations.tenantId, tenantId));

  const [feedbackAgg] = await db
    .select({
      ratedMessages: sql<number>`COUNT(*)::int`,
      thumbsUp: sql<number>`SUM(CASE WHEN rating = 'up' THEN 1 ELSE 0 END)::int`,
      thumbsDown: sql<number>`SUM(CASE WHEN rating = 'down' THEN 1 ELSE 0 END)::int`,
    })
    .from(conversationFeedback)
    .where(eq(conversationFeedback.tenantId, tenantId));

  const [metricsAgg] = await db
    .select({
      totalMetrics: sql<number>`COUNT(*)::int`,
      ragFiredCount: sql<number>`SUM(CASE WHEN rag_fired THEN 1 ELSE 0 END)::int`,
      avgResponseTimeMs: sql<number>`COALESCE(AVG(response_time_ms), 0)::int`,
      totalTokens: sql<number>`COALESCE(SUM(total_tokens), 0)::int`,
      totalCostCents: sql<number>`COALESCE(SUM(total_cost_cents), 0)::int`,
    })
    .from(conversationMetrics)
    .where(eq(conversationMetrics.tenantId, tenantId));

  const ratedMessages = feedbackAgg?.ratedMessages ?? 0;
  const thumbsUp = feedbackAgg?.thumbsUp ?? 0;
  const thumbsDown = feedbackAgg?.thumbsDown ?? 0;
  const totalMetrics = metricsAgg?.totalMetrics ?? 0;
  const ragFiredCount = metricsAgg?.ragFiredCount ?? 0;

  return c.json({
    totalConversations: totalConversations ?? 0,
    avgQualityScore: ratedMessages > 0 ? Math.round((thumbsUp / ratedMessages) * 100) : 0,
    ragHitRate: totalMetrics > 0 ? Math.round((ragFiredCount / totalMetrics) * 100) : 0,
    avgResponseTimeMs: metricsAgg?.avgResponseTimeMs ?? 0,
    totalTokens: metricsAgg?.totalTokens ?? 0,
    totalCost: ((metricsAgg?.totalCostCents ?? 0) / 100),
    ratedMessages,
    thumbsUp,
    thumbsDown,
  });
});

// GET /evals/messages?rating=up|down&limit=20&offset=0
evalsRoutes.get('/messages', async (c) => {
  const requestContext = c.get('requestContext') as any;
  const tenantId = requestContext?.tenant?.id;
  const permissions = requestContext?.permissions ?? [];

  if (!hasPermission(permissions, 'analytics', 'read')) {
    return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
  }

  const ratingFilter = c.req.query('rating') as 'up' | 'down' | undefined;
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);

  const conditions = [eq(conversationFeedback.tenantId, tenantId)];
  if (ratingFilter === 'up' || ratingFilter === 'down') {
    conditions.push(eq(conversationFeedback.rating, ratingFilter));
  }

  const rows = await db
    .select({
      messageId: messages.id,
      conversationId: messages.conversationId,
      content: messages.content,
      rating: conversationFeedback.rating,
      comment: conversationFeedback.comment,
      feedbackAt: conversationFeedback.createdAt,
    })
    .from(conversationFeedback)
    .innerJoin(messages, eq(messages.id, conversationFeedback.messageId))
    .where(and(...conditions))
    .orderBy(desc(conversationFeedback.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({ data: rows });
});

// GET /evals/conversations?limit=20&offset=0
evalsRoutes.get('/conversations', async (c) => {
  const requestContext = c.get('requestContext') as any;
  const tenantId = requestContext?.tenant?.id;
  const permissions = requestContext?.permissions ?? [];

  if (!hasPermission(permissions, 'analytics', 'read')) {
    return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
  }

  const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);

  const rows = await db
    .select()
    .from(conversationMetrics)
    .where(eq(conversationMetrics.tenantId, tenantId))
    .orderBy(desc(conversationMetrics.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({ data: rows });
});
