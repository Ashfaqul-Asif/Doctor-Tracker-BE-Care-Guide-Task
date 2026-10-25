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

function sessionCookieOptions(req: Request, expires?: Date): CookieOptions {
  // The frontend and API live on different sites, so the session cookie must be
  // SameSite=None to be sent on cross-site requests — and browsers only accept None with
  // Secure, i.e. over HTTPS. Derive this from the actual request (trust proxy is enabled,
  // so this reflects X-Forwarded-Proto) instead of env vars, so a deployed HTTPS backend
  // is correct automatically and local HTTP dev still gets a plain Lax cookie. An explicit
  // COOKIE_SECURE / COOKIE_SAMESITE can still force the values if ever needed.
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const options: CookieOptions = {
    httpOnly: true,
    secure: isHttps || env.COOKIE_SECURE,
    sameSite: isHttps ? 'none' : env.COOKIE_SAMESITE,
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

function sendSession(req: Request, res: Response, session: authService.AuthSession): void {
  res.cookie(SESSION_COOKIE_NAME, session.token, sessionCookieOptions(req, session.expiresAt));
  // Only the user goes in the body — the credential itself is in the cookie. The client
  // needs the identity to render; it never needs the token.
  res.json({ user: session.user });
}

export const loginHandler: RequestHandler = async (req, res) => {
  const { email, password } = validated(req, 'body', loginBodySchema);
  const session = await authService.login(email, password);
  sendSession(req, res, session);
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
  res.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions(req));
  res.status(204).send();
};
