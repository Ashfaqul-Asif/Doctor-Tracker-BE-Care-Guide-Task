import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { ApiError } from './lib/ApiError.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { rejectOperatorKeys } from './middleware/rejectOperatorKeys.js';
import { apiRouter } from './routes.js';

type CorsCallback = (err: Error | null, allow?: boolean) => void;

/**
 * Credentials are enabled (the refresh token is a cookie), so the wildcard origin is
 * not an option — the browser rejects `Access-Control-Allow-Origin: *` alongside
 * `credentials: include`. Hence an explicit allowlist from the environment.
 */
function corsOrigin(origin: string | undefined, callback: CorsCallback): void {
  // Same-origin requests, curl and server-to-server calls send no Origin header.
  if (!origin) {
    callback(null, true);
    return;
  }
  if (env.corsOrigins.includes(origin)) {
    callback(null, true);
    return;
  }
  callback(new ApiError(403, 'CORS_NOT_ALLOWED', `Origin ${origin} is not allowed`));
}

export function createApp(): Express {
  const app = express();

  // Behind a proxy (Render/Railway/Fly) the real client IP arrives in X-Forwarded-For.
  // The login rate limiter buckets by IP, so getting this wrong means every user
  // shares one bucket — or worse, an attacker can forge their way into a fresh one.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(cors({ origin: corsOrigin, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  if (!env.isTest) app.use(pinoHttp({ logger }));
  app.use(rejectOperatorKeys);

  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
