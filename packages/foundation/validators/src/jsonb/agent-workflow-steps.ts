import { z } from 'zod';

export const agentWorkflowStepSchema = z.object({
  order: z.number().int().positive(),
  toolName: z.string(),
  toolType: z.enum(['internal', 'mcp_external']),
  parameters: z.record(z.unknown()).optional(),
  condition: z
    .object({
      field: z.string(),
      operator: z.enum(['equals', 'not_equals', 'contains', 'gt', 'lt', 'exists']),
      value: z.unknown(),
    })
    .optional(),
  onFailure: z.enum(['stop', 'skip', 'retry']).default('stop'),
  requiresApproval: z.boolean().default(false),
});

export const agentWorkflowStepsSchema = z.array(agentWorkflowStepSchema).min(1);
