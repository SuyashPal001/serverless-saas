// Core types for agent runtime

export interface AgentMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  result: unknown;
  error?: string;
}

export interface AgentSkillConfig {
  name: string;
  systemPrompt: string;
  tools: string[];
  config: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    [key: string]: unknown;
  };
}

export interface AgentPolicyConfig {
  allowedActions: string[];
  blockedActions: string[];
  requiresApproval: string[];
  maxTokensPerMessage?: number;
  maxMessagesPerConversation?: number;
}

export interface AgentRunRequest {
  conversationId: string;
  tenantId: string;
  agentId: string;
  messages: AgentMessage[];
  skill: AgentSkillConfig;
  policy: AgentPolicyConfig;
}

export interface AgentRunResponse {
  message: AgentMessage;
  tokenCount: {
    input: number;
    output: number;
    total: number;
  };
  model: string;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'error';
  needsHuman?: boolean; // escalation flag
}
