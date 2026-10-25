import type { AuthenticatedUser } from '../modules/auth/auth.types.js';

declare global {
  namespace Express {
    interface Request {
      /** Set by `authenticate`. */
      user?: AuthenticatedUser;
      /**
       * Set by `validate()`. Parsed input lives here rather than being written back
       * over `req.query` — in Express 5 `req.query` is a getter with no setter, so
       * the usual sanitize-and-reassign trick throws.
       */
      validated?: {
        body?: unknown;
        query?: unknown;
        params?: unknown;
      };
    }
  }
}

export {};
