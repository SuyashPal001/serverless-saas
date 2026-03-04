import { z } from 'zod';

export const channelStepConfigSchema = z.object({
  _type: z.literal('channel'),
  channel: z.enum(['email', 'sms', 'in_app', 'slack']),
});

export const delayStepConfigSchema = z.object({
  _type: z.literal('delay'),
  duration: z.number().int().positive(),
  unit: z.enum(['minutes', 'hours', 'days']),
});

export const conditionStepConfigSchema = z.object({
  _type: z.literal('condition'),
  check: z.string(),
  operator: z.enum(['equals', 'not_equals', 'exists', 'gt', 'lt']),
  value: z.unknown(),
});

export const stepConfigSchema = z.discriminatedUnion('_type', [
  channelStepConfigSchema,
  delayStepConfigSchema,
  conditionStepConfigSchema,
]);

export const skipConditionSchema = z
  .object({
    check: z.string(),
    operator: z.enum(['equals', 'not_equals', 'exists']),
    value: z.unknown(),
  })
  .nullable();
