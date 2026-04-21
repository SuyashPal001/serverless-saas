import { Hono } from 'hono';
import { and, eq, ilike, desc, count, isNull, gte, lte, countDistinct, avg, sum, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@serverless-saas/database';
import { tenants, memberships, users, agents, conversations, tenantFeatureOverrides, features, roles } from '@serverless-saas/database/schema';
import { auditLog } from '@serverless-saas/database/schema/audit';
import { llmProviders } from '@serverless-saas/database/schema/integrations';
import { conversationMetrics, evalResults, conversationFeedback } from '@serverless-saas/database/schema/conversations';
import type { AppEnv } from '../types';

export const opsRoutes = new Hono<AppEnv>();

// Platform admin guard — applied to every handler in this file
const isPlatformAdmin = (c: any): boolean => {
    const jwtPayload = c.get('jwtPayload') as any;
    return jwtPayload?.['custom:role'] === 'platform_admin';
};

// GET /ops/tenants — list all tenants across platform
opsRoutes.get('/tenants', async (c) => {
    if (!isPlatformAdmin(c)) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const page = parseInt(c.req.query('page') ?? '1');
    const pageSize = parseInt(c.req.query('pageSize') ?? '20');
    const search = c.req.query('search');
    const status = c.req.query('status');

    const conditions = [];
    if (search) conditions.push(ilike(tenants.name, `%${search}%`));
    if (status) conditions.push(eq(tenants.status, status as any));

    const data = await db.select().from(tenants)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(tenants.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

    return c.json({ tenants: data, page, pageSize });
});

// GET /ops/tenants/:id — tenant detail with members, agents, conversation count, overrides
opsRoutes.get('/tenants/:id', async (c) => {
    if (!isPlatformAdmin(c)) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const tenantId = c.req.param('id');

    const tenant = (await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1))[0];
    if (!tenant) {
        return c.json({ error: 'Tenant not found' }, 404);
    }

    // Members with user info and role name
    const memberRows = await db
        .select({
            membershipId: memberships.id,
            memberType: memberships.memberType,
            status: memberships.status,
            joinedAt: memberships.joinedAt,
            createdAt: memberships.createdAt,
            userId: users.id,
            userName: users.name,
            userEmail: users.email,
            roleName: roles.name,
        })
        .from(memberships)
        .leftJoin(users, eq(memberships.userId, users.id))
        .leftJoin(roles, eq(memberships.roleId, roles.id))
        .where(eq(memberships.tenantId, tenantId))
        .orderBy(desc(memberships.createdAt));

    // Active agent count
    const [agentCountRow] = await db
        .select({ value: count() })
        .from(agents)
        .where(and(eq(agents.tenantId, tenantId), eq(agents.status, 'active')));

    // Total conversation count
    const [convCountRow] = await db
        .select({ value: count() })
        .from(conversations)
        .where(eq(conversations.tenantId, tenantId));

    // Feature overrides for this tenant
    const overrideRows = await db
        .select({
            id: tenantFeatureOverrides.id,
            featureKey: features.key,
            featureName: features.name,
            enabled: tenantFeatureOverrides.enabled,
            valueLimit: tenantFeatureOverrides.valueLimit,
            unlimited: tenantFeatureOverrides.unlimited,
            reason: tenantFeatureOverrides.reason,
            grantedBy: tenantFeatureOverrides.grantedBy,
            expiresAt: tenantFeatureOverrides.expiresAt,
            revokedAt: tenantFeatureOverrides.revokedAt,
            createdAt: tenantFeatureOverrides.createdAt,
        })
        .from(tenantFeatureOverrides)
        .innerJoin(features, eq(tenantFeatureOverrides.featureId, features.id))
        .where(and(
            eq(tenantFeatureOverrides.tenantId, tenantId),
            isNull(tenantFeatureOverrides.deletedAt),
        ))
        .orderBy(desc(tenantFeatureOverrides.createdAt));

    const overridesWithStatus = overrideRows.map((o: typeof overrideRows[number]) => ({
        ...o,
        status: o.revokedAt ? 'revoked' : o.expiresAt && new Date(o.expiresAt) < new Date() ? 'expired' : 'active',
    }));

    return c.json({
        tenant,
        members: memberRows,
        stats: {
            memberCount: memberRows.length,
            activeAgents: agentCountRow?.value ?? 0,
            totalConversations: convCountRow?.value ?? 0,
        },
        overrides: overridesWithStatus,
    });
});

// PATCH /ops/tenants/:id — suspend or reactivate a tenant
opsRoutes.patch('/tenants/:id', async (c) => {
    if (!isPlatformAdmin(c)) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const tenantId = c.req.param('id');

    const schema = z.object({
        status: z.enum(['active', 'suspended']),
    });

    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
        return c.json({ error: result.error.errors[0].message }, 400);
    }

    const existing = (await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1))[0];

    if (!existing) {
        return c.json({ error: 'Tenant not found' }, 404);
    }

    const [updated] = await db.update(tenants)
        .set({ status: result.data.status, updatedAt: new Date() })
        .where(eq(tenants.id, tenantId))
        .returning();

    try {
        await db.insert(auditLog).values({
            tenantId,
            actorId: c.get('userId') ?? 'system',
            actorType: 'human',
            action: result.data.status === 'suspended' ? 'tenant_suspended' : 'tenant_reactivated',
            resource: 'tenant',
            resourceId: tenantId,
            metadata: {},
            traceId: c.get('traceId') ?? '',
        });
    } catch (auditErr) {
        console.error('Audit log write failed:', auditErr);
    }

    return c.json({ data: updated });
});

