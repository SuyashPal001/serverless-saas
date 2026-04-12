import { Hono } from 'hono';
import { and, eq, count } from 'drizzle-orm';
import { createHash, randomBytes } from 'crypto';
import { z } from 'zod';
import { db } from '@serverless-saas/database';
import { agents } from '@serverless-saas/database/schema/agents';
import { users } from '@serverless-saas/database/schema/auth';
import { apiKeys } from '@serverless-saas/database/schema/access';
import { memberships } from '@serverless-saas/database/schema/tenancy';
import { roles } from '@serverless-saas/database/schema/authorization';
import { auditLog } from '@serverless-saas/database/schema/audit';
import { features } from '@serverless-saas/database/schema/entitlements';
import { llmProviders } from '@serverless-saas/database/schema/integrations';
import { hasPermission } from '@serverless-saas/permissions';
import type { AppEnv } from '../types';

export const agentsRoutes = new Hono<AppEnv>();

// Generates a prefixed API key — ak_ for agents, sk_ for developer keys
const generateApiKey = (prefix: 'sk' | 'ak'): string => {
    const random = randomBytes(32).toString('hex');
    return `${prefix}_${random}`;
};

// SHA-256 hash of raw key — only the hash is stored, raw key shown once at creation
const hashKey = (rawKey: string): string => {
    return createHash('sha256').update(rawKey).digest('hex');
};

// GET /agents — list all agents for the current tenant
agentsRoutes.get('/', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!hasPermission(permissions, 'agents', 'read')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const data = await db.select().from(agents).where(and(
        eq(agents.tenantId, tenantId),
    ));

    return c.json({ data });
});

// GET /agents/:id — fetch single agent with resolved llm_provider
agentsRoutes.get('/:id', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!hasPermission(permissions, 'agents', 'read')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const agentId = c.req.param('id');

    const agent = (await db.select().from(agents).where(and(
        eq(agents.id, agentId),
        eq(agents.tenantId, tenantId),
    )).limit(1))[0];

    if (!agent) {
        return c.json({ error: 'Agent not found' }, 404);
    }

    const creator = agent.createdBy
        ? (await db.select({ name: users.name }).from(users)
            .where(eq(users.id, agent.createdBy)).limit(1))[0]
        : null;

    let llmProvider = null;
    if (agent.llmProviderId) {
        const row = (await db
            .select({
                id: llmProviders.id,
                displayName: llmProviders.displayName,
                provider: llmProviders.provider,
                model: llmProviders.model,
                status: llmProviders.status,
            })
            .from(llmProviders)
            .where(eq(llmProviders.id, agent.llmProviderId))
            .limit(1))[0];

        if (row) {
            llmProvider = { ...row, displayName: row.displayName ?? row.model };
        }
    }

    return c.json({ ...agent, llmProvider, createdByName: creator?.name ?? null });
});

