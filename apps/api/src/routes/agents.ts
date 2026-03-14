import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { createHash, randomBytes } from 'crypto';
import { z } from 'zod';
import { db } from '@serverless-saas/database';
import { agents, apiKeys, memberships, roles, auditLog } from '@serverless-saas/database';
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

    if (!permissions.includes('agents:read')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const data = await db.query.agents.findMany({
        where: and(
            eq(agents.tenantId, tenantId),
        ),
    });

    return c.json({ data });
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

    if (!permissions.includes('agents:create')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
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
    const agentRole = await db.query.roles.findFirst({
        where: eq(roles.isAgentRole, true),
    });

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

    if (!permissions.includes('agents:update')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const agentId = c.req.param('id');

    // Verify agent belongs to this tenant before updating
    const existing = await db.query.agents.findFirst({
        where: and(
            eq(agents.id, agentId),
            eq(agents.tenantId, tenantId)
        ),
    });

    if (!existing) {
        return c.json({ error: 'Agent not found' }, 404);
    }

    const schema = z.object({
        name: z.string().min(1).max(100).optional(),
        status: z.enum(['active', 'paused', 'retired']).optional(),
        model: z.string().optional(),
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

    if (!permissions.includes('agents:delete')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const agentId = c.req.param('id');

    const existing = await db.query.agents.findFirst({
        where: and(
            eq(agents.id, agentId),
            eq(agents.tenantId, tenantId)
        ),
    });

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