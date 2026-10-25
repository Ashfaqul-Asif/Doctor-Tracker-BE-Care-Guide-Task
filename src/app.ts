import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import * as helmetModule from 'helmet';
import type { RequestHandler } from 'express';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { ApiError } from './lib/ApiError.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { rejectOperatorKeys } from './middleware/rejectOperatorKeys.js';
import { apiRouter } from './routes.js';
import { connectToDatabase } from './db/connect.js';

// Vercel's TS runtime resolves helmet v8 (ESM-only) as an uncallable namespace,
// so `helmet()` fails to type-check even though it runs fine. Pick up the default
// export when it exists, otherwise fall back to the namespace, and cast to a
// callable so the subsequent `helmet()` call is accepted under both resolutions.
const helmet = ((helmetModule as unknown as { default?: unknown }).default ?? helmetModule) as (
  ...args: unknown[]
) => RequestHandler;

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

  // On serverless hosts (Vercel) `server.ts` never runs, so the database connection it
  // opens at boot is absent and every query would buffer for 10s then time out. Open the
  // connection lazily on the first request instead. `connectToDatabase` caches its
  // connection promise, so once connected this resolves immediately; a connection failure
  // is forwarded to the error handler rather than surfacing as a buffering timeout.
  app.use((_req, _res, next) => {
    connectToDatabase().then(() => next()).catch(next);
  });

  app.use('/api/v1', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

// Vercel's Serverless Functions runtime loads this module and expects its
// default export to be an `(req, res) => void` handler. An Express app is one,
// so exporting a singleton here is enough for every request to flow through it.
// Local development and other hosts keep using `createApp()` from `server.ts`,
// so this default export is a no-op there.
export default createApp();
