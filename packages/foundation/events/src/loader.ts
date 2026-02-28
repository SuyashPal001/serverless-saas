import { PLATFORM_EVENTS } from './registry';
import type { EventMeta } from './registry';

export const getAllEvents = (
  ...registries: Record<string, EventMeta>[]
): Record<string, EventMeta> => {
  return Object.assign({}, PLATFORM_EVENTS, ...registries);
};
