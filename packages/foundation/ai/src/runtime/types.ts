// Core types for agent runtime

// =============================================================================
// EXISTING TYPES (stateless request/response model — used by VertexAdapter)
// =============================================================================

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

// =============================================================================
// SESSION CONFIG — Sent to VM on session start
// =============================================================================

/**
 * LLM provider credentials and config for the VM to use when making LLM calls.
 */
export interface LLMProviderConfig {
  provider: 'vertex' | 'openai' | 'anthropic' | 'mistral' | 'openrouter';
  model: string; // e.g. "gemini-2.5-pro", "gpt-4o", "claude-sonnet-4-5"
  credentials: {
    apiKey?: string;                             // OpenAI, Anthropic, OpenRouter
    projectId?: string;                          // Vertex AI
    location?: string;                           // Vertex AI region
    serviceAccountKey?: Record<string, unknown>; // Vertex AI service account
  };
  config?: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    topK?: number;
  };
}

/**
 * Skill config bundle for session — includes DB IDs for traceability.
 */
export interface SkillConfig {
  skillId: string;
  name: string;
  systemPrompt: string;
  tools: string[];
  config: {
    temperature?: number;
    maxTokens?: number;
    [key: string]: unknown;
  };
}

/**
 * Policy config bundle for session — what the agent can/cannot do.
 */
export interface PolicyConfig {
  policyId: string;
  allowedActions: string[];
  blockedActions: string[];
  requiresApproval: string[]; // Actions needing human confirmation before execution
  limits?: {
    maxTokensPerMessage?: number;
    maxMessagesPerConversation?: number;
    maxToolCallsPerTurn?: number;
  };
}

/**
 * Full session config bundle sent to the VM when a session starts.
 */
export interface AgentSessionConfig {
  // Identity
  sessionId: string;
  tenantId: string;
  userId: string;
  agentId: string;
  conversationId: string;

  // Configuration
  llmProvider: LLMProviderConfig;
  skill: SkillConfig;
  policy: PolicyConfig;

  // Prior context
  conversationHistory?: ConversationMessage[];

  // Platform callback URLs the VM should POST to
  callbacks: {
    usageReportUrl: string;
    eventStreamUrl?: string;
  };
}

// =============================================================================
// CONVERSATION MESSAGES
// =============================================================================

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface ConversationMessage {
  id: string;
  role: MessageRole;
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  createdAt: string;
}

// =============================================================================
// STREAMING EVENTS — VM → Platform → Frontend
// =============================================================================

export type AgentEventType =
  | 'session.started'
  | 'session.ended'
  | 'agent.thinking'
  | 'agent.message'
  | 'agent.message.delta'   // Streaming text chunk
  | 'tool.calling'
  | 'tool.result'
  | 'canvas.update'         // Browser/UI action
  | 'approval.required'     // Human approval needed
  | 'error'
  | 'usage.report';

export interface BaseAgentEvent {
  type: AgentEventType;
  sessionId: string;
  timestamp: string;
}

export interface SessionStartedEvent extends BaseAgentEvent {
  type: 'session.started';
  config: {
    agentId: string;
    skillName: string;
    model: string;
  };
}

export interface SessionEndedEvent extends BaseAgentEvent {
  type: 'session.ended';
  reason: 'completed' | 'error' | 'timeout' | 'user_cancelled';
  usage?: UsageReport;
}

export interface AgentThinkingEvent extends BaseAgentEvent {
  type: 'agent.thinking';
  thought?: string; // Optional reasoning trace
}

export interface AgentMessageEvent extends BaseAgentEvent {
  type: 'agent.message';
  messageId: string;
  content: string;
  role: 'assistant';
}

export interface AgentMessageDeltaEvent extends BaseAgentEvent {
  type: 'agent.message.delta';
  messageId: string;
  delta: string;  // Text chunk
  index: number;  // Chunk sequence number
}

export interface ToolCallingEvent extends BaseAgentEvent {
  type: 'tool.calling';
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultEvent extends BaseAgentEvent {
  type: 'tool.result';
  toolCallId: string;
  toolName: string;
  result: unknown;
  error?: string;
  durationMs: number;
}

export interface CanvasUpdateEvent extends BaseAgentEvent {
  type: 'canvas.update';
  action: 'screenshot' | 'click' | 'type' | 'navigate' | 'scroll' | 'file_created';
  data: {
    screenshot?: string;       // Base64 PNG
    url?: string;
    elementSelector?: string;
    text?: string;
    filePath?: string;
    fileType?: string;
    [key: string]: unknown;
  };
}

export interface ApprovalRequiredEvent extends BaseAgentEvent {
  type: 'approval.required';
  action: string;
  description: string;
  context: Record<string, unknown>;
  approvalId: string;  // ID to pass back in submitApproval
  expiresAt: string;
}

export interface ErrorEvent extends BaseAgentEvent {
  type: 'error';
  code: string;
  message: string;
  recoverable: boolean;
}

export interface UsageReport {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  toolCalls: number;
  llmCalls: number;
  durationMs: number;
  model: string;
}

export interface UsageReportEvent extends BaseAgentEvent {
  type: 'usage.report';
  usage: UsageReport;
}

export type AgentEvent =
  | SessionStartedEvent
  | SessionEndedEvent
  | AgentThinkingEvent
  | AgentMessageEvent
  | AgentMessageDeltaEvent
  | ToolCallingEvent
  | ToolResultEvent
  | CanvasUpdateEvent
  | ApprovalRequiredEvent
  | ErrorEvent
  | UsageReportEvent;

// =============================================================================
// SESSION RUNTIME RESULTS
// =============================================================================

export interface SendMessageResult {
  messageId: string;
  sessionId: string;
  status: 'streaming' | 'completed' | 'error';
}

export interface SessionResult {
  sessionId: string;
  status: 'active' | 'ended' | 'error';
  error?: string;
}
