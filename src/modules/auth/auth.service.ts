import bcrypt from 'bcryptjs';
import { env } from '../../config/env.js';
import { Session } from '../../models/Session.js';
import { User } from '../../models/User.js';
import { ApiError } from '../../lib/ApiError.js';
import { hashSessionToken, newSessionToken } from '../../lib/sessionToken.js';
import type { AuthenticatedUser } from './auth.types.js';

/** FR-4: cost factor ≥ 10. */
export const BCRYPT_COST = 12;

export interface AuthSession {
  user: AuthenticatedUser;
  token: string;
  expiresAt: Date;
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

/**
 * Comparing against a real hash even when no user matched keeps the failure path's
 * timing roughly constant. Without it, "no such user" returns in microseconds while
 * "wrong password" takes ~200ms of bcrypt — a side channel that turns the login
 * endpoint into an account-enumeration oracle.
 */
let dummyHash: string | null = null;
async function equalizeTiming(password: string): Promise<void> {
  dummyHash ??= await bcrypt.hash('a-password-that-matches-nothing', BCRYPT_COST);
  await bcrypt.compare(password, dummyHash);
}

function expiryFromNow(): Date {
  return new Date(Date.now() + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

async function startSession(user: AuthenticatedUser): Promise<AuthSession> {
  const token = newSessionToken();
  const expiresAt = expiryFromNow();

  await Session.create({
    userId: user.id,
    tokenHash: hashSessionToken(token),
    expiresAt,
  });

  // The raw token is returned exactly once, to be written straight into the cookie. It
  // is never stored, logged or recoverable — only its hash survives this function.
  return { user, token, expiresAt };
}

/**
 * Credentials are verified against the `users` collection, never against configuration.
 *
 * There is no registration endpoint: the first administrator is created by the admin
 * seeder. Adding sign-up later means one route calling `hashPassword` and
 * `User.create` — nothing here assumes a single user exists.
 */
export async function login(email: string, password: string): Promise<AuthSession> {
  // `passwordHash` is `select: false` on the model, so it has to be asked for.
  const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');

  if (!user) {
    await equalizeTiming(password);
    throw ApiError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  const matches = await bcrypt.compare(password, user.passwordHash);
  if (!matches) {
    throw ApiError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  return startSession({ id: String(user._id), email: user.email, role: user.role });
}

/**
 * Resolves a raw session token to the user it belongs to, or throws.
 *
 * The user is read on every request rather than cached in the token, which is what makes
 * revocation immediate: delete the session row or the user, and the next request fails.
 * Two indexed reads — one on `sessions.tokenHash` (unique), one on `users._id`.
 */
export async function resolveSession(rawToken: string): Promise<AuthenticatedUser> {
  const session = await Session.findOne({ tokenHash: hashSessionToken(rawToken) });

  if (!session) {
    throw ApiError.unauthorized('Invalid or expired session', 'INVALID_SESSION');
  }

  // Checked here rather than relying on the TTL index, which sweeps roughly once a
  // minute — an expired row can outlive its expiry by that much.
  if (session.expiresAt.getTime() <= Date.now()) {
    await Session.deleteOne({ _id: session._id });
    throw ApiError.unauthorized('Session has expired', 'SESSION_EXPIRED');
  }

  const user = await User.findById(session.userId);
  if (!user) {
    // The account was deleted while the session was live. Burn the session rather than
    // leaving a credential that points at nothing.
    await Session.deleteOne({ _id: session._id });
    throw ApiError.unauthorized('Invalid or expired session', 'INVALID_SESSION');
  }

  return { id: String(user._id), email: user.email, role: user.role };
}

export async function logout(rawToken: string | undefined): Promise<void> {
  if (!rawToken) return;
  // A logout with an unknown token is still a successful logout from the caller's point
  // of view — there is nothing to tell them and nothing to protect.
  await Session.deleteOne({ tokenHash: hashSessionToken(rawToken) });
}

/** Ends every session for one user — the lever for "sign out everywhere". */
export async function revokeAllForUser(userId: string): Promise<void> {
  await Session.deleteMany({ userId });
}
