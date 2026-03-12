import type { RequestContext, ApiKeyContext } from '@serverless-saas/types';
import type { LambdaEvent } from 'hono/aws-lambda';

/**
 * Hono environment bindings.
 * Bindings: AWS Lambda event exposed to c.env (required for API Gateway JWT claim extraction)
 * Variables: set by middleware, available in all handlers.
 */
export interface AppEnv {
  Bindings: {
    event: LambdaEvent;
  };
  Variables: {
    requestContext?: RequestContext;
    tenantId: string;
    apiKeyContext?: ApiKeyContext;
    userId?: string;
    traceId: string;
    startTime: number;
    jwtPayload?: Record<string, string>;
  };
}