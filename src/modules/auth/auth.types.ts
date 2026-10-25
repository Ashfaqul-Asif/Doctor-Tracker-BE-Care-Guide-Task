/**
 * One role, deliberately.
 *
 * Doctor Tracker is an admin panel: the specification names a single actor ("Admin can…",
 * "Admin Dashboard"), so authentication *is* authorisation — every account that can sign
 * in can do everything. There is no role hierarchy and therefore no role-based 403.
 *
 * `role` is kept on the User document rather than dropped because the data model calls
 * for it, and because it is the seam a second role would arrive through. Widening this
 * union is the first edit that change would make.
 */
export type UserRole = 'admin';

export const USER_ROLES: readonly UserRole[] = ['admin'] as const;

/** What `authenticate` attaches to the request once a token checks out. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
}

// No token payload types: the session token carries no claims. Everything known about a
// caller is read from `sessions` and `users` at request time — see `resolveSession`.
