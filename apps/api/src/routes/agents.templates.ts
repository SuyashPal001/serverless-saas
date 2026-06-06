import { and, count, eq } from 'drizzle-orm';
import { createHash, randomBytes } from 'crypto';
import { z } from 'zod';
import { db } from '@serverless-saas/database';
import { agents, agentTemplates } from '@serverless-saas/database/schema/agents';
import { agentSkills } from '@serverless-saas/database/schema/conversations';
import { apiKeys } from '@serverless-saas/database/schema/access';
import { memberships } from '@serverless-saas/database/schema/tenancy';
import { roles } from '@serverless-saas/database/schema/authorization';
import { auditLog } from '@serverless-saas/database/schema/audit';
import { features } from '@serverless-saas/database/schema/entitlements';
import { hasPermission } from '@serverless-saas/permissions';
import type { Context } from 'hono';
import type { AppEnv } from '../types';

const generateApiKey = (prefix: 'sk' | 'ak'): string => `${prefix}_${randomBytes(32).toString('hex')}`;
const hashKey = (rawKey: string): string => createHash('sha256').update(rawKey).digest('hex');

// GET /agents/templates — list published platform agent templates
export async function handleListAgentTemplates(c: Context<AppEnv>) {
    const permissions = c.get('requestContext' as any)?.permissions ?? [];
    if (!hasPermission(permissions, 'agents', 'read')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const templates = await db
        .select({ id: agentTemplates.id, name: agentTemplates.name, description: agentTemplates.description, model: agentTemplates.model })
        .from(agentTemplates)
        .where(eq(agentTemplates.status, 'published'))
        .orderBy(agentTemplates.version);

    return c.json({ data: templates });
}

// POST /agents/from-template — activate an agent from a published template
export async function handleCreateAgentFromTemplate(c: Context<AppEnv>) {
    const requestContext = c.get('requestContext' as any);
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];
    const userId = c.get('userId' as any) as string;

    if (!hasPermission(permissions, 'agents', 'create')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const entitlements = requestContext?.entitlements as Record<string, { valueLimit?: number; unlimited?: boolean }> | undefined;
    if (entitlements) {
        const [agentFeature] = await db.select({ id: features.id }).from(features).where(eq(features.key, 'agents')).limit(1);
        if (agentFeature) {
            const agentEntitlement = entitlements[agentFeature.id];
            if (agentEntitlement && !agentEntitlement.unlimited) {
                const [{ value: used }] = await db.select({ value: count() }).from(agents).where(and(eq(agents.tenantId, tenantId), eq(agents.status, 'active')));
                const limit = agentEntitlement.valueLimit ?? 0;
                if (Number(used) >= limit) return c.json({ error: 'Agent limit reached for your plan', code: 'AGENT_LIMIT_REACHED' }, 403);
            }
        }
    }

    const result = z.object({ templateId: z.string().uuid() }).safeParse(await c.req.json());
    if (!result.success) return c.json({ error: result.error.errors[0].message }, 400);

    const [template] = await db.select().from(agentTemplates).where(and(eq(agentTemplates.id, result.data.templateId), eq(agentTemplates.status, 'published'))).limit(1);
    if (!template) return c.json({ error: 'Template not found or not published' }, 404);

    const agentRole = (await db.select().from(roles).where(eq(roles.isAgentRole, true)).limit(1))[0];
    if (!agentRole) return c.json({ error: 'Agent role not configured', code: 'AGENT_ROLE_MISSING' }, 500);

    const rawKey = generateApiKey('ak');
    const [newKey] = await db.insert(apiKeys).values({ tenantId, name: `${template.name} API Key`, type: 'agent', keyHash: hashKey(rawKey), permissions: [], status: 'active', createdBy: userId }).returning();
    const [newAgent] = await db.insert(agents).values({ tenantId, name: template.name, type: 'custom', model: template.model, apiKeyId: newKey.id, status: 'active', createdBy: userId }).returning();

    await db.insert(agentSkills).values({ agentId: newAgent.id, tenantId, name: 'default', systemPrompt: template.systemPrompt, tools: template.tools ?? [], status: 'active' });
    await db.insert(memberships).values({ agentId: newAgent.id, tenantId, roleId: agentRole.id, memberType: 'agent', status: 'active' });

    try {
        await db.insert(auditLog).values({ tenantId, actorId: userId, actorType: 'human', action: 'agent_created', resource: 'agent', resourceId: newAgent.id, metadata: { templateId: template.id }, traceId: c.get('traceId' as any) ?? '' });
    } catch (err) { console.error('Audit log write failed:', err); }

    return c.json({ data: { agent: newAgent } }, 201);
}
