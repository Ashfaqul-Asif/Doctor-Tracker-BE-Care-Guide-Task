import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { cache } from '../src/lib/cache.js';
import { clearCollections, setupTestDatabase, teardownTestDatabase } from './helpers/db.js';
import { createDoctor, createPatient, session } from './helpers/factories.js';

const app = createApp();

// Rebuilt per test: `clearCollections` drops the rows `authenticate` reads.
let auth: string;

beforeAll(async () => {
  await setupTestDatabase();
});

afterAll(async () => {
  await teardownTestDatabase();
});

beforeEach(async () => {
  await clearCollections();
  // Aggregates are cached for minutes; without this the previous test's numbers would
  // be served against this test's data.
  cache.clear();
  auth = await session();
});

describe('GET /api/dashboard/summary', () => {
  it('401s without a token (FR-3)', async () => {
    const res = await request(app).get('/api/dashboard/summary');
    expect(res.status).toBe(401);
  });

  it('aggregates totals server-side (FR-18, FR-19)', async () => {
    const alice = await createDoctor({ name: 'Alice Nguyen' });
    const bilal = await createDoctor({ name: 'Bilal Ahmed' });
    await createDoctor({ name: 'Chen Wu' }); // deliberately has no patients

    for (let i = 0; i < 5; i += 1) {
      await createPatient(alice.id, { name: `Alice Patient ${i}` });
    }
    await createPatient(bilal.id, { name: 'Bilal Patient' });

    const res = await request(app).get('/api/dashboard/summary').set('Cookie', auth);

    expect(res.status).toBe(200);
    expect(res.body.totals).toMatchObject({ doctors: 3, patients: 6 });
    expect(res.body.totals.averagePatientsPerDoctor).toBe(2);
  });

  it('excludes soft-deleted patients from every total', async () => {
    const doctor = await createDoctor();
    await createPatient(doctor.id, { name: 'Live One' });
    await createPatient(doctor.id, { name: 'Removed One', deletedAt: new Date() });

    const res = await request(app).get('/api/dashboard/summary').set('Cookie', auth);

    expect(res.body.totals.patients).toBe(1);
  });

  it('ranks the top doctors by patient count', async () => {
    const alice = await createDoctor({ name: 'Alice Nguyen' });
    const bilal = await createDoctor({ name: 'Bilal Ahmed' });

    await createPatient(bilal.id, { name: 'B One' });
    for (let i = 0; i < 3; i += 1) {
      await createPatient(alice.id, { name: `A ${i}` });
    }

    const res = await request(app).get('/api/dashboard/summary').set('Cookie', auth);

    expect(res.body.topDoctors[0]).toMatchObject({ name: 'Alice Nguyen', patients: 3 });
    expect(res.body.topDoctors[1]).toMatchObject({ name: 'Bilal Ahmed', patients: 1 });
  });

  it('counts doctors with no patients in the distribution', async () => {
    const alice = await createDoctor({ name: 'Alice Nguyen' });
    await createDoctor({ name: 'Chen Wu' });
    await createDoctor({ name: 'Dara Fox' });
    await createPatient(alice.id, { name: 'Only Patient' });

    const res = await request(app).get('/api/dashboard/summary').set('Cookie', auth);

    const zeroBucket = res.body.distribution.find((b: { bucket: string }) => b.bucket === '0');
    expect(zeroBucket.doctors).toBe(2);
  });

  it('reflects new data once a mutation invalidates the cache (FR-20)', async () => {
    const doctor = await createDoctor();
    await createPatient(doctor.id, { name: 'First Patient' });

    const before = await request(app).get('/api/dashboard/summary').set('Cookie', auth);
    expect(before.body.totals.patients).toBe(1);

    await request(app)
      .post('/api/patients')
      .set('Cookie', auth)
      .send({
        name: 'Second Patient',
        condition: 'Asthma',
        doctorId: doctor.id,
        contactInfo: '+1-555-0199',
      });

    // A cache that isn't invalidated on write would still report 1 here.
    const after = await request(app).get('/api/dashboard/summary').set('Cookie', auth);
    expect(after.body.totals.patients).toBe(2);
  });
});

describe('GET /api/dashboard/timeseries', () => {
  it('buckets registrations by day and fills empty days with zero', async () => {
    const doctor = await createDoctor();
    await createPatient(doctor.id, {
      name: 'Day One',
      createdAt: new Date('2026-03-01T10:00:00.000Z'),
    });
    await createPatient(doctor.id, {
      name: 'Day Three A',
      createdAt: new Date('2026-03-03T10:00:00.000Z'),
    });
    await createPatient(doctor.id, {
      name: 'Day Three B',
      createdAt: new Date('2026-03-03T18:00:00.000Z'),
    });

    const res = await request(app)
      .get('/api/dashboard/timeseries')
      .query({ interval: 'day', from: '2026-03-01', to: '2026-03-03' })
      .set('Cookie', auth);

    expect(res.status).toBe(200);
    expect(res.body.interval).toBe('day');
    expect(res.body.points).toHaveLength(3);
    expect(res.body.points.map((p: { count: number }) => p.count)).toEqual([1, 0, 2]);
  });

  it('buckets by month', async () => {
    const doctor = await createDoctor();
    await createPatient(doctor.id, {
      name: 'Jan One',
      createdAt: new Date('2026-01-10T10:00:00.000Z'),
    });
    await createPatient(doctor.id, {
      name: 'Jan Two',
      createdAt: new Date('2026-01-25T10:00:00.000Z'),
    });
    await createPatient(doctor.id, {
      name: 'Mar One',
      createdAt: new Date('2026-03-05T10:00:00.000Z'),
    });

    const res = await request(app)
      .get('/api/dashboard/timeseries')
      .query({ interval: 'month', from: '2026-01-01', to: '2026-03-31' })
      .set('Cookie', auth);

    expect(res.body.points).toHaveLength(3);
    expect(res.body.points.map((p: { count: number }) => p.count)).toEqual([2, 0, 1]);
  });

  it('rejects an unsupported interval', async () => {
    const res = await request(app)
      .get('/api/dashboard/timeseries')
      .query({ interval: 'fortnight' })
      .set('Cookie', auth);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
