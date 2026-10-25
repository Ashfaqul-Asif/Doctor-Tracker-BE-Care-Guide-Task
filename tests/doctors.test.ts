import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { cache } from '../src/lib/cache.js';
import { Doctor } from '../src/models/Doctor.js';
import { clearCollections, setupTestDatabase, teardownTestDatabase } from './helpers/db.js';
import { createDoctor, createPatient, session } from './helpers/factories.js';

const app = createApp();

// Rebuilt per test rather than once: `clearCollections` drops the `sessions` and `users`
// rows that `authenticate` now reads, so a module-level session would go stale after the
// first case.
let auth: string;

beforeAll(async () => {
  await setupTestDatabase();
});

afterAll(async () => {
  await teardownTestDatabase();
});

beforeEach(async () => {
  await clearCollections();
  // The facet cache outlives the data between tests — clearing collections without
  // clearing this would serve the previous test's dropdown values.
  cache.clear();
  auth = await session();
});

describe('GET /api/doctors', () => {
  it('401s without a token (FR-3)', async () => {
    const res = await request(app).get('/api/doctors');
    expect(res.status).toBe(401);
  });

  it('returns the shared pagination envelope', async () => {
    await createDoctor({ name: 'Alice Nguyen' });

    const res = await request(app).get('/api/doctors').set('Cookie', auth);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, limit: 20, total: 1, totalPages: 1 });
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ name: 'Alice Nguyen', specialization: 'Cardiology' });
    expect(res.body.data[0].id).toBeTruthy();
    // The search token mirror is an implementation detail, not part of the contract.
    expect(res.body.data[0].nameTokens).toBeUndefined();
  });

  it('paginates server-side (FR-8)', async () => {
    for (let i = 0; i < 25; i += 1) {
      await createDoctor({ name: `Doctor Number ${String(i).padStart(2, '0')}` });
    }

    const res = await request(app)
      .get('/api/doctors')
      .query({ page: 2, limit: 10 })
      .set('Cookie', auth);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(10);
    expect(res.body).toMatchObject({ page: 2, limit: 10, total: 25, totalPages: 3 });
  });

  it('caps an oversized page limit rather than honouring it', async () => {
    const res = await request(app)
      .get('/api/doctors')
      .query({ limit: 5000 })
      .set('Cookie', auth);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('searches by name, case-insensitively (FR-9)', async () => {
    await createDoctor({ name: 'Alice Nguyen' });
    await createDoctor({ name: 'Bilal Ahmed' });

    const lower = await request(app)
      .get('/api/doctors')
      .query({ search: 'ali' })
      .set('Cookie', auth);
    const upper = await request(app)
      .get('/api/doctors')
      .query({ search: 'ALI' })
      .set('Cookie', auth);

    expect(lower.body.total).toBe(1);
    expect(lower.body.data[0].name).toBe('Alice Nguyen');
    expect(upper.body.total).toBe(1);
  });

  it('finds a doctor by surname, not just first name', async () => {
    await createDoctor({ name: 'Alice Nguyen' });
    await createDoctor({ name: 'Bilal Ahmed' });

    for (const term of ['nguyen', 'Nguyen', 'ngu']) {
      const res = await request(app)
        .get('/api/doctors')
        .query({ search: term })
        .set('Cookie', auth);

      expect(res.body.total, `searching "${term}"`).toBe(1);
      expect(res.body.data[0].name).toBe('Alice Nguyen');
    }
  });

  it('requires every word of a multi-word search to match', async () => {
    await createDoctor({ name: 'Alice Nguyen' });
    await createDoctor({ name: 'Alice Cooper' });

    const both = await request(app)
      .get('/api/doctors')
      .query({ search: 'alice' })
      .set('Cookie', auth);
    const narrowed = await request(app)
      .get('/api/doctors')
      .query({ search: 'alice ngu' })
      .set('Cookie', auth);

    expect(both.body.total).toBe(2);
    expect(narrowed.body.total).toBe(1);
    expect(narrowed.body.data[0].name).toBe('Alice Nguyen');
  });

  it('matches from the start of a word, not mid-word', async () => {
    // The deliberate trade-off: anchoring is what keeps the query on an index.
    // See docs/decisions/002-search-and-indexing.md.
    await createDoctor({ name: 'Alice Nguyen' });

    const res = await request(app)
      .get('/api/doctors')
      .query({ search: 'lice' })
      .set('Cookie', auth);

    expect(res.body.total).toBe(0);
  });

  it('treats regex metacharacters in the search term as literals', async () => {
    await createDoctor({ name: 'Alice Nguyen' });

    const res = await request(app)
      .get('/api/doctors')
      .query({ search: '.*' })
      .set('Cookie', auth);

    expect(res.body.total).toBe(0);
  });

  it('filters by specialization and hospital (FR-10)', async () => {
    await createDoctor({ name: 'Cardio One', specialization: 'Cardiology' });
    await createDoctor({ name: 'Neuro One', specialization: 'Neurology', hospital: 'Riverside' });

    const bySpecialization = await request(app)
      .get('/api/doctors')
      .query({ specialization: 'Neurology' })
      .set('Cookie', auth);
    const byHospital = await request(app)
      .get('/api/doctors')
      .query({ hospital: 'Riverside' })
      .set('Cookie', auth);

    expect(bySpecialization.body.total).toBe(1);
    expect(bySpecialization.body.data[0].name).toBe('Neuro One');
    expect(byHospital.body.total).toBe(1);
  });

  it('filters by a createdAt range, treating `to` as inclusive of the whole day', async () => {
    await createDoctor({ name: 'January Doctor', createdAt: new Date('2026-01-31T18:00:00.000Z') });
    await createDoctor({ name: 'June Doctor', createdAt: new Date('2026-06-15T09:00:00.000Z') });

    const res = await request(app)
      .get('/api/doctors')
      .query({ from: '2026-01-01', to: '2026-01-31' })
      .set('Cookie', auth);

    // A naive `$lte: midnight` would drop the 18:00 record and silently return nothing.
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].name).toBe('January Doctor');
  });
});

