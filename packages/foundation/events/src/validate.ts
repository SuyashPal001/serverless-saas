import { z } from 'zod';
import { VALID_EVENTS } from './registry';

export const platformEventSchema = z.enum(VALID_EVENTS as [string, ...string[]]);

export const eventSubscriptionSchema = z
  .array(z.union([z.literal('*'), platformEventSchema]))
  .min(1);

export const messageTypeSchema = platformEventSchema;
