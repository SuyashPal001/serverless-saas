/**
 * System logger for shared services and infrastructure
 * Uses console but with structured format for CloudWatch
 */
export class SystemLogger {
  private context: string;

  constructor(context: string) {
    this.context = context;
  }

  info(message: string, meta?: Record<string, any>): void {
    this.log('INFO', message, meta);
  }

  error(message: string, error?: any, meta?: Record<string, any>): void {
    this.log('ERROR', message, { ...meta, error: error?.message || error });
  }

  warn(message: string, meta?: Record<string, any>): void {
    this.log('WARN', message, meta);
  }

  private log(level: string, message: string, meta?: Record<string, any>): void {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      context: this.context,
      message,
      ...meta
    };
    
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(logEntry));
  }
}
