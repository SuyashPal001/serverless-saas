import type { RequestContext, ApiKeyContext } from '@serverless-saas/types';

/**
 * Hono environment bindings.
 * Variables set by middleware, available in all handlers.
 */
export interface AppEnv {
  Variables: {
    requestContext?: RequestContext;
    apiKeyContext?: ApiKeyContext;
    userId?: string;
    traceId: string;
    startTime: number;
    jwtPayload?: Record<string, string>;
  };
}