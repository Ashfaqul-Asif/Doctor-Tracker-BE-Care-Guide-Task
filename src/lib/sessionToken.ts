import crypto from 'node:crypto';

/**
 * Session token minting and hashing.
 *
 * There is deliberately no signing here, and therefore no secret. A session token
 * carries no claims — it is an unguessable pointer at a row in `sessions`, and every
 * fact about the caller comes from that row and the user it references. Nothing is
 * encoded in the token, so nothing can be forged by anyone who does not already hold it.
 */

/**
 * 32 bytes from the CSPRNG — 256 bits of entropy, the same order as the SHA-256 that
 * stores it. Brute-forcing this space is not a threat model anyone needs to plan for,
 * and `randomBytes` (unlike `Math.random`) is safe to base a credential on.
 */
const TOKEN_BYTES = 32;

export function newSessionToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

/**
 * Tokens are stored hashed, never in the clear.
 *
 * Plain SHA-256 rather than bcrypt, deliberately: bcrypt's cost is there to slow down
 * guessing a *low-entropy human password*. A 256-bit random token has nothing to guess,
 * so the work factor would buy no security and would add ~200ms to every authenticated
 * request.
 */
export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
