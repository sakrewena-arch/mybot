import pino from 'pino';

const nodeEnv = process.env.NODE_ENV ?? 'development';

/**
 * Shared logger. Pretty output in development, structured JSON in production.
 * Silent in tests (vitest sets NODE_ENV=test).
 */
export const logger = pino({
  level: nodeEnv === 'test' ? 'silent' : nodeEnv === 'development' ? 'debug' : 'info',
  transport:
    nodeEnv === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
      : undefined,
});