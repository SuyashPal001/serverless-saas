import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '@serverless-saas/database';
import { integrations } from '@serverless-saas/database/schema';
import { auditLog } from '@serverless-saas/database/schema';
import type { AppEnv } from '../types';

export const integrationsRoutes = new Hono<AppEnv>();

// DB column mapping:
//   integrations.mcpServerUrl  ← stores the human-readable "name" field
//   integrations.credentialsEnc ← stores config JSON string (not encrypted in dev)

function toApiShape(row: typeof integrations.$inferSelect) {
    let config: Record<string, unknown> = {};
    try { config = JSON.parse(row.credentialsEnc); } catch { /* ignore */ }
    return {
        id:         row.id,
        tenantId:   row.tenantId,
        provider:   row.provider,
        name:       row.mcpServerUrl,   // repurposed column — stores display name
        config,                         // repurposed column — stores raw config JSON
        status:     row.status,
        createdAt:  row.createdAt,
        updatedAt:  row.updatedAt,
    };
}

// GET /integrations
integrationsRoutes.get('/', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!permissions.includes('integrations:read')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const rows = await db
        .select()
        .from(integrations)
        .where(eq(integrations.tenantId, tenantId))
        .orderBy(desc(integrations.createdAt));

    return c.json({ data: rows.map(toApiShape) });
});

// POST /integrations
integrationsRoutes.post(
    '/',
    zValidator('json', z.object({
        name:     z.string().min(2).max(60),
        provider: z.string().min(1),
        config:   z.record(z.unknown()).optional(),
    })),
    async (c) => {
        const requestContext = c.get('requestContext') as any;
        const tenantId = requestContext?.tenant?.id;
        const userId   = c.get('userId') as string;
        const permissions = requestContext?.permissions ?? [];

        if (!permissions.includes('integrations:create')) {
            return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
        }

        const { name, provider, config = {} } = c.req.valid('json');

        const [created] = await db
            .insert(integrations)
            .values({
                tenantId,
                provider,
                mcpServerUrl:   name,                        // display name stored here
                credentialsEnc: JSON.stringify(config),      // config JSON stored here
                status:         'active',
                permissions:    [],
                createdBy:      userId,
            })
            .returning();

        await db.insert(auditLog).values({
            tenantId,
            actorId:    userId,
            actorType:  'human',
            action:     'integration_created',
            resource:   'integration',
            resourceId: created.id,
            metadata:   { provider, name },
            traceId:    c.get('traceId') ?? '',
        }).catch((err: Error) => console.error('Audit log write failed:', err));

        return c.json({ data: toApiShape(created) }, 201);
    }
);

// PATCH /integrations/:id — update name, config, or status
integrationsRoutes.patch(
    '/:id',
    zValidator('json', z.object({
        name:   z.string().min(2).max(60).optional(),
        config: z.record(z.unknown()).optional(),
        status: z.enum(['active', 'disconnected', 'error']).optional(),
    })),
    async (c) => {
        const requestContext = c.get('requestContext') as any;
        const tenantId = requestContext?.tenant?.id;
        const userId   = c.get('userId') as string;
        const permissions = requestContext?.permissions ?? [];
        const id = c.req.param('id');

        if (!permissions.includes('integrations:update')) {
            return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
        }

        const body = c.req.valid('json');
        if (Object.keys(body).length === 0) {
            return c.json({ error: 'No fields provided for update', code: 'VALIDATION_ERROR' }, 400);
        }

        const [existing] = await db
            .select()
            .from(integrations)
            .where(and(eq(integrations.id, id), eq(integrations.tenantId, tenantId)))
            .limit(1);

        if (!existing) {
            return c.json({ error: 'Integration not found', code: 'NOT_FOUND' }, 404);
        }

        const patch: Partial<typeof integrations.$inferInsert> = {
            updatedAt: new Date(),
        };
        if (body.name   !== undefined) patch.mcpServerUrl   = body.name;
        if (body.config !== undefined) patch.credentialsEnc = JSON.stringify(body.config);
        if (body.status !== undefined) patch.status         = body.status;

        const [updated] = await db
            .update(integrations)
            .set(patch)
            .where(eq(integrations.id, id))
            .returning();

        await db.insert(auditLog).values({
            tenantId,
            actorId:    userId,
            actorType:  'human',
            action:     'integration_updated',
            resource:   'integration',
            resourceId: id,
            metadata:   { updates: Object.keys(body) },
            traceId:    c.get('traceId') ?? '',
        }).catch((err: Error) => console.error('Audit log write failed:', err));

        return c.json({ data: toApiShape(updated) });
    }
);

// DELETE /integrations/:id
integrationsRoutes.delete('/:id', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const userId   = c.get('userId') as string;
    const permissions = requestContext?.permissions ?? [];
    const id = c.req.param('id');

    if (!permissions.includes('integrations:delete')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const [existing] = await db
        .select()
        .from(integrations)
        .where(and(eq(integrations.id, id), eq(integrations.tenantId, tenantId)))
        .limit(1);

    if (!existing) {
        return c.json({ error: 'Integration not found', code: 'NOT_FOUND' }, 404);
    }

    await db.delete(integrations).where(eq(integrations.id, id));

    await db.insert(auditLog).values({
        tenantId,
        actorId:    userId,
        actorType:  'human',
        action:     'integration_deleted',
        resource:   'integration',
        resourceId: id,
        metadata:   { provider: existing.provider },
        traceId:    c.get('traceId') ?? '',
    }).catch((err: Error) => console.error('Audit log write failed:', err));

    return c.json({ success: true });
});
