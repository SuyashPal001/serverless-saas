import type { ErrorHandler } from 'hono';
import { getLogger } from '@serverless-saas/logger';
import type { AppEnv } from '../types';

export const errorHandler: ErrorHandler<AppEnv> = (err, c) => {
  const logger = getLogger();
  const traceId = c.get('traceId') ?? 'unknown';
  console.error('UNHANDLED ERROR:', err);

  logger.error('unhandled_error', {
    traceId,
    tenantId: c.get('requestContext')?.tenant?.id,
    userId: c.get('requestContext')?.user?.id,
    method: c.req.method,
    path: c.req.path,
    error: err,
  });

  // Don't leak internal errors to client
  return c.json(
    {
      error: 'An unexpected error occurred',
      code: 'INTERNAL_ERROR',
    },
    500,
  );
};
