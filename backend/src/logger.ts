import { pino } from 'pino';
import { env } from './config.js';

/**
 * Structured JSON logging. Every log line carries optional correlation
 * context (requestId, runId, incidentId) supplied via child loggers or the
 * AsyncLocalStorage request context middleware.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'ghostops-backend' },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(env.LOG_PRETTY
    ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname,service' } } }
    : {}),
});