// ── NEW ENDPOINTS ─────────────────────────────────────────────────────────────

// GET /ops/audit — cross-tenant audit log with filters
opsRoutes.get('/audit', async (c) => {
    if (!isPlatformAdmin(c)) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const page      = parseInt(c.req.query('page')     ?? '1');
    const pageSize  = parseInt(c.req.query('pageSize') ?? '50');
    const filterTenant   = c.req.query('tenantId');
    const filterActorType = c.req.query('actorType') as 'human' | 'agent' | 'system' | undefined;
    const from      = c.req.query('from');
    const to        = c.req.query('to');

    const conditions: any[] = [];
    if (filterTenant)    conditions.push(eq(auditLog.tenantId, filterTenant));
    if (filterActorType) conditions.push(eq(auditLog.actorType, filterActorType));
    if (from)            conditions.push(gte(auditLog.createdAt, new Date(from)));
    if (to)              conditions.push(lte(auditLog.createdAt, new Date(to)));

    const rows = await db
        .select({
            id:         auditLog.id,
            tenantId:   auditLog.tenantId,
            tenantName: tenants.name,
            actorId:    auditLog.actorId,
            actorType:  auditLog.actorType,
            action:     auditLog.action,
            resource:   auditLog.resource,
            resourceId: auditLog.resourceId,
            metadata:   auditLog.metadata,
            createdAt:  auditLog.createdAt,
        })
        .from(auditLog)
        .leftJoin(tenants, eq(auditLog.tenantId, tenants.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(auditLog.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

    const [totalRow] = await db
        .select({ value: count() })
        .from(auditLog)
        .where(conditions.length > 0 ? and(...conditions) : undefined);

    return c.json({
        entries: rows,
        total: totalRow?.value ?? 0,
        page,
        totalPages: Math.ceil((totalRow?.value ?? 0) / pageSize),
    });
});

// GET /ops/providers — list platform LLM providers with tenant usage counts
opsRoutes.get('/providers', async (c) => {
    if (!isPlatformAdmin(c)) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const rows = await db
        .select({
            id:              llmProviders.id,
            provider:        llmProviders.provider,
            model:           llmProviders.model,
            displayName:     llmProviders.displayName,
            openclawModelId: llmProviders.openclawModelId,
            isDefault:       llmProviders.isDefault,
            status:          llmProviders.status,
            createdAt:       llmProviders.createdAt,
        })
        .from(llmProviders)
        .where(eq(llmProviders.isPlatform, true))
        .orderBy(desc(llmProviders.isDefault), desc(llmProviders.createdAt));

    const usageCounts = await db
        .select({
            llmProviderId: agents.llmProviderId,
            tenantCount:   countDistinct(agents.tenantId),
        })
        .from(agents)
        .groupBy(agents.llmProviderId);

    const usageMap = Object.fromEntries(
        usageCounts.map((r: typeof usageCounts[number]) => [r.llmProviderId, r.tenantCount])
    );

    return c.json({
        providers: rows.map((r: typeof rows[number]) => ({
            ...r,
            displayName: r.displayName ?? r.model,
            tenantsUsing: usageMap[r.id] ?? 0,
        })),
    });
});

// POST /ops/providers — add a new platform LLM provider
opsRoutes.post('/providers', async (c) => {
    if (!isPlatformAdmin(c)) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const schema = z.object({
        provider:        z.enum(['openai', 'anthropic', 'mistral', 'openrouter', 'kimi', 'vertex']),
        model:           z.string().min(1),
        displayName:     z.string().optional(),
        openclawModelId: z.string().optional(),
        apiKey:          z.string().min(1),
        isDefault:       z.boolean().optional().default(false),
    });

    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
        return c.json({ error: result.error.errors[0].message }, 400);
    }

    const { apiKey, ...rest } = result.data;

    const [created] = await db.insert(llmProviders).values({
        ...rest,
        apiKeyEncrypted: Buffer.from(apiKey).toString('base64'),
        isPlatform: true,
        status: 'live',
    }).returning();

    return c.json({ data: created }, 201);
});

// PATCH /ops/providers/:id — toggle provider status
opsRoutes.patch('/providers/:id', async (c) => {
    if (!isPlatformAdmin(c)) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const id = c.req.param('id');
    const schema = z.object({ status: z.enum(['live', 'coming_soon']) });

    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
        return c.json({ error: result.error.errors[0].message }, 400);
    }

    const [updated] = await db
        .update(llmProviders)
        .set({ status: result.data.status })
        .where(and(eq(llmProviders.id, id), eq(llmProviders.isPlatform, true)))
        .returning();

    if (!updated) return c.json({ error: 'Provider not found' }, 404);
    return c.json({ data: updated });
});

// GET /ops/overrides — list all feature overrides across platform
opsRoutes.get('/overrides', async (c) => {
    if (!isPlatformAdmin(c)) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const page = parseInt(c.req.query('page') ?? '1');
    const pageSize = parseInt(c.req.query('pageSize') ?? '20');

    const data = await db.select().from(tenantFeatureOverrides).where(and(
        eq(tenantFeatureOverrides.deletedAt, null as any),
        eq(tenantFeatureOverrides.revokedAt, null as any),
    )).orderBy(desc(tenantFeatureOverrides.createdAt)).limit(pageSize).offset((page - 1) * pageSize);

    return c.json({ overrides: data, page, pageSize });
});

// POST /ops/overrides — grant a feature override to a tenant
opsRoutes.post('/overrides', async (c) => {
    if (!isPlatformAdmin(c)) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const grantedBy = c.get('requestContext') as any;
    const userId = grantedBy?.user?.id;

    const schema = z.object({
        tenantId: z.string().uuid(),
        featureId: z.string().uuid(),
        enabled: z.boolean().optional(),
        valueLimit: z.number().int().optional(),
        unlimited: z.boolean().optional(),
        reason: z.string().min(1),
        expiresAt: z.string().datetime().optional(),
    });

    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
        return c.json({ error: result.error.errors[0].message }, 400);
    }

    const [override] = await db.insert(tenantFeatureOverrides).values({
        tenantId: result.data.tenantId,
        featureId: result.data.featureId,
        enabled: result.data.enabled,
        valueLimit: result.data.valueLimit,
        unlimited: result.data.unlimited,
        reason: result.data.reason,
        grantedBy: userId,
        expiresAt: result.data.expiresAt ? new Date(result.data.expiresAt) : null,
    }).returning();

    try {
        await db.insert(auditLog).values({
            tenantId: result.data.tenantId,
            actorId: c.get('userId') ?? 'system',
            actorType: 'human',
            action: 'override_granted',
            resource: 'tenant_feature_override',
            resourceId: override.id,
            metadata: { featureId: result.data.featureId, reason: result.data.reason },
            traceId: c.get('traceId') ?? '',
        });
    } catch (auditErr) {
        console.error('Audit log write failed:', auditErr);
    }

    return c.json({ data: override }, 201);
});

