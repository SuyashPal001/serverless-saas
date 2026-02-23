import * as winston from 'winston';
import TransportStream from 'winston-transport';
import { ErrorLogger, IErrorLog } from '@fit-earn-meditate/backend-shared-models';

const { combine, timestamp, json } = winston.format;

interface LogInfo {
  level: string;
  message: string;
  timestamp: Date;
  meta?: {
    errorCode?: number;
    errorString?: string;
    type?: string;
  };
}

class MongooseTransport extends TransportStream {
  static error: any;
  constructor(opts?: TransportStream.TransportStreamOptions) {
    super(opts);
  }

  log(info: LogInfo, callback: () => void): void {
    setImmediate(() => this.emit('logged', info));

    const logEntry: IErrorLog = new ErrorLogger({
      level: info.level,
      message: info.message,
      timestamp: info.timestamp,
      errorCode: info.meta?.errorCode,
      errorString: info.meta?.errorString,
      type: info.meta?.type,
    });

    logEntry
      .save()
      .then(() => callback())
      .catch((err) => {
        console.error('Failed to save log entry:', err);
        callback();
      });
  }
}

const mongooseTransport = new MongooseTransport();

const logger = winston.createLogger({
  level: 'info',
  format: combine(timestamp(), json()),
  transports: [new winston.transports.Console(), mongooseTransport],
});

export default logger;
