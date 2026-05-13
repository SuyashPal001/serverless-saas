import { and, eq, desc, countDistinct } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@serverless-saas/database';
import { agents } from '@serverless-saas/database/schema';
import { llmProviders } from '@serverless-saas/database/schema/integrations';
import { isPlatformAdmin } from './ops.guard';
import type { Context } from 'hono';
import type { AppEnv } from '../types';

// GET /ops/providers
export async function handleListProviders(c: Context<AppEnv>) {
    if (!isPlatformAdmin(c)) return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);

    const rows = await db
        .select({
            id: llmProviders.id, provider: llmProviders.provider, model: llmProviders.model,
            displayName: llmProviders.displayName, openclawModelId: llmProviders.openclawModelId,
            isDefault: llmProviders.isDefault, status: llmProviders.status, createdAt: llmProviders.createdAt,
        })
        .from(llmProviders)
        .where(eq(llmProviders.isPlatform, true))
        .orderBy(desc(llmProviders.isDefault), desc(llmProviders.createdAt));

    const usageCounts = await db
        .select({ llmProviderId: agents.llmProviderId, tenantCount: countDistinct(agents.tenantId) })
        .from(agents)
        .groupBy(agents.llmProviderId);

    const usageMap = Object.fromEntries(usageCounts.map((r: typeof usageCounts[number]) => [r.llmProviderId, r.tenantCount]));

    return c.json({
        providers: rows.map((r: typeof rows[number]) => ({
            ...r, displayName: r.displayName ?? r.model, tenantsUsing: usageMap[r.id] ?? 0,
        })),
    });
}

// POST /ops/providers
export async function handleCreateProvider(c: Context<AppEnv>) {
    if (!isPlatformAdmin(c)) return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);

    const schema = z.object({
        provider: z.enum(['openai', 'anthropic', 'mistral', 'openrouter', 'kimi', 'vertex']),
        model: z.string().min(1), displayName: z.string().optional(),
        openclawModelId: z.string().optional(), apiKey: z.string().min(1),
        isDefault: z.boolean().optional().default(false),
    });

    const result = schema.safeParse(await c.req.json());
    if (!result.success) return c.json({ error: result.error.errors[0].message }, 400);

    const { apiKey, ...rest } = result.data;
    const [created] = await db.insert(llmProviders).values({
        ...rest, apiKeyEncrypted: Buffer.from(apiKey).toString('base64'), isPlatform: true, status: 'live',
    }).returning();

    return c.json({ data: created }, 201);
}

// PATCH /ops/providers/:id
export async function handlePatchProvider(c: Context<AppEnv>) {
    if (!isPlatformAdmin(c)) return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);

    const id = c.req.param('id');
    const result = z.object({ status: z.enum(['live', 'coming_soon']) }).safeParse(await c.req.json());
    if (!result.success) return c.json({ error: result.error.errors[0].message }, 400);

    const [updated] = await db.update(llmProviders)
        .set({ status: result.data.status })
        .where(and(eq(llmProviders.id, id), eq(llmProviders.isPlatform, true)))
        .returning();

    if (!updated) return c.json({ error: 'Provider not found' }, 404);
    return c.json({ data: updated });
}