// POST /ops/overrides/:id/revoke — revoke a feature override
opsRoutes.post('/overrides/:id/revoke', async (c) => {
    if (!isPlatformAdmin(c)) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const overrideId = c.req.param('id');
    const userId = c.get('userId') as string;

    const existing = (await db.select().from(tenantFeatureOverrides).where(eq(tenantFeatureOverrides.id, overrideId)).limit(1))[0];

    if (!existing) {
        return c.json({ error: 'Override not found' }, 404);
    }

    const [updated] = await db.update(tenantFeatureOverrides)
        .set({ revokedAt: new Date(), revokedBy: userId })
        .where(eq(tenantFeatureOverrides.id, overrideId))
        .returning();

    try {
        await db.insert(auditLog).values({
            tenantId: existing.tenantId,
            actorId: userId ?? 'system',
            actorType: 'human',
            action: 'override_revoked',
            resource: 'tenant_feature_override',
            resourceId: overrideId,
            metadata: {},
            traceId: c.get('traceId') ?? '',
        });
    } catch (auditErr) {
        console.error('Audit log write failed:', auditErr);
    }

    return c.json({ data: updated });
});
// ── AGENT INTELLIGENCE ────────────────────────────────────────────────────────

// GET /ops/agent-intelligence/knowledge-gaps
// Derives "knowledge gaps" from conversations where RAG fired but returned 0 chunks.
opsRoutes.get('/agent-intelligence/knowledge-gaps', async (c) => {
    if (!isPlatformAdmin(c)) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const page     = parseInt(c.req.query('page')     ?? '1');
    const pageSize = parseInt(c.req.query('pageSize') ?? '50');

    try {
        const rows = await db
            .select({
                tenantId:     conversations.tenantId,
                tenantName:   tenants.name,
                questionAsked: conversations.title,
                lastSeen:     sql<string>`MAX(${conversationMetrics.createdAt})`,
                timesAsked:   sql<number>`COUNT(*)`,
            })
            .from(conversationMetrics)
            .innerJoin(conversations, eq(conversationMetrics.conversationId, conversations.id))
            .leftJoin(tenants, eq(conversations.tenantId, tenants.id))
            .where(and(
                eq(conversationMetrics.ragFired, true),
                eq(conversationMetrics.ragChunksRetrieved, 0),
            ))
            .groupBy(conversations.tenantId, tenants.name, conversations.title)
            .orderBy(desc(sql`COUNT(*)`))
            .limit(pageSize)
            .offset((page - 1) * pageSize);

        const [totalRow] = await db
            .select({ value: countDistinct(conversations.title) })
            .from(conversationMetrics)
            .innerJoin(conversations, eq(conversationMetrics.conversationId, conversations.id))
            .where(and(
                eq(conversationMetrics.ragFired, true),
                eq(conversationMetrics.ragChunksRetrieved, 0),
            ));

        return c.json({
            gaps: rows.map((r: typeof rows[number]) => ({ ...r, status: 'open' as const })),
            total: totalRow?.value ?? 0,
            page,
            totalPages: Math.ceil((totalRow?.value ?? 0) / pageSize),
        });
    } catch (err) {
        console.error('[ops/knowledge-gaps]', err);
        return c.json({ gaps: [], total: 0, page, totalPages: 0 });
    }
});

