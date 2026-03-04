"use client";

import * as z from "zod";

export const agentSchema = z.object({
    name: z.string().min(2, { message: "Name must be at least 2 characters." }),
    type: z.enum(["ops", "support", "billing", "custom"]),
    model: z.string().min(1, { message: "Model is required." }),
});

export type AgentFormValues = z.infer<typeof agentSchema>;

export type AgentType = "ops" | "support" | "billing" | "custom";
export type AgentStatus = "active" | "paused" | "retired";

export interface Agent {
    id: string;
    name: string;
    type: AgentType;
    status: AgentStatus;
    model: string;
    createdAt: string;
}

export interface AgentsResponse {
    agents: Agent[];
}

export interface AgentDetail extends Agent {
    createdBy: string;
    description?: string;
}

export interface Workflow {
    id: string;
    name: string;
    status: "active" | "inactive";
    lastRunAt?: string;
    runCount: number;
}

export interface WorkflowsResponse {
    workflows: Workflow[];
}

export interface StepCompleted {
    stepOrder: number;
    toolName: string;
    status: string;
}

export interface ActionTaken {
    action: string;
    resource: string;
    description: string;
}

export type RunStatus = 'completed' | 'running' | 'failed' | 'awaiting_approval';

export interface AgentRun {
    id: string;
    trigger: string;
    status: RunStatus;
    startedAt: string;
    completedAt: string | null;
    stepsCompleted: StepCompleted[];
    actionsTaken: ActionTaken[];
    humanApproved: boolean | null;
}

export interface AgentRunsResponse {
    runs: AgentRun[];
    total: number;
    page: number;
    totalPages: number;
}
