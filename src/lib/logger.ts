import pino from 'pino';
import { env } from '../config/env.js';

/**
 * Credentials must never reach the log sink — FR-4 forbids logging passwords, and
 * bearer tokens/cookies are equally sensitive.
 */
const redact = {
  paths: [
    'req.headers.authorization',
    'req.headers.cookie',
    'res.headers["set-cookie"]',
    '*.password',
    '*.passwordHash',
    '*.refreshToken',
    '*.accessToken',
  ],
  censor: '[redacted]',
};

export const logger = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  redact,
  ...(env.isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }),
});
