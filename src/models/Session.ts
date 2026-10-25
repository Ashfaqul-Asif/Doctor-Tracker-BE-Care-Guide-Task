import { model, Schema, type HydratedDocument, type Model, type Types } from 'mongoose';

/**
 * Server-side sessions.
 *
 * The session token is an opaque random string, not a JWT. That choice is what removes
 * the signing secret from the deployment entirely — there is no key to store, rotate or
 * leak, because nothing is signed. The trade is a database read per authenticated
 * request, which for an admin panel is a lookup on a unique index and not worth
 * optimising away.
 *
 * Only the SHA-256 of the token is persisted, exactly as with `passwordHash`. A leaked
 * database yields nothing a caller could present: the raw token exists only in the
 * user's cookie.
 *
 * Revocation is immediate and total — deleting the row ends the session on the very next
 * request. A signed token cannot offer that; it stays valid until it expires.
 */
export interface SessionAttrs {
  userId: Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type SessionDocument = HydratedDocument<SessionAttrs>;

const sessionSchema = new Schema<SessionAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

/**
 * Mongo reaps expired sessions itself, so there is no cleanup job to forget to run.
 *
 * The reaper is not the authority on expiry — it runs about once a minute, so
 * `authenticate` still checks `expiresAt` on read rather than trusting the row's absence.
 */
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session: Model<SessionAttrs> = model<SessionAttrs>('Session', sessionSchema);
