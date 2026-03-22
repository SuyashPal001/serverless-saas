import { Hono } from 'hono';
import { and, eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@serverless-saas/database';
import { integrations } from '@serverless-saas/database/schema/integrations';
import { auditLog } from '@serverless-saas/database/schema/audit';
import type { AppEnv } from '../types';

export const integrationsRoutes = new Hono<AppEnv>();

// GET /integrations/providers — List available providers
// Must be defined before /:id to prevent route shadowing
integrationsRoutes.get('/providers', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const permissions = requestContext?.permissions ?? [];

    if (!permissions.includes('integrations:read')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    // Static list of providers that the system supports
    const providers = [
        { id: 'github', name: 'GitHub', type: 'mcp' },
        { id: 'linear', name: 'Linear', type: 'mcp' },
        { id: 'slack', name: 'Slack', type: 'mcp' },
        { id: 'notion', name: 'Notion', type: 'mcp' },
    ];

    return c.json({ data: providers });
});

// GET /integrations — List tenant's integrations
integrationsRoutes.get('/', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!permissions.includes('integrations:read')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const data = await db
        .select({
            id: integrations.id,
            provider: integrations.provider,
            mcpServerUrl: integrations.mcpServerUrl,
            status: integrations.status,
            permissions: integrations.permissions,
            createdAt: integrations.createdAt,
            updatedAt: integrations.updatedAt,
        })
        .from(integrations)
        .where(eq(integrations.tenantId, tenantId))
        .orderBy(desc(integrations.createdAt));

    return c.json({ data });
});

// GET /integrations/:id — Get single integration
integrationsRoutes.get('/:id', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!permissions.includes('integrations:read')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const id = c.req.param('id');

    const [data] = await db
        .select({
            id: integrations.id,
            provider: integrations.provider,
            mcpServerUrl: integrations.mcpServerUrl,
            status: integrations.status,
            permissions: integrations.permissions,
            createdAt: integrations.createdAt,
            updatedAt: integrations.updatedAt,
        })
        .from(integrations)
        .where(and(
            eq(integrations.id, id),
            eq(integrations.tenantId, tenantId)
        ))
        .limit(1);

    if (!data) {
        return c.json({ error: 'Integration not found', code: 'NOT_FOUND' }, 404);
    }

    return c.json({ data });
});

// POST /integrations — Create/connect integration
integrationsRoutes.post('/', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];
    const userId = c.get('userId') as string;

    if (!permissions.includes('integrations:create')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const schema = z.object({
        provider: z.string().min(1).max(50),
        mcpServerUrl: z.string().url(),
        credentialsEnc: z.string().min(1),
        permissions: z.array(z.string()).optional().default([]),
    });

    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
        return c.json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: result.error.flatten() }, 400);
    }

    try {
        const [created] = await db.insert(integrations).values({
            tenantId,
            provider: result.data.provider,
            mcpServerUrl: result.data.mcpServerUrl,
            credentialsEnc: result.data.credentialsEnc,
            permissions: result.data.permissions,
            status: 'active',
            createdBy: userId,
        }).returning({
            id: integrations.id,
            provider: integrations.provider,
            mcpServerUrl: integrations.mcpServerUrl,
            status: integrations.status,
            permissions: integrations.permissions,
            createdAt: integrations.createdAt,
        });

        await db.insert(auditLog).values({
            tenantId,
            actorId: userId ?? 'system',
            actorType: 'human',
            action: 'integration_connected',
            resource: 'integration',
            resourceId: created.id,
            metadata: { provider: created.provider, mcpServerUrl: created.mcpServerUrl },
            traceId: c.get('traceId') ?? '',
        }).catch((err: Error) => console.error('Audit log write failed:', err));

        return c.json({ data: created }, 201);
    } catch (err: any) {
        console.error('Failed to create integration:', err);
        return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
    }
});

// PATCH /integrations/:id — Update (permissions, status)
integrationsRoutes.patch('/:id', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];
    const userId = c.get('userId') as string;

    if (!permissions.includes('integrations:update')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const id = c.req.param('id');

    const schema = z.object({
        status: z.enum(['active', 'disconnected', 'error']).optional(),
        permissions: z.array(z.string()).optional(),
        mcpServerUrl: z.string().url().optional(),
        credentialsEnc: z.string().min(1).optional(),
    });

    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
        return c.json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: result.error.flatten() }, 400);
    }

    if (Object.keys(result.data).length === 0) {
        return c.json({ error: 'No fields provided for update', code: 'VALIDATION_ERROR' }, 400);
    }

    const [existing] = await db
        .select()
        .from(integrations)
        .where(and(
            eq(integrations.id, id),
            eq(integrations.tenantId, tenantId)
        ))
        .limit(1);

    if (!existing) {
        return c.json({ error: 'Integration not found', code: 'NOT_FOUND' }, 404);
    }

    try {
        const [updated] = await db.update(integrations)
            .set({ ...result.data, updatedAt: new Date() })
            .where(eq(integrations.id, id))
            .returning({
                id: integrations.id,
                provider: integrations.provider,
                mcpServerUrl: integrations.mcpServerUrl,
                status: integrations.status,
                permissions: integrations.permissions,
                updatedAt: integrations.updatedAt,
            });

        await db.insert(auditLog).values({
            tenantId,
            actorId: userId ?? 'system',
            actorType: 'human',
            action: 'integration_updated',
            resource: 'integration',
            resourceId: id,
            metadata: { updates: Object.keys(result.data) },
            traceId: c.get('traceId') ?? '',
        }).catch((err: Error) => console.error('Audit log write failed:', err));

        return c.json({ data: updated });
    } catch (err: any) {
        console.error('Failed to update integration:', err);
        return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
    }
});

// DELETE /integrations/:id — Disconnect/delete
integrationsRoutes.delete('/:id', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];
    const userId = c.get('userId') as string;

    if (!permissions.includes('integrations:delete')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const id = c.req.param('id');

    const [existing] = await db
        .select()
        .from(integrations)
        .where(and(
            eq(integrations.id, id),
            eq(integrations.tenantId, tenantId)
        ))
        .limit(1);

    if (!existing) {
        return c.json({ error: 'Integration not found', code: 'NOT_FOUND' }, 404);
    }

    try {
        await db.delete(integrations)
            .where(eq(integrations.id, id));

        await db.insert(auditLog).values({
            tenantId,
            actorId: userId ?? 'system',
            actorType: 'human',
            action: 'integration_disconnected',
            resource: 'integration',
            resourceId: id,
            metadata: { provider: existing.provider },
            traceId: c.get('traceId') ?? '',
        }).catch((err: Error) => console.error('Audit log write failed:', err));

        return c.json({ success: true });
    } catch (err: any) {
        console.error('Failed to delete integration:', err);
        return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
    }
});
