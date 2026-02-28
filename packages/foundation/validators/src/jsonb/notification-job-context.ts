import { z } from 'zod';

export const notificationPayloadSchema = z.object({
  event: z.string(),
  tenantId: z.string().uuid(),
  actorId: z.string().uuid().optional(),
  actorType: z.enum(['human', 'agent', 'system']).optional(),
  resourceId: z.string().uuid().optional(),
  resourceType: z.string().optional(),
  data: z.record(z.unknown()),
  triggeredAt: z.string().datetime(),
});

export const stepContextSchema = z.object({
  previousStepResults: z
    .array(
      z.object({
        stepId: z.string().uuid(),
        status: z.enum(['completed', 'skipped', 'failed']),
        channel: z.enum(['email', 'sms', 'in_app', 'slack']).optional(),
        deliveryStatus: z.string().optional(),
      }),
    )
    .default([]),
  variables: z.record(z.unknown()).default({}),
});
