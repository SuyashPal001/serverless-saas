export type ToolStakes = 'low' | 'medium' | 'high' | 'critical'

export interface ToolDefinition {
  id: string
  name: string
  displayName: string
  description: string | null
  provider: string | null
  parametersSchema: unknown
  stakes: ToolStakes
  requiresApproval: boolean
  maxRetries: number
  timeoutMs: number
}

export interface ToolRegistryResult {
  tools: ToolDefinition[]
  requiresApprovalTools: string[]  // tool names that need human approval
  highStakeTools: string[]         // tool names that are high or critical
}
