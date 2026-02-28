import { maskObject } from './masks';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface LogContext {
  traceId?: string;
  tenantId?: string;
  userId?: string;
  [key: string]: unknown;
}

export interface LoggerConfig {
  level: LogLevel;
  serviceName: string;
  environment: string;
}

export class Logger {
  private level: number;
  private serviceName: string;
  private environment: string;

  constructor(config?: Partial<LoggerConfig>) {
    this.level = LOG_LEVELS[config?.level ?? (process.env.LOG_LEVEL as LogLevel) ?? 'info'];
    this.serviceName = config?.serviceName ?? process.env.SERVICE_NAME ?? 'unknown';
    this.environment = config?.environment ?? process.env.NODE_ENV ?? 'development';
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= this.level;
  }

  private write(level: LogLevel, message: string, context?: LogContext): void {
    if (!this.shouldLog(level)) return;

    const entry = {
      level,
      message,
      service: this.serviceName,
      environment: this.environment,
      timestamp: new Date().toISOString(),
      ...(context ? maskObject(context as Record<string, unknown>) : {}),
    };

    const output = JSON.stringify(entry);

    switch (level) {
      case 'error':
        console.error(output);
        break;
      case 'warn':
        console.warn(output);
        break;
      default:
        console.log(output);
    }
  }

  debug(message: string, context?: LogContext): void {
    this.write('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.write('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.write('warn', message, context);
  }

  error(message: string, context?: LogContext & { error?: Error }): void {
    const ctx = context ? { ...context } : {};
    if (ctx.error instanceof Error) {
      (ctx as Record<string, unknown>).errorMessage = ctx.error.message;
      (ctx as Record<string, unknown>).stack = ctx.error.stack;
      delete ctx.error;
    }
    this.write('error', message, ctx);
  }

  child(defaultContext: LogContext): ChildLogger {
    return new ChildLogger(this, defaultContext);
  }
}

export class ChildLogger {
  constructor(
    private parent: Logger,
    private defaultContext: LogContext,
  ) {}

  debug(message: string, context?: LogContext): void {
    this.parent.debug(message, { ...this.defaultContext, ...context });
  }

  info(message: string, context?: LogContext): void {
    this.parent.info(message, { ...this.defaultContext, ...context });
  }

  warn(message: string, context?: LogContext): void {
    this.parent.warn(message, { ...this.defaultContext, ...context });
  }

  error(message: string, context?: LogContext & { error?: Error }): void {
    this.parent.error(message, { ...this.defaultContext, ...context });
  }
}

/** Default singleton logger */
let defaultLogger: Logger | null = null;

export const getLogger = (config?: Partial<LoggerConfig>): Logger => {
  if (!defaultLogger) {
    defaultLogger = new Logger(config);
  }
  return defaultLogger;
};

export const resetLogger = (): void => {
  defaultLogger = null;
};
