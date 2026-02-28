import { z } from 'zod';

export const auditMetadataSchema = z
  .object({
    previousValue: z.unknown().optional(),
    newValue: z.unknown().optional(),
    reason: z.string().optional(),
    source: z.enum(['ui', 'api', 'agent', 'system', 'webhook']).optional(),
    additionalContext: z.record(z.unknown()).optional(),
  })
  .strict();
