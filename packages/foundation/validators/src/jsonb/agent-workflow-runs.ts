import { z } from 'zod';

export const completedStepSchema = z.object({
  stepOrder: z.number().int(),
  toolName: z.string(),
  status: z.enum(['success', 'failed', 'skipped', 'approval_pending']),
  input: z.record(z.unknown()).optional(),
  output: z.record(z.unknown()).optional(),
  error: z.string().optional(),
  durationMs: z.number().int().optional(),
  completedAt: z.string().datetime(),
});

export const stepsCompletedSchema = z.array(completedStepSchema);

export const toolCallSchema = z.object({
  toolName: z.string(),
  toolType: z.enum(['internal', 'mcp_external']),
  provider: z.string().optional(),
  input: z.record(z.unknown()),
  output: z.record(z.unknown()).optional(),
  error: z.string().optional(),
  durationMs: z.number().int(),
  calledAt: z.string().datetime(),
});

export const toolsCalledSchema = z.array(toolCallSchema);

export const actionTakenSchema = z.object({
  action: z.string(),
  resource: z.string(),
  resourceId: z.string().uuid().optional(),
  description: z.string(),
  timestamp: z.string().datetime(),
});

export const actionsTakenSchema = z.array(actionTakenSchema);
