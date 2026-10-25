import type { Response } from 'supertest';
import { tokenizeName } from '../../src/lib/nameSearch.js';
import { hashSessionToken, newSessionToken } from '../../src/lib/sessionToken.js';
import { Doctor } from '../../src/models/Doctor.js';
import { Patient } from '../../src/models/Patient.js';
import { Session } from '../../src/models/Session.js';
import { User } from '../../src/models/User.js';
import { hashPassword } from '../../src/modules/auth/auth.service.js';
import type { UserRole } from '../../src/modules/auth/auth.types.js';
import { SESSION_COOKIE_NAME } from '../../src/modules/auth/auth.controller.js';

export const TEST_PASSWORD = 'Str0ngPassw0rd!';

export async function createUser(
  overrides: { email?: string; password?: string; role?: UserRole } = {},
): Promise<{ id: string; email: string; role: UserRole; password: string }> {
  const email = overrides.email ?? 'admin@careguide.test';
  const password = overrides.password ?? TEST_PASSWORD;
  const role = overrides.role ?? 'admin';

  const user = await User.create({ email, passwordHash: await hashPassword(password), role });
  return { id: String(user._id), email: user.email, role: user.role, password };
}

/**
 * An active session as a ready-to-send `Cookie` header, without going through login.
 *
 * `authenticate` resolves the session against the database, so — unlike the signed token
 * this replaces — a real `users` row and a real `sessions` row have to exist. Creating
 * them directly still skips bcrypt and the login rate limiter, which is the point: the
 * login flow itself is covered properly in auth.test.ts.
 */
export async function session(overrides: { email?: string } = {}): Promise<string> {
  const user = await createUser(overrides);
  const token = newSessionToken();

  await Session.create({
    userId: user.id,
    tokenHash: hashSessionToken(token),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });

  return `${SESSION_COOKIE_NAME}=${token}`;
}

export async function createDoctor(
  overrides: Partial<{
    name: string;
    specialization: string;
    hospital: string;
    phone: string;
    email: string;
    createdAt: Date;
  }> = {},
) {
  const name = overrides.name ?? 'Alice Nguyen';
  return Doctor.create({
    name,
    nameTokens: tokenizeName(name),
    specialization: overrides.specialization ?? 'Cardiology',
    hospital: overrides.hospital ?? 'St. Mary General',
    phone: overrides.phone ?? '+1-555-0100',
    email: overrides.email ?? `${name.toLowerCase().replace(/\s+/g, '.')}@hospital.test`,
    deletedAt: null,
    ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
  });
}

export async function createPatient(
  doctorId: string,
  overrides: Partial<{
    name: string;
    condition: string;
    contactInfo: string;
    createdAt: Date;
    deletedAt: Date | null;
  }> = {},
) {
  const name = overrides.name ?? 'Jordan Fields';
  return Patient.create({
    name,
    nameTokens: tokenizeName(name),
    condition: overrides.condition ?? 'Hypertension',
    doctorId,
    contactInfo: overrides.contactInfo ?? 'jordan@example.test',
    deletedAt: overrides.deletedAt ?? null,
    ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
  });
}

/** Pulls the session cookie out of a `Set-Cookie` header for replay in the next request. */
export function extractSessionCookie(res: Response): string | undefined {
  const raw = res.headers['set-cookie'];
  const cookies: string[] = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  const match = cookies.find((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`));
  return match?.split(';')[0];
}
