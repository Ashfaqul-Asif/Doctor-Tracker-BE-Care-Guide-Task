import type { RequestHandler } from 'express';
import { ApiError } from '../lib/ApiError.js';

/**
 * NoSQL injection guard (requirements §2 Security). A payload like
 * `{ email: { $ne: null } }` reaching a `find()` is an auth bypass.
 *
 * This middleware *rejects* rather than strips, for two reasons:
 *  1. In Express 5 `req.query` is a getter with no setter, so the usual
 *     sanitize-and-reassign approach (express-mongo-sanitize et al.) throws outright.
 *  2. A request containing Mongo operators is never a legitimate mistake — failing it
 *     loudly beats silently answering a different question than the one asked.
 *
 * Note that `$` is matched anywhere in the key, not just at the start. Express 5
 * defaults its query parser to `simple`, so `?email[$ne]=null` arrives as the single
 * literal key `email[$ne]` rather than a nested object — inert today, but only because
 * of a default that a future `query parser` change would silently flip. No legitimate
 * key in this API contains `$` or `.`, so rejecting both costs nothing.
 */

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_DEPTH = 8;

function findForbiddenKey(value: unknown, depth = 0): string | null {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findForbiddenKey(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (key.includes('$') || key.includes('.') || FORBIDDEN_KEYS.has(key)) return key;
    const found = findForbiddenKey(nested, depth + 1);
    if (found) return found;
  }
  return null;
}

export const rejectOperatorKeys: RequestHandler = (req, _res, next) => {
  for (const source of [req.query, req.body, req.params]) {
    const offender = findForbiddenKey(source);
    if (offender) {
      next(
        new ApiError(
          400,
          'INVALID_INPUT_KEY',
          `Key "${offender}" is not permitted in a request payload.`,
        ),
      );
      return;
    }
  }
  next();
};
