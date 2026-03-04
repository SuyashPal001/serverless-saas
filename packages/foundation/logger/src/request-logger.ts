import { createHash } from 'crypto';
import type { Logger } from './logger';
import { maskObject } from './masks';

export interface RequestLogEntry {
  traceId: string;
  tenantId?: string;
  userId?: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  requestBodyHash?: string;
  userAgent?: string;
  timestamp: string;
}

export interface ErrorLogEntry extends RequestLogEntry {
  requestBody?: Record<string, unknown>;
  responseBody?: Record<string, unknown>;
  stack?: string;
}

const hashBody = (body: unknown): string => {
  if (!body) return '';
  const str = typeof body === 'string' ? body : JSON.stringify(body);
  return `sha256:${createHash('sha256').update(str).digest('hex').slice(0, 16)}`;
};

export const logRequest = (
  logger: Logger,
  entry: RequestLogEntry,
): void => {
  logger.info('request', entry as unknown as Record<string, unknown>);
};

export const logError = (
  logger: Logger,
  entry: ErrorLogEntry,
): void => {
  const masked = {
    ...entry,
    requestBody: entry.requestBody ? maskObject(entry.requestBody) : undefined,
    responseBody: entry.responseBody ? maskObject(entry.responseBody) : undefined,
  };
  logger.error('request_error', masked as unknown as Record<string, unknown>);
};

export const createRequestLog = (opts: {
  method: string;
  path: string;
  startTime: number;
  statusCode: number;
  traceId: string;
  tenantId?: string;
  userId?: string;
  body?: unknown;
  userAgent?: string;
}): RequestLogEntry => ({
  traceId: opts.traceId,
  tenantId: opts.tenantId,
  userId: opts.userId,
  method: opts.method,
  path: opts.path,
  statusCode: opts.statusCode,
  durationMs: Date.now() - opts.startTime,
  requestBodyHash: opts.body ? hashBody(opts.body) : undefined,
  userAgent: opts.userAgent,
  timestamp: new Date().toISOString(),
});