// POST /agents — create agent + api key + membership
// Three sequential inserts — Neon HTTP driver does not support transactions
// If a later insert fails, earlier inserts will persist (orphaned records)
// Acceptable at this stage — add cleanup/compensation logic when needed
agentsRoutes.post('/', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];
    const userId = c.get('userId') as string;

    if (!hasPermission(permissions, 'agents', 'create')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    console.log('ENTITLEMENT_DEBUG', JSON.stringify({
        hasEntitlements: !!requestContext?.entitlements,
        entitlementsKeys: requestContext?.entitlements ? Object.keys(requestContext.entitlements) : [],
        tenantId,
    }));

    // Entitlement check — entitlements are keyed by featureId UUID, not feature key string
    const entitlements = requestContext?.entitlements as Record<string, { valueLimit?: number; unlimited?: boolean }> | undefined;

    if (entitlements) {
        const [agentFeature] = await db
            .select({ id: features.id })
            .from(features)
            .where(eq(features.key, 'agents'))
            .limit(1);

        if (agentFeature) {
            const agentEntitlement = entitlements[agentFeature.id];

            if (agentEntitlement && !agentEntitlement.unlimited) {
                const [{ value: used }] = await db
                    .select({ value: count() })
                    .from(agents)
                    .where(and(eq(agents.tenantId, tenantId), eq(agents.status, 'active')));

                const limit = agentEntitlement.valueLimit ?? 0;

                if (Number(used) >= limit) {
                    return c.json({
                        error: 'Agent limit reached for your plan',
                        code: 'AGENT_LIMIT_REACHED',
                        used: Number(used),
                        limit,
                    }, 403);
                }
            }
        }
    }

    const schema = z.object({
        name: z.string().min(1).max(100),
        type: z.enum(['ops', 'support', 'billing', 'custom']),
        model: z.string().optional(),
        llmProviderId: z.string().uuid().optional(),
    });

    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
        return c.json({ error: result.error.errors[0].message }, 400);
    }

    // Agent role must be seeded — isAgentRole: true, minimum permissions
    const agentRole = (await db.select().from(roles).where(eq(roles.isAgentRole, true)).limit(1))[0];

    if (!agentRole) {
        return c.json({ error: 'Agent role not configured', code: 'AGENT_ROLE_MISSING' }, 500);
    }

    const rawKey = generateApiKey('ak');
    const keyHash = hashKey(rawKey);

    // Step 1 — create the API key record (hash only, raw key returned to caller once)
    const [newKey] = await db.insert(apiKeys).values({
        tenantId,
        name: `${result.data.name} API Key`,
        type: 'agent',
        keyHash,
        permissions: [],
        status: 'active',
        createdBy: userId,
    }).returning();

    // Step 2 — create the agent, linked to its API key
    const [newAgent] = await db.insert(agents).values({
        tenantId,
        name: result.data.name,
        type: result.data.type,
        model: result.data.model,
        llmProviderId: result.data.llmProviderId,
        apiKeyId: newKey.id,
        createdBy: userId,
    }).returning();

    // Step 3 — create membership so agent participates in RBAC like a human member
    await db.insert(memberships).values({
        agentId: newAgent.id,
        tenantId,
        roleId: agentRole.id,
        memberType: 'agent',
        status: 'active',
    });

    try {
        await db.insert(auditLog).values({
            tenantId,
            actorId: userId ?? 'system',
            actorType: 'human',
            action: 'agent_created',
            resource: 'agent',
            resourceId: newAgent.id,
            metadata: { type: result.data.type },
            traceId: c.get('traceId') ?? '',
        });
    } catch (auditErr) {
        console.error('Audit log write failed:', auditErr);
    }

    // Return raw key once — caller must store it, it cannot be recovered after this response
    return c.json({ data: { agent: newAgent, apiKey: rawKey } }, 201);
});

// PATCH /agents/:id — update agent name, model, or status
// Status transitions: active → paused, paused → active, active/paused → retired
agentsRoutes.patch('/:id', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!hasPermission(permissions, 'agents', 'update')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const agentId = c.req.param('id');

    // Verify agent belongs to this tenant before updating
    const existing = (await db.select().from(agents).where(and(
        eq(agents.id, agentId),
        eq(agents.tenantId, tenantId)
    )).limit(1))[0];

    if (!existing) {
        return c.json({ error: 'Agent not found' }, 404);
    }

    const schema = z.object({
        name: z.string().min(1).max(100).optional(),
        status: z.enum(['active', 'paused', 'retired']).optional(),
        model: z.string().optional(),
        llmProviderId: z.string().uuid().optional(),
    });

    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
        return c.json({ error: result.error.errors[0].message }, 400);
    }

    const [updated] = await db.update(agents)
        .set({ ...result.data, updatedAt: new Date() })
        .where(and(eq(agents.id, agentId), eq(agents.tenantId, tenantId)))
        .returning();

    if (result.data.status) {
        const action = result.data.status === 'paused' ? 'agent_paused'
            : result.data.status === 'active' ? 'agent_reactivated'
            : 'agent_retired';
        try {
            await db.insert(auditLog).values({
                tenantId,
                actorId: c.get('userId') ?? 'system',
                actorType: 'human',
                action,
                resource: 'agent',
                resourceId: updated.id,
                metadata: {},
                traceId: c.get('traceId') ?? '',
            });
        } catch (auditErr) {
            console.error('Audit log write failed:', auditErr);
        }
    }

    return c.json({ data: { agent: updated } });
});

// DELETE /agents/:id — retire agent and revoke its API key
// Uses soft status update, not hard delete — per ADR-009
agentsRoutes.delete('/:id', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!hasPermission(permissions, 'agents', 'delete')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const agentId = c.req.param('id');

    const existing = (await db.select().from(agents).where(and(
        eq(agents.id, agentId),
        eq(agents.tenantId, tenantId)
    )).limit(1))[0];

    if (!existing) {
        return c.json({ error: 'Agent not found' }, 404);
    }

    // Retire the agent
    await db.update(agents)
        .set({ status: 'retired', updatedAt: new Date() })
        .where(and(eq(agents.id, agentId), eq(agents.tenantId, tenantId)));

    // Revoke the associated API key — immediate effect, no cache invalidation needed
    if (existing.apiKeyId) {
        await db.update(apiKeys)
            .set({ status: 'revoked', revokedAt: new Date() })
            .where(eq(apiKeys.id, existing.apiKeyId));
    }

    return c.json({ success: true });
});