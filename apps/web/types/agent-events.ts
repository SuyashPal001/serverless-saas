/**
 * Agent Event Types
 * 
 * These match the backend event types from @serverless-saas/ai
 */

export type AgentEventType =
  | 'session.started'
  | 'session.ended'
  | 'agent.thinking'
  | 'agent.message'
  | 'agent.message.delta'
  | 'tool.calling'
  | 'tool.result'
  | 'canvas.update'
  | 'approval.required'
  | 'error'
  | 'usage.report';

export interface Attachment {
  fileId: string;
  name: string;
  type: string;
  size?: number;
  previewUrl?: string;   // local blob: URL for optimistic image preview (browser only)
  presignedUrl?: string; // S3 presigned HTTPS URL for relay to fetch image data
}

export interface BaseAgentEvent {
  type: AgentEventType;
  sessionId: string;
  timestamp: string;
}

export interface AgentThinkingEvent extends BaseAgentEvent {
  type: 'agent.thinking';
  thought?: string;
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
  delta: string;
  index: number;
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
    screenshot?: string;
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
  approvalId: string;
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

export interface SessionEndedEvent extends BaseAgentEvent {
  type: 'session.ended';
  reason: 'completed' | 'error' | 'timeout' | 'user_cancelled';
  usage?: UsageReport;
}

export interface SessionStartedEvent extends BaseAgentEvent {
  type: 'session.started';
  config: {
    agentId: string;
    skillName: string;
    model: string;
  };
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

// WebSocket message wrapper
export interface AgentEventMessage {
  type: 'agent.event';
  payload: AgentEvent;
}
