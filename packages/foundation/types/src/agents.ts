import type { Timestamps } from './common';
import type { WorkflowTrigger, WorkflowStatus, WorkflowRunStatus } from './enums';

// ============================================
// Agent Workflow
// ============================================

export interface AgentWorkflow extends Timestamps {
  id: string;
  tenantId: string;
  agentId: string;
  name: string;
  trigger: WorkflowTrigger;
  steps: AgentWorkflowStep[];
  requiresApproval: boolean;
  llmProviderId: string | null;
  temperature: number | null;
  maxTokens: number | null;
  systemPrompt: string | null;
  status: WorkflowStatus;
}

export interface AgentWorkflowStep {
  order: number;
  toolName: string;
  toolType: 'internal' | 'mcp_external';
  parameters?: Record<string, unknown>;
  condition?: {
    field: string;
    operator: 'equals' | 'not_equals' | 'contains' | 'gt' | 'lt' | 'exists';
    value: unknown;
  };
  onFailure: 'stop' | 'skip' | 'retry';
  requiresApproval: boolean;
}

export type CreateAgentWorkflowInput = Pick<AgentWorkflow, 'tenantId' | 'agentId' | 'name' | 'trigger' | 'steps'> & {
  requiresApproval?: boolean;
  llmProviderId?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
};

// ============================================
// Agent Workflow Run
// ============================================

export interface AgentWorkflowRun {
  id: string;
  workflowId: string;
  tenantId: string;
  agentId: string;
  trigger: string;
  stepsCompleted: CompletedStep[];
  toolsCalled: ToolCall[];
  insights: string | null;
  actionsTaken: ActionTaken[];
  humanApproved: boolean | null;
  approvedBy: string | null;
  status: WorkflowRunStatus;
  startedAt: Date;
  completedAt: Date | null;
}

export interface CompletedStep {
  stepOrder: number;
  toolName: string;
  status: 'success' | 'failed' | 'skipped' | 'approval_pending';
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  durationMs?: number;
  completedAt: string;
}

export interface ToolCall {
  toolName: string;
  toolType: 'internal' | 'mcp_external';
  provider?: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  durationMs: number;
  calledAt: string;
}

export interface ActionTaken {
  action: string;
  resource: string;
  resourceId?: string;
  description: string;
  timestamp: string;
}