describe('POST /api/doctors', () => {
  it('creates a doctor', async () => {
    const res = await request(app)
      .post('/api/doctors')
      .set('Cookie', auth)
      .send({
        name: 'Priya Raman',
        specialization: 'Oncology',
        hospital: 'Northfield',
        phone: '+1-555-0111',
        email: 'priya@hospital.test',
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Priya Raman', specialization: 'Oncology' });

    // The search mirror must be populated on the create path too.
    const stored = await Doctor.findById(res.body.id).lean();
    expect(stored?.nameTokens).toEqual(['priya', 'raman']);
  });

  it('rejects an invalid payload with field-level detail', async () => {
    const res = await request(app)
      .post('/api/doctors')
      .set('Cookie', auth)
      .send({ name: 'X', specialization: 'Oncology', hospital: 'N', phone: '1', email: 'nope' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const fields = res.body.error.details.map((d: { field: string }) => d.field);
    expect(fields).toContain('name');
    expect(fields).toContain('email');
  });
});

describe('GET /api/doctors/:id', () => {
  it('returns the doctor with a live patient count', async () => {
    const doctor = await createDoctor({ name: 'Alice Nguyen' });
    await createPatient(doctor.id, { name: 'Patient One' });
    await createPatient(doctor.id, { name: 'Patient Two', deletedAt: new Date() });

    const res = await request(app).get(`/api/doctors/${doctor.id}`).set('Cookie', auth);

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Alice Nguyen');
    // The soft-deleted patient must not be counted.
    expect(res.body.patientCount).toBe(1);
  });

  it('404s for an unknown id and 400s for a malformed one', async () => {
    const missing = await request(app)
      .get('/api/doctors/64b7f0c2f1a2b3c4d5e6f7a8')
      .set('Cookie', auth);
    const malformed = await request(app).get('/api/doctors/not-an-id').set('Cookie', auth);

    expect(missing.status).toBe(404);
    expect(malformed.status).toBe(400);
  });
});

describe('PATCH /api/doctors/:id', () => {
  it('updates fields and keeps the search mirror in sync', async () => {
    const doctor = await createDoctor({ name: 'Alice Nguyen' });

    const res = await request(app)
      .patch(`/api/doctors/${doctor.id}`)
      .set('Cookie', auth)
      .send({ name: 'Alice Okafor' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Alice Okafor');

    // If `nameTokens` didn't follow the rename, search would quietly stop finding her.
    const search = await request(app)
      .get('/api/doctors')
      .query({ search: 'okafor' })
      .set('Cookie', auth);
    expect(search.body.total).toBe(1);
  });

  it('rejects an empty update', async () => {
    const doctor = await createDoctor();

    const res = await request(app)
      .patch(`/api/doctors/${doctor.id}`)
      .set('Cookie', auth)
      .send({});

    expect(res.status).toBe(400);
  });
});

describe('GET /api/doctors/:id/patients', () => {
  it('paginates that doctor\'s patients and excludes soft-deleted ones (FR-11)', async () => {
    const doctor = await createDoctor({ name: 'Alice Nguyen' });
    const other = await createDoctor({ name: 'Bilal Ahmed' });

    for (let i = 0; i < 12; i += 1) {
      await createPatient(doctor.id, { name: `Patient ${String(i).padStart(2, '0')}` });
    }
    await createPatient(doctor.id, { name: 'Removed Patient', deletedAt: new Date() });
    await createPatient(other.id, { name: 'Someone Else' });

    const res = await request(app)
      .get(`/api/doctors/${doctor.id}/patients`)
      .query({ page: 1, limit: 10 })
      .set('Cookie', auth);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, limit: 10, total: 12, totalPages: 2 });
    expect(res.body.data).toHaveLength(10);
    expect(res.body.data.every((p: { doctorId: string }) => p.doctorId === doctor.id)).toBe(true);
  });

  it('404s for an unknown doctor', async () => {
    const res = await request(app)
      .get('/api/doctors/64b7f0c2f1a2b3c4d5e6f7a8/patients')
      .set('Cookie', auth);

    expect(res.status).toBe(404);
  });
});

describe('GET /api/doctors/facets', () => {
  it('returns sorted distinct specializations and hospitals', async () => {
    await createDoctor({ name: 'One', specialization: 'Neurology', hospital: 'Riverside' });
    await createDoctor({ name: 'Two', specialization: 'Cardiology', hospital: 'Riverside' });

    const res = await request(app).get('/api/doctors/facets').set('Cookie', auth);

    expect(res.status).toBe(200);
    expect(res.body.specializations).toEqual(['Cardiology', 'Neurology']);
    expect(res.body.hospitals).toEqual(['Riverside']);
  });
});

describe('duplicate doctor emails', () => {
  it('409s rather than creating a second doctor with the same address', async () => {
    const payload = {
      name: 'Alice Nguyen',
      specialization: 'Cardiology',
      hospital: 'St. Mary General',
      phone: '+1-555-0100',
      email: 'alice.nguyen@hospital.test',
    };

    const first = await request(app).post('/api/doctors').set('Cookie', auth).send(payload);
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/doctors')
      .set('Cookie', auth)
      .send({ ...payload, name: 'Someone Else' });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('DUPLICATE_KEY');
    expect(await Doctor.countDocuments({})).toBe(1);
  });
});

describe('doctor deletion', () => {
  it('is not exposed — deletion was confirmed out of scope', async () => {
    const doctor = await createDoctor();

    const res = await request(app).delete(`/api/doctors/${doctor.id}`).set('Cookie', auth);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
  });
});
