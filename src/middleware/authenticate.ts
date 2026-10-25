import type { RequestHandler } from 'express';
import { ApiError } from '../lib/ApiError.js';
import { readSessionCookie } from '../modules/auth/auth.controller.js';
import { resolveSession } from '../modules/auth/auth.service.js';

/**
 * FR-3: every /api route except /api/auth/* requires an active session.
 * FR-5: missing, unknown or expired session → 401.
 *
 * This is the whole authorisation story. Doctor Tracker has one role, so an active
 * session means full access — there is deliberately no `requireRole` companion. A guard
 * comparing against a single-member set can only ever pass, and a check that cannot fail
 * reads as protection while providing none.
 *
 * The session is resolved from the database on every request rather than trusted from a
 * signed token. That costs two indexed reads and buys immediate revocation: deleting the
 * session row, or the user, takes effect on the very next call instead of whenever a
 * token would have expired.
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const token = readSessionCookie(req);

  if (!token) {
    next(ApiError.unauthorized('No active session', 'NO_SESSION'));
    return;
  }

  try {
    req.user = await resolveSession(token);
    next();
  } catch (error) {
    next(error);
  }
};
