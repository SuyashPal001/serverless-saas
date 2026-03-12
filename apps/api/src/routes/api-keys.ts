import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { createHash, randomBytes } from 'crypto';
import { z } from 'zod';
import { db } from '@serverless-saas/database';
import { apiKeys } from '@serverless-saas/database/schema/access';
import type { AppEnv } from '../types';

export const apiKeysRoutes = new Hono<AppEnv>();

const generateApiKey = (prefix: 'sk' | 'ak'): string => {
    const random = randomBytes(32).toString('hex');
    return `${prefix}_${random}`;
};

const hashKey = (rawKey: string): string => {
    return createHash('sha256').update(rawKey).digest('hex');
};

// GET /api-keys — list all keys for tenant (metadata only, no raw key)
apiKeysRoutes.get('/', async (c) => {
    const tenantId = c.get('tenantId');
    const requestContext = c.get('requestContext') as any;
    const permissions = requestContext?.permissions ?? [];

    if (!permissions.includes('api_keys:read')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const data = await db.query.apiKeys.findMany({
        where: and(
            eq(apiKeys.tenantId, tenantId),
            eq(apiKeys.status, 'active')
        ),
        columns: {
            id: true,
            name: true,
            type: true,
            status: true,
            permissions: true,
            lastUsedAt: true,
            expiresAt: true,
            createdAt: true,
        },
    });

    return c.json({ data });
});

// POST /api-keys — create new key, return raw key ONCE
apiKeysRoutes.post('/', async (c) => {
    const tenantId = c.get('tenantId');
    const requestContext = c.get('requestContext') as any;
    const permissions = requestContext?.permissions ?? [];
    const userId = c.get('userId') as string;

    if (!permissions.includes('api_keys:create')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const schema = z.object({
        name: z.string().min(1).max(100),
        type: z.enum(['rest', 'mcp']),
        permissions: z.array(z.string()).min(1),
        expiresAt: z.string().datetime().optional(),
    });

    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
        return c.json({ error: result.error.errors[0].message }, 400);
    }

    const rawKey = generateApiKey('sk');
    const keyHash = hashKey(rawKey);

    const [created] = await db.insert(apiKeys).values({
        tenantId,
        name: result.data.name,
        type: result.data.type,
        keyHash,
        permissions: result.data.permissions,
        status: 'active',
        createdBy: userId,
        expiresAt: result.data.expiresAt ? new Date(result.data.expiresAt) : null,
    }).returning({
        id: apiKeys.id,
        name: apiKeys.name,
        type: apiKeys.type,
        permissions: apiKeys.permissions,
        expiresAt: apiKeys.expiresAt,
        createdAt: apiKeys.createdAt,
    });

    // rawKey returned ONCE here — never stored, never returned again
    return c.json({ data: { ...created, key: rawKey } }, 201);
});

// DELETE /api-keys/:id — revoke a key
apiKeysRoutes.delete('/:id', async (c) => {
    const tenantId = c.get('tenantId');
    const requestContext = c.get('requestContext') as any;
    const permissions = requestContext?.permissions ?? [];
    const userId = c.get('userId') as string;

    if (!permissions.includes('api_keys:delete')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const keyId = c.req.param('id');

    const existing = await db.query.apiKeys.findFirst({
        where: and(
            eq(apiKeys.id, keyId),
            eq(apiKeys.tenantId, tenantId)
        ),
    });

    if (!existing) {
        return c.json({ error: 'API key not found' }, 404);
    }

    await db.update(apiKeys)
        .set({ status: 'revoked', revokedAt: new Date(), revokedBy: userId })
        .where(eq(apiKeys.id, keyId));

    return c.json({ success: true });
});