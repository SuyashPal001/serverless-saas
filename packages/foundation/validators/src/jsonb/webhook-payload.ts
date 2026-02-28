import { z } from 'zod';

export const webhookPayloadSchema = z.object({
  id: z.string().uuid(),
  event: z.string(),
  tenantId: z.string().uuid(),
  timestamp: z.string().datetime(),
  data: z.record(z.unknown()),
});
