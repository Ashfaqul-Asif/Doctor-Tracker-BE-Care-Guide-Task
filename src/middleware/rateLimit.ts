import { MemoryStore, rateLimit, type RateLimitRequestHandler } from 'express-rate-limit';
import { env } from '../config/env.js';

/**
 * FR-6: brute-force mitigation on the auth endpoints.
 *
 * Each limiter owns its store explicitly rather than letting the library create one
 * implicitly, so the test suite can reset them between cases — otherwise the fifth
 * assertion in a file poisons the sixth.
 */
const stores: MemoryStore[] = [];

function createLimiter(options: {
  windowMs: number;
  limit: number;
  message: string;
}): RateLimitRequestHandler {
  const store = new MemoryStore();
  stores.push(store);

  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    store,
    handler: (_req, res) => {
      // Same envelope as `errorHandler` produces — the limiter short-circuits before the
      // router, so it has to build the shape itself rather than inherit it.
      res.status(429).json({
        error: { code: 'TOO_MANY_REQUESTS', message: options.message },
      });
    },
  });
}

export const loginRateLimiter = createLimiter({
  windowMs: env.LOGIN_RATE_WINDOW_MS,
  limit: env.LOGIN_RATE_MAX,
  message: 'Too many login attempts. Please try again later.',
});

/**
 * Refresh carries a credential too, so it gets the same treatment as login — just a much
 * higher ceiling, since a legitimate client calls it on a timer and several open tabs
 * multiply that. Without any limit, a stolen cookie can be replayed indefinitely.
 */
export const refreshRateLimiter = createLimiter({
  windowMs: env.REFRESH_RATE_WINDOW_MS,
  limit: env.REFRESH_RATE_MAX,
  message: 'Too many refresh attempts. Please sign in again.',
});

/**
 * Exposed for tests, which need each case to start with a clean counter.
 *
 * Awaited rather than fire-and-forget: `Store.resetAll` is allowed to be asynchronous,
 * and a reset still in flight when the next case starts is a flaky test.
 */
export async function resetRateLimits(): Promise<void> {
  await Promise.all(stores.map((store) => store.resetAll()));
}
