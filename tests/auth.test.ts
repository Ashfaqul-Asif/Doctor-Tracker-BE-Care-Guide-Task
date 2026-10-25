import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { hashSessionToken } from '../src/lib/sessionToken.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { authenticate } from '../src/middleware/authenticate.js';
import { resetRateLimits } from '../src/middleware/rateLimit.js';
import { SESSION_COOKIE_NAME } from '../src/modules/auth/auth.controller.js';
import { Session } from '../src/models/Session.js';
import { User } from '../src/models/User.js';
import { clearCollections, setupTestDatabase, teardownTestDatabase } from './helpers/db.js';
import { createUser, extractSessionCookie, TEST_PASSWORD } from './helpers/factories.js';

const app = createApp();

/**
 * A minimal app exercising `authenticate` on its own, so the session contract is tested
 * at the middleware rather than smuggled in through whichever feature route exists.
 *
 * There is no `requireRole` to pair it with: this is a single-role admin panel, so an
 * active session is the whole of the authorisation decision.
 */
function guardedApp() {
  const guarded = express();
  guarded.get('/protected', authenticate, (req, res) => {
    res.json({ ok: true, user: req.user });
  });
  guarded.use(errorHandler);
  return guarded;
}

async function login(email: string, password: string) {
  return request(app).post('/api/auth/login').send({ email, password });
}

beforeAll(async () => {
  await setupTestDatabase();
});

afterAll(async () => {
  await teardownTestDatabase();
});

beforeEach(async () => {
  await clearCollections();
  await resetRateLimits();
});

describe('POST /api/auth/login', () => {
  it('sets an httpOnly session cookie and returns the user', async () => {
    const user = await createUser();

    const res = await login(user.email, TEST_PASSWORD);

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: user.email, role: 'admin' });

    const cookies = res.headers['set-cookie'] as unknown as string[];
    const sessionCookie = cookies.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain('HttpOnly');
    // Path=/ because this cookie authenticates every API call, not just the auth routes.
    expect(sessionCookie).toContain('Path=/');
  });

  it('never puts the session token in the response body', async () => {
    const user = await createUser();

    const res = await login(user.email, TEST_PASSWORD);

    // The credential belongs in the cookie and nowhere else — a copy in the body would
    // be readable by JavaScript, which is precisely what httpOnly is preventing.
    const raw = extractSessionCookie(res) ?? '';
    const token = raw.split('=')[1] ?? 'no-token';
    expect(JSON.stringify(res.body)).not.toContain(token);
    expect(res.body.accessToken).toBeUndefined();
  });

  it('never returns the password hash', async () => {
    const user = await createUser();

    const res = await login(user.email, TEST_PASSWORD);

    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it('stores only a hash of the session token', async () => {
    const user = await createUser();

    const res = await login(user.email, TEST_PASSWORD);
    const token = (extractSessionCookie(res) ?? '').split('=')[1] ?? '';

    // A leaked database must not yield anything presentable.
    const stored = await Session.findOne({});
    expect(stored?.tokenHash).toBe(hashSessionToken(token));
    expect(stored?.tokenHash).not.toBe(token);
  });

  it('rejects a wrong password with 401', async () => {
    const user = await createUser();

    const res = await login(user.email, 'not-the-password');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(await Session.countDocuments({})).toBe(0);
  });

  it('gives an unknown email the same 401 as a wrong password', async () => {
    const res = await login('nobody@careguide.test', TEST_PASSWORD);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('validates the request body', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { field: string }) => d.field)).toContain('password');
  });

  it('rate-limits repeated attempts from one IP (FR-6)', async () => {
    const user = await createUser();

    for (let attempt = 0; attempt < env.LOGIN_RATE_MAX; attempt += 1) {
      const res = await login(user.email, 'wrong-password');
      expect(res.status).toBe(401);
    }

    const blocked = await login(user.email, TEST_PASSWORD);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('TOO_MANY_REQUESTS');
  });
});

describe('GET /api/auth/me', () => {
  it('answers who the cookie belongs to', async () => {
    const user = await createUser();
    const cookie = extractSessionCookie(await login(user.email, TEST_PASSWORD)) ?? '';

    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: user.email, role: 'admin' });
  });

  it('401s with no cookie — this is how the client learns it is signed out', async () => {
    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('NO_SESSION');
  });
});

describe('POST /api/auth/logout', () => {
  it('deletes the session so the cookie stops working immediately', async () => {
    const user = await createUser();
    const cookie = extractSessionCookie(await login(user.email, TEST_PASSWORD)) ?? '';

    const res = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect(res.status).toBe(204);

    expect(await Session.countDocuments({})).toBe(0);

    // Revocation is immediate — there is no window where a spent credential still works.
    const after = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(after.status).toBe(401);
  });

  it('succeeds even with no active session', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(204);
  });
});

describe('authenticate', () => {
  const guarded = guardedApp();

  it('401s with no cookie (FR-5)', async () => {
    const res = await request(guarded).get('/protected');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('NO_SESSION');
  });

  it('401s with a token that matches no session', async () => {
    const res = await request(guarded)
      .get('/protected')
      .set('Cookie', `${SESSION_COOKIE_NAME}=not-a-real-token`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_SESSION');
  });

  it('lets a signed-in user through', async () => {
    const user = await createUser();
    const cookie = extractSessionCookie(await login(user.email, TEST_PASSWORD)) ?? '';

    const res = await request(guarded).get('/protected').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(user.email);
    expect(res.body.user.role).toBe('admin');
  });

  it('401s once the session has expired', async () => {
    const user = await createUser();
    const cookie = extractSessionCookie(await login(user.email, TEST_PASSWORD)) ?? '';

    // Backdated rather than waited out: the TTL index sweeps about once a minute, so
    // `resolveSession` checks `expiresAt` on read instead of trusting the row's absence.
    await Session.updateOne({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    const res = await request(guarded).get('/protected').set('Cookie', cookie);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('401s immediately once the user is deleted', async () => {
    const user = await createUser();
    const cookie = extractSessionCookie(await login(user.email, TEST_PASSWORD)) ?? '';

    await User.deleteMany({});

    // The advantage of server-side sessions over a signed token: no window in which a
    // deleted account still has access.
    const res = await request(guarded).get('/protected').set('Cookie', cookie);

    expect(res.status).toBe(401);
    expect(await Session.countDocuments({})).toBe(0);
  });
});
