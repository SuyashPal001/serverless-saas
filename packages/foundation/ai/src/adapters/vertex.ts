import { generateText, type CoreMessage, type CoreToolMessage } from 'ai';
import { createVertex } from '@ai-sdk/google-vertex';
import type { AgentRuntime } from '../runtime/interface';
import type { AgentRunRequest, AgentRunResponse, AgentMessage } from '../runtime/types';

const DEFAULT_MODEL = 'gemini-2.0-flash';
const DEFAULT_LOCATION = 'us-central1';

/**
 * Build a Vertex AI provider instance.
 * Prefers GCP_SA_KEY (JSON string) — falls back to Application Default Credentials.
 */
function buildProvider() {
    const saKeyRaw = process.env.GCP_SA_KEY;

    if (saKeyRaw) {
        const credentials = JSON.parse(saKeyRaw) as { project_id: string };
        return createVertex({
            project: credentials.project_id,
            location: process.env.GCP_LOCATION ?? DEFAULT_LOCATION,
            googleAuthOptions: { credentials },
        });
    }

    // ADC path — relies on GOOGLE_APPLICATION_CREDENTIALS or gcloud login
    return createVertex({
        project: process.env.GCP_PROJECT_ID,
        location: process.env.GCP_LOCATION ?? DEFAULT_LOCATION,
    });
}

/**
 * Map AgentMessage[] to AI SDK CoreMessage[].
 * System messages are extracted separately and passed as the `system` param.
 * Tool result messages require toolName in the AI SDK — we default to '' since
 * our ToolResult type does not carry toolName (it's an orchestration-layer concern).
 */
function toCoreMesages(messages: AgentMessage[]): CoreMessage[] {
    return messages
        .filter((m) => m.role !== 'system')
        .map((m): CoreMessage => {
            // Assistant message with tool calls
            if (m.role === 'assistant' && m.toolCalls?.length) {
                return {
                    role: 'assistant',
                    content: [
                        ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
                        ...m.toolCalls.map((tc) => ({
                            type: 'tool-call' as const,
                            toolCallId: tc.id,
                            toolName: tc.name,
                            args: tc.arguments,
                        })),
                    ],
                };
            }

            // Tool result message
            if (m.role === 'tool' && m.toolResults?.length) {
                const toolMessage: CoreToolMessage = {
                    role: 'tool',
                    content: m.toolResults.map((tr) => ({
                        type: 'tool-result' as const,
                        toolCallId: tr.toolCallId,
                        toolName: '', // ToolResult type doesn't carry toolName — relay fills this
                        result: tr.result,
                        isError: !!tr.error,
                    })),
                };
                return toolMessage;
            }

            // Plain user or assistant message
            return {
                role: m.role as 'user' | 'assistant',
                content: m.content,
            };
        });
}

/**
 * Map AI SDK finishReason to our union.
 * AI SDK uses 'tool-calls' (hyphen); our type uses 'tool_calls' (underscore).
 */
function mapFinishReason(reason: string): AgentRunResponse['finishReason'] {
    switch (reason) {
        case 'stop': return 'stop';
        case 'length': return 'length';
        case 'tool-calls': return 'tool_calls';
        default: return 'error';
    }
}

export class VertexAdapter implements AgentRuntime {
    getName(): string {
        return 'vertex';
    }

    async isAvailable(): Promise<boolean> {
        try {
            buildProvider();
            return !!(process.env.GCP_SA_KEY || process.env.GCP_PROJECT_ID);
        } catch {
            return false;
        }
    }

    async run(request: AgentRunRequest): Promise<AgentRunResponse> {
        const { skill, policy, messages } = request;

        const vertex = buildProvider();
        const modelId = (skill.config.model as string | undefined) ?? DEFAULT_MODEL;

        // Merge skill systemPrompt with any explicit system messages in the thread
        const systemMessages = messages.filter((m) => m.role === 'system');
        const system = [
            skill.systemPrompt,
            ...systemMessages.map((m) => m.content),
        ].join('\n\n');

        const coreMessages = toCoreMesages(messages);

        const result = await generateText({
            model: vertex(modelId),
            system,
            messages: coreMessages,
            temperature: skill.config.temperature,
            maxTokens: policy.maxTokensPerMessage ?? skill.config.maxTokens,
            topP: skill.config.topP,
        });

        const toolCalls = result.toolCalls?.map((tc) => ({
            id: tc.toolCallId,
            name: tc.toolName,
            arguments: tc.args as Record<string, unknown>,
        }));

        return {
            message: {
                role: 'assistant',
                content: result.text,
                toolCalls: toolCalls?.length ? toolCalls : undefined,
            },
            tokenCount: {
                input: result.usage.promptTokens,
                output: result.usage.completionTokens,
                total: result.usage.totalTokens,
            },
            model: modelId,
            finishReason: mapFinishReason(result.finishReason),
        };
    }
}

export const vertexAdapter = new VertexAdapter();
