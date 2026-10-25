import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

/**
 * Foundation-level guarantees that hold with no database attached: the app boots, the
 * error envelope is consistent, and the NoSQL-injection guard fires before any handler.
 */
const app = createApp();

describe('foundation', () => {
  it('reports health', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body).toHaveProperty('db');
  });

  it('sets security headers via helmet', async () => {
    const res = await request(app).get('/api/health');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers).not.toHaveProperty('x-powered-by');
  });

  it('returns the standard error envelope for unknown routes', async () => {
    const res = await request(app).get('/api/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
    expect(typeof res.body.error.message).toBe('string');
  });

  it('rejects Mongo operator keys in the query string', async () => {
    const res = await request(app).get('/api/health').query({ 'email[$ne]': 'null' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_INPUT_KEY');
  });

  it('rejects Mongo operator keys nested in a JSON body', async () => {
    const res = await request(app)
      .post('/api/health')
      .send({ filter: { name: { $where: 'sleep(1000)' } } });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_INPUT_KEY');
  });

  it('rejects prototype-pollution keys', async () => {
    // Sent as a raw string on purpose: the object literal `{ __proto__: ... }` sets the
    // prototype rather than an own property, so it would serialize to `{}`.
    const res = await request(app)
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{"__proto__":{"admin":true}}');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_INPUT_KEY');
  });
});
