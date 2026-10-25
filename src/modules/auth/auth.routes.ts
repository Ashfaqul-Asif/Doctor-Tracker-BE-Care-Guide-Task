import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { loginRateLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { loginHandler, logoutHandler, meHandler } from './auth.controller.js';
import { loginBodySchema } from './auth.schema.js';

export const authRouter = Router();

authRouter.post('/login', loginRateLimiter, validate({ body: loginBodySchema }), loginHandler);

// The only authenticated route in this router: it answers "who is this cookie?", so it
// necessarily runs behind the same guard as everything else.
authRouter.get('/me', authenticate, meHandler);

// Logout is deliberately unlimited and unauthenticated: it only ever deletes. Throttling
// or gating the one action that reduces exposure would work against the user.
authRouter.post('/logout', logoutHandler);

/**
 * There is no `/register`. The first administrator comes from the admin seeder, which is
 * the documented bootstrap for an internal tool with no public sign-up. Adding one later
 * is a route plus a service call — `hashPassword` and the `User` model already support it.
 *
 * There is also no `/refresh`. Sessions are server-side state with their own expiry, so
 * there is no short-lived token needing renewal — the reason that endpoint existed.
 */
