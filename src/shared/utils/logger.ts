// src/shared/utils/logger.ts
import { v4 as uuidv4 } from 'uuid';

const REDACTED = 'REDACTED';

export interface LoggerConfig {
  requestId: string;
  functionName: string;
  environment: string;
  correlationId?: string;
}

export class Logger {
  private config: Required<LoggerConfig>;

  constructor(requestId: string, functionName: string, environment: string, incomingCorrelationId?: string) {
    if (!environment) {
      throw new Error('Missing required env var: ENV');
    }
    this.config = {
      requestId,
      functionName,
      environment,
      correlationId: incomingCorrelationId || uuidv4(),
    };
  }

  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string, extra: Record<string, unknown> = {}): void {
    const logEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...this.config,
      ...extra,
    };

    const safeEntry = this.redactSensitiveFields(logEntry);
    console.log(JSON.stringify(safeEntry));
  }

  private redactSensitiveFields(obj: Record<string, unknown>): Record<string, unknown> {
    const sensitiveKeys = ['password', 'secret', 'token', 'key', 'authorization', 'cookie', 'jwt'];
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some(term => lowerKey.includes(term))) {
        result[key] = REDACTED;
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        result[key] = this.redactSensitiveFields(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  debug(message: string, extra: Record<string, unknown> = {}): void {
    this.log('debug', message, extra);
  }

  info(message: string, extra: Record<string, unknown> = {}): void {
    this.log('info', message, extra);
  }

  warn(message: string, extra: Record<string, unknown> = {}): void {
    this.log('warn', message, extra);
  }

  error(message: string, extra: Record<string, unknown> = {}): void {
    this.log('error', message, extra);
  }

  getCorrelationId(): string {
    return this.config.correlationId;
  }
}
