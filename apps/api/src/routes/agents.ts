import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { createHash, randomBytes } from 'crypto';
import { z } from 'zod';
import { db } from '@serverless-saas/database';
import { agents } from '@serverless-saas/database/schema/auth';
import { apiKeys } from '@serverless-saas/database/schema/access';
import { memberships, roles } from '@serverless-saas/database';
import type { AppEnv } from '../types';

export const agentsRoutes = new Hono<AppEnv>();

const generateApiKey = (prefix: 'sk' | 'ak'): string => {
    const random = randomBytes(32).toString('hex');
    return `${prefix}_${random}`;
};

const hashKey = (rawKey: string): string => {
    return createHash('sha256').update(rawKey).digest('hex');
};

// GET /agents
agentsRoutes.get('/', async (c) => {
    const tenantId = c.get('tenantId');
    const requestContext = c.get('requestContext') as any;
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

// POST /agents — create agent + api key + membership in one transaction
agentsRoutes.post('/', async (c) => {
    const tenantId = c.get('tenantId');
    const requestContext = c.get('requestContext') as any;
    const permissions = requestContext?.permissions ?? [];
    const userId = requestContext?.user?.id;

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

    // Find the agent role for this tenant
    const agentRole = await db.query.roles.findFirst({
        where: and(
            eq(roles.isAgentRole, true),
        ),
    });

    if (!agentRole) {
        return c.json({ error: 'Agent role not configured', code: 'AGENT_ROLE_MISSING' }, 500);
    }

    const rawKey = generateApiKey('ak');
    const keyHash = hashKey(rawKey);

    // Transaction — all three inserts succeed or none do
    const agent = await db.transaction(async (tx: any) => {

        const [newKey] = await tx.insert(apiKeys).values({
            tenantId,
            name: `${result.data.name} API Key`,
            type: 'agent',
            keyHash,
            permissions: [],
            status: 'active',
            createdBy: userId,
        }).returning();

        const [newAgent] = await tx.insert(agents).values({
            tenantId,
            name: result.data.name,
            type: result.data.type,
            model: result.data.model,
            llmProviderId: result.data.llmProviderId,
            apiKeyId: newKey.id,
            createdBy: userId,
        }).returning();

        await tx.insert(memberships).values({
            agentId: newAgent.id,
            tenantId,
            roleId: agentRole.id,
            memberType: 'agent',
            status: 'active',
        });

        return newAgent;
    });

    return c.json({ data: { ...agent, key: rawKey } }, 201);
});

// PATCH /agents/:id
agentsRoutes.patch('/:id', async (c) => {
    const tenantId = c.get('tenantId');
    const requestContext = c.get('requestContext') as any;
    const permissions = requestContext?.permissions ?? [];

    if (!permissions.includes('agents:update')) {
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

    const schema = z.object({
        name: z.string().min(1).max(100).optional(),
        model: z.string().optional(),
    });

    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
        return c.json({ error: result.error.errors[0].message }, 400);
    }

    const [updated] = await db.update(agents)
        .set({ ...result.data, updatedAt: new Date() })
        .where(eq(agents.id, agentId))
        .returning();

    return c.json({ data: updated });
});

// DELETE /agents/:id — retire agent + revoke its api key
agentsRoutes.delete('/:id', async (c) => {
    const tenantId = c.get('tenantId');
    const requestContext = c.get('requestContext') as any;
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

    await db.transaction(async (tx: any) => {
        await tx.update(agents)
            .set({ status: 'retired', updatedAt: new Date() })
            .where(eq(agents.id, agentId));

        await tx.update(apiKeys)
            .set({ status: 'revoked', revokedAt: new Date() })
            .where(eq(apiKeys.id, existing.apiKeyId));
    });

    return c.json({ success: true });
});
