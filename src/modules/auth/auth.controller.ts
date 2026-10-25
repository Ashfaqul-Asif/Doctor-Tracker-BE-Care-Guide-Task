import type { CookieOptions, Request, RequestHandler, Response } from 'express';
import { env } from '../../config/env.js';
import { ApiError } from '../../lib/ApiError.js';
import { validated } from '../../middleware/validate.js';
import { loginBodySchema } from './auth.schema.js';
import * as authService from './auth.service.js';

/**
 * The session token lives in an httpOnly cookie and nowhere else.
 *
 * It is never returned in a response body and never handed to JavaScript, so there is no
 * copy for an XSS payload to steal and nothing for the client to store. `Path=/` because
 * unlike the refresh token this replaces, it authenticates *every* API call, not just
 * the auth routes.
 */
export const SESSION_COOKIE_NAME = 'careguide_session';

function sessionCookieOptions(expires?: Date): CookieOptions {
  const options: CookieOptions = {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE,
    path: '/',
  };
  if (env.COOKIE_DOMAIN) options.domain = env.COOKIE_DOMAIN;
  if (expires) options.expires = expires;
  return options;
}

export function readSessionCookie(req: Request): string | undefined {
  const value = (req.cookies as Record<string, unknown> | undefined)?.[SESSION_COOKIE_NAME];
  return typeof value === 'string' ? value : undefined;
}

function sendSession(res: Response, session: authService.AuthSession): void {
  res.cookie(SESSION_COOKIE_NAME, session.token, sessionCookieOptions(session.expiresAt));
  // Only the user goes in the body — the credential itself is in the cookie. The client
  // needs the identity to render; it never needs the token.
  res.json({ user: session.user });
}

export const loginHandler: RequestHandler = async (req, res) => {
  const { email, password } = validated(req, 'body', loginBodySchema);
  const session = await authService.login(email, password);
  sendSession(res, session);
};

/**
 * Who am I?
 *
 * The client cannot read an httpOnly cookie, so on a fresh page load it has no way to
 * know whether it is signed in. This endpoint is that answer, and it is what restores
 * the session after a reload.
 */
export const meHandler: RequestHandler = (req, res) => {
  if (!req.user) throw ApiError.unauthorized('No active session', 'NO_SESSION');
  res.json({ user: req.user });
};

export const logoutHandler: RequestHandler = async (req, res) => {
  await authService.logout(readSessionCookie(req));
  res.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions());
  res.status(204).send();
};