// GET /ops/agent-intelligence/eval-scores
// Average quality scores and feedback rates per tenant.
opsRoutes.get('/agent-intelligence/eval-scores', async (c) => {
    if (!isPlatformAdmin(c)) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    try {
        const scoreRows = await db
            .select({
                tenantId: evalResults.tenantId,
                tenantName: tenants.name,
                avgScore: avg(evalResults.score),
                evalCount: count(),
            })
            .from(evalResults)
            .leftJoin(tenants, eq(evalResults.tenantId, tenants.id))
            .groupBy(evalResults.tenantId, tenants.name)
            .orderBy(desc(avg(evalResults.score)));

        const feedbackRows = await db
            .select({
                tenantId: conversationFeedback.tenantId,
                total: count(),
                thumbsUp: sql<number>`SUM(CASE WHEN ${conversationFeedback.rating} = 'up' THEN 1 ELSE 0 END)`,
            })
            .from(conversationFeedback)
            .groupBy(conversationFeedback.tenantId);

        const ragRows = await db
            .select({
                tenantId: conversations.tenantId,
                total: count(),
                ragHits: sql<number>`SUM(CASE WHEN ${conversationMetrics.ragFired} = true AND ${conversationMetrics.ragChunksRetrieved} > 0 THEN 1 ELSE 0 END)`,
            })
            .from(conversationMetrics)
            .innerJoin(conversations, eq(conversationMetrics.conversationId, conversations.id))
            .groupBy(conversations.tenantId);

        const fbMap = Object.fromEntries(feedbackRows.map((r: typeof feedbackRows[number]) => [r.tenantId, r]));
        const ragMap = Object.fromEntries(ragRows.map((r: typeof ragRows[number]) => [r.tenantId, r]));

        const scores = scoreRows.map((r: typeof scoreRows[number]) => {
            const fb  = fbMap[r.tenantId];
            const rag = ragMap[r.tenantId];
            const thumbsUpPct = fb && fb.total > 0 ? Math.round((Number(fb.thumbsUp) / Number(fb.total)) * 100) : null;
            const ragHitRate  = rag && rag.total > 0 ? Math.round((Number(rag.ragHits) / Number(rag.total)) * 100) : null;
            return {
                tenantId:    r.tenantId,
                tenantName:  r.tenantName ?? '—',
                avgScore:    r.avgScore !== null ? parseFloat(String(r.avgScore)).toFixed(2) : null,
                evalCount:   r.evalCount,
                thumbsUpPct,
                ragHitRate,
            };
        });

        return c.json({ scores });
    } catch (err) {
        console.error('[ops/eval-scores]', err);
        return c.json({ scores: [] });
    }
});

