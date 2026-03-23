import { Hono } from 'hono';
import { and, eq, asc, desc } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@serverless-saas/database';
import { conversations, messages, agentSkills, agentPolicies } from '@serverless-saas/database/schema/conversations';
import { agents } from '@serverless-saas/database/schema/auth';
import { usageRecords } from '@serverless-saas/database/schema/billing';
import { vertexAdapter } from '@serverless-saas/ai';
import type { AgentMessage, AgentRunRequest } from '@serverless-saas/ai';
import type { AppEnv } from '../types';

export const messagesRoutes = new Hono<AppEnv>();

// Verify conversation belongs to tenant and return full row
async function resolveConversation(conversationId: string, tenantId: string) {
    const [conversation] = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)))
        .limit(1);
    return conversation ?? null;
}

// GET /conversations/:conversationId/messages — list messages for conversation
messagesRoutes.get('/:conversationId/messages', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!permissions.includes('conversations:read')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const conversationId = c.req.param('conversationId');

    if (!await resolveConversation(conversationId, tenantId)) {
        return c.json({ error: 'Conversation not found', code: 'NOT_FOUND' }, 404);
    }

    const data = await db
        .select()
        .from(messages)
        .where(and(
            eq(messages.conversationId, conversationId),
            eq(messages.tenantId, tenantId),
        ))
        .orderBy(asc(messages.createdAt));

    return c.json({ data });
});

// POST /conversations/:conversationId/messages — relay user message to AI and return assistant response
messagesRoutes.post('/:conversationId/messages', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];

    if (!permissions.includes('conversations:create')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    const conversationId = c.req.param('conversationId');

    // Step 1: Validate request
    const schema = z.object({
        content: z.string().min(1),
    });

    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
        return c.json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: result.error.flatten() }, 400);
    }

    // Step 2: Resolve conversation
    const conversation = await resolveConversation(conversationId, tenantId);
    if (!conversation) {
        return c.json({ error: 'Conversation not found', code: 'NOT_FOUND' }, 404);
    }

    const { agentId } = conversation;

    // Step 3: Save user message
    await db.insert(messages).values({
        conversationId,
        tenantId,
        role: 'user',
        content: result.data.content,
    });

    // Step 4: Load agent
    const [agent] = await db
        .select()
        .from(agents)
        .where(eq(agents.id, agentId))
        .limit(1);

    if (!agent) {
        return c.json({ error: 'Agent not found', code: 'NOT_FOUND' }, 404);
    }

    // Step 5: Load active skill — latest version
    const [skill] = await db
        .select()
        .from(agentSkills)
        .where(and(
            eq(agentSkills.agentId, agentId),
            eq(agentSkills.tenantId, tenantId),
            eq(agentSkills.status, 'active'),
        ))
        .orderBy(desc(agentSkills.version))
        .limit(1);

    if (!skill) {
        return c.json({ error: 'No active skill configured for this agent', code: 'NO_ACTIVE_SKILL' }, 400);
    }

    // Step 6: Load policy (optional)
    const [policy] = await db
        .select()
        .from(agentPolicies)
        .where(and(
            eq(agentPolicies.agentId, agentId),
            eq(agentPolicies.tenantId, tenantId),
        ))
        .limit(1);

    // Step 7: Load full message history for this conversation
    const history: (typeof messages.$inferSelect)[] = await db
        .select()
        .from(messages)
        .where(and(
            eq(messages.conversationId, conversationId),
            eq(messages.tenantId, tenantId),
        ))
        .orderBy(asc(messages.createdAt));

    const agentMessages: AgentMessage[] = history.map((m) => ({
        role: m.role,
        content: m.content,
        toolCalls: (m.toolCalls as AgentMessage['toolCalls']) ?? undefined,
        toolResults: (m.toolResults as AgentMessage['toolResults']) ?? undefined,
    }));

    // Step 8: Build AgentRunRequest
    const skillConfig = (skill.config ?? {}) as Record<string, unknown>;
    const request: AgentRunRequest = {
        conversationId,
        tenantId,
        agentId,
        messages: agentMessages,
        skill: {
            name: skill.name,
            systemPrompt: skill.systemPrompt,
            tools: skill.tools,
            config: {
                ...skillConfig,
                temperature: skillConfig.temperature as number | undefined,
                maxTokens: skillConfig.maxTokens as number | undefined,
                topP: skillConfig.topP as number | undefined,
            },
        },
        policy: {
            allowedActions: policy?.allowedActions ?? [],
            blockedActions: policy?.blockedActions ?? [],
            requiresApproval: policy?.requiresApproval ?? [],
            maxTokensPerMessage: policy?.maxTokensPerMessage ?? undefined,
            maxMessagesPerConversation: policy?.maxMessagesPerConversation ?? undefined,
        },
    };

    // Step 9: Call adapter
    let adapterResponse;
    try {
        adapterResponse = await vertexAdapter.run(request);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'AI adapter error';
        console.error('Vertex adapter error:', err);
        return c.json({ error: msg, code: 'ADAPTER_ERROR' }, 500);
    }

    // Step 10: Save assistant response
    const [assistantMessage] = await db.insert(messages).values({
        conversationId,
        tenantId,
        role: 'assistant',
        content: adapterResponse.message.content,
        toolCalls: adapterResponse.message.toolCalls ?? null,
        tokenCount: adapterResponse.tokenCount.total,
        model: adapterResponse.model,
    }).returning();

    // Step 11: Meter usage
    await db.insert(usageRecords).values({
        tenantId,
        actorId: agentId,
        actorType: 'agent',
        metric: 'llm_tokens',
        quantity: String(adapterResponse.tokenCount.total),
    });

    // Step 12: Escalate conversation if adapter signals human handoff
    if (adapterResponse.needsHuman) {
        await db.update(conversations)
            .set({ needsHuman: true })
            .where(eq(conversations.id, conversationId));
    }

    // Step 13: Return assistant message
    return c.json({ data: assistantMessage }, 201);
});
