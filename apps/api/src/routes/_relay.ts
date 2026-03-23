import { and, eq, asc, desc } from 'drizzle-orm';
import { db } from '@serverless-saas/database';
import { conversations, messages, agentSkills, agentPolicies } from '@serverless-saas/database/schema/conversations';
import { agents } from '@serverless-saas/database/schema/auth';
import { usageRecords } from '@serverless-saas/database/schema/billing';
import { vertexAdapter } from '@serverless-saas/ai';
import type { AgentMessage, AgentRunRequest } from '@serverless-saas/ai';

export class RelayError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly status: 400 | 404 | 500,
    ) {
        super(message);
        this.name = 'RelayError';
    }
}

/**
 * Core AI relay: saves the user message, calls the Vertex adapter, saves the
 * assistant response, meters tokens, and escalates needsHuman if signalled.
 * Throws RelayError on known failure modes; unknown errors propagate as-is.
 */
export async function runMessageRelay(
    conversationId: string,
    tenantId: string,
    agentId: string,
    content: string,
): Promise<typeof messages.$inferSelect> {
    // Save user message first so it is included in the history we send to the model
    await db.insert(messages).values({
        conversationId,
        tenantId,
        role: 'user',
        content,
    });

    // Load agent
    const [agent] = await db
        .select()
        .from(agents)
        .where(eq(agents.id, agentId))
        .limit(1);

    if (!agent) {
        throw new RelayError('Agent not found', 'NOT_FOUND', 404);
    }

    // Load active skill — latest version
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
        throw new RelayError('No active skill configured for this agent', 'NO_ACTIVE_SKILL', 400);
    }

    // Load policy (optional)
    const [policy] = await db
        .select()
        .from(agentPolicies)
        .where(and(
            eq(agentPolicies.agentId, agentId),
            eq(agentPolicies.tenantId, tenantId),
        ))
        .limit(1);

    // Load full message history including the user message just inserted
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

    // Build request
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

    // Call adapter
    let adapterResponse;
    try {
        adapterResponse = await vertexAdapter.run(request);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'AI adapter error';
        console.error('Vertex adapter error:', err);
        throw new RelayError(msg, 'ADAPTER_ERROR', 500);
    }

    // Save assistant response
    const [assistantMessage] = await db.insert(messages).values({
        conversationId,
        tenantId,
        role: 'assistant',
        content: adapterResponse.message.content,
        toolCalls: adapterResponse.message.toolCalls ?? null,
        tokenCount: adapterResponse.tokenCount.total,
        model: adapterResponse.model,
    }).returning();

    // Meter usage
    await db.insert(usageRecords).values({
        tenantId,
        actorId: agentId,
        actorType: 'agent',
        metric: 'llm_tokens',
        quantity: String(adapterResponse.tokenCount.total),
    });

    // Escalate conversation if adapter signals human handoff
    if (adapterResponse.needsHuman) {
        await db.update(conversations)
            .set({ needsHuman: true })
            .where(eq(conversations.id, conversationId));
    }

    return assistantMessage;
}
