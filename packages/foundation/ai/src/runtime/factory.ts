/**
 * Runtime Factory
 *
 * Returns the appropriate AgentSessionRuntime adapter based on configuration.
 * Singletons are created once per Lambda cold start and reused across invocations.
 */

import type { AgentSessionRuntime, RuntimeConfig } from './interface';
import { OpenClawAdapter } from '../adapters/openclaw';

export type RuntimeType = 'openclaw';

const runtimeConfig: RuntimeConfig = {
  wsEndpoint: process.env.OPENCLAW_WS_ENDPOINT ?? '',
  authToken: process.env.OPENCLAW_AUTH_TOKEN ?? '',
  timeoutMs: 30_000,
  debug: process.env.NODE_ENV !== 'production',
};

// Singleton — created once per Lambda cold start
let openclawRuntime: AgentSessionRuntime | null = null;

/**
 * Get the runtime adapter instance.
 *
 * @param type - Which runtime to use (default: 'openclaw')
 */
export function getRuntime(type: RuntimeType = 'openclaw'): AgentSessionRuntime {
  if (type === 'openclaw') {
    if (!openclawRuntime) {
      openclawRuntime = new OpenClawAdapter(runtimeConfig);
    }
    return openclawRuntime;
  }

  // Exhaustive check — TypeScript will catch unhandled RuntimeType values
  const _exhaustive: never = type;
  throw new Error(`Unknown runtime type: ${_exhaustive}`);
}

/**
 * Determine which runtime to use for a tenant.
 *
 * TODO: Check tenant config or feature flag to support per-tenant runtime selection.
 */
export function selectRuntime(_tenantId: string): RuntimeType {
  return 'openclaw';
}