// GET /ops/agent-intelligence/tool-performance
// Tool call stats derived from audit_log entries with resource='tool_call'.
opsRoutes.get('/agent-intelligence/tool-performance', async (c) => {
    if (!isPlatformAdmin(c)) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    try {
        const rows = await db
            .select({
                toolName:    auditLog.action,
                tenantId:    auditLog.tenantId,
                tenantName:  tenants.name,
                callCount:   count(),
                successCount: sql<number>`SUM(CASE WHEN (${auditLog.metadata}->>'success')::boolean = true THEN 1 ELSE 0 END)`,
                avgLatencyMs: sql<number>`AVG((${auditLog.metadata}->>'latencyMs')::numeric)`,
                lastError:   sql<string>`MAX(CASE WHEN (${auditLog.metadata}->>'success')::boolean = false THEN ${auditLog.metadata}->>'error' END)`,
            })
            .from(auditLog)
            .leftJoin(tenants, eq(auditLog.tenantId, tenants.id))
            .where(eq(auditLog.resource, 'tool_call'))
            .groupBy(auditLog.action, auditLog.tenantId, tenants.name)
            .orderBy(desc(count()));

        return c.json({
            tools: rows.map((r: typeof rows[number]) => ({
                toolName:     r.toolName,
                tenantId:     r.tenantId,
                tenantName:   r.tenantName ?? '—',
                callCount:    r.callCount,
                successRate:  r.callCount > 0 ? Math.round((Number(r.successCount) / r.callCount) * 100) : null,
                avgLatencyMs: r.avgLatencyMs !== null ? Math.round(Number(r.avgLatencyMs)) : null,
                lastError:    r.lastError ?? null,
            })),
        });
    } catch (err) {
        console.error('[ops/tool-performance]', err);
        return c.json({ tools: [] });
    }
});

// GET /ops/overview — aggregated stats for the morning dashboard
opsRoutes.get('/overview', async (c) => {
    if (!isPlatformAdmin(c)) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const [[tenantCountRow], [avgScoreRow], [gapCountRow], [costRow]] = await Promise.all([
        db.select({ value: count() }).from(tenants).where(eq(tenants.status, 'active')),
        db.select({ value: avg(evalResults.score) }).from(evalResults).catch(() => [{ value: null }]),
        db.select({ value: countDistinct(conversations.title) })
            .from(conversationMetrics)
            .innerJoin(conversations, eq(conversationMetrics.conversationId, conversations.id))
            .where(and(eq(conversationMetrics.ragFired, true), eq(conversationMetrics.ragChunksRetrieved, 0)))
            .catch(() => [{ value: 0 }]),
        db.select({ value: sum(conversationMetrics.totalCost) })
            .from(conversationMetrics)
            .where(gte(conversationMetrics.createdAt, monthStart))
            .catch(() => [{ value: null }]),
    ]);

    return c.json({
        activeTenants:     tenantCountRow?.value ?? 0,
        avgEvalScore:      avgScoreRow?.value !== null ? parseFloat(String(avgScoreRow?.value ?? 0)).toFixed(2) : null,
        openKnowledgeGaps: gapCountRow?.value ?? 0,
        totalCostThisMonth: costRow?.value !== null ? parseFloat(String(costRow?.value ?? 0)).toFixed(4) : null,
    });
});
