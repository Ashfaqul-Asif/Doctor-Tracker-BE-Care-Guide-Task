import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { cache } from '../src/lib/cache.js';
import { Patient } from '../src/models/Patient.js';
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
  cache.clear();
  auth = await session();
});

describe('GET /api/patients', () => {
  it('401s without a token (FR-3)', async () => {
    const res = await request(app).get('/api/patients');
    expect(res.status).toBe(401);
  });

  it('returns the shared envelope with the doctor attached', async () => {
    const doctor = await createDoctor({ name: 'Alice Nguyen' });
    await createPatient(doctor.id, { name: 'Jordan Fields' });

    const res = await request(app).get('/api/patients').set('Cookie', auth);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, limit: 20, total: 1, totalPages: 1 });
    expect(res.body.data[0]).toMatchObject({ name: 'Jordan Fields', condition: 'Hypertension' });
    expect(res.body.data[0].doctor).toMatchObject({ name: 'Alice Nguyen' });
  });

  it('filters by condition, doctor and name prefix (FR-15)', async () => {
    const alice = await createDoctor({ name: 'Alice Nguyen' });
    const bilal = await createDoctor({ name: 'Bilal Ahmed' });

    await createPatient(alice.id, { name: 'Jordan Fields', condition: 'Hypertension' });
    await createPatient(alice.id, { name: 'Kim Lee', condition: 'Asthma' });
    await createPatient(bilal.id, { name: 'Sam Ortiz', condition: 'Asthma' });

    const byCondition = await request(app)
      .get('/api/patients')
      .query({ condition: 'Asthma' })
      .set('Cookie', auth);
    const byDoctor = await request(app)
      .get('/api/patients')
      .query({ doctorId: alice.id })
      .set('Cookie', auth);
    const bySearch = await request(app)
      .get('/api/patients')
      .query({ search: 'jor' })
      .set('Cookie', auth);

    expect(byCondition.body.total).toBe(2);
    expect(byDoctor.body.total).toBe(2);
    expect(bySearch.body.total).toBe(1);
    expect(bySearch.body.data[0].name).toBe('Jordan Fields');
  });

  it('rejects a malformed doctorId filter', async () => {
    const res = await request(app)
      .get('/api/patients')
      .query({ doctorId: 'nope' })
      .set('Cookie', auth);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/patients', () => {
  it('creates a patient against an existing doctor', async () => {
    const doctor = await createDoctor();

    const res = await request(app)
      .post('/api/patients')
      .set('Cookie', auth)
      .send({
        name: 'Rosa Marino',
        condition: 'Migraine',
        doctorId: doctor.id,
        contactInfo: '+1-555-0155',
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Rosa Marino', doctorId: doctor.id });

    const stored = await Patient.findById(res.body.id).lean();
    expect(stored?.nameTokens).toEqual(['rosa', 'marino']);
    expect(stored?.deletedAt).toBeNull();
  });

  it('refuses a patient with no doctor (FR-16)', async () => {
    const res = await request(app)
      .post('/api/patients')
      .set('Cookie', auth)
      .send({ name: 'Rosa Marino', condition: 'Migraine', contactInfo: '+1-555-0155' });

    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { field: string }) => d.field)).toContain('doctorId');
  });

  it('refuses a patient pointing at a doctor that does not exist', async () => {
    const res = await request(app)
      .post('/api/patients')
      .set('Cookie', auth)
      .send({
        name: 'Rosa Marino',
        condition: 'Migraine',
        doctorId: '64b7f0c2f1a2b3c4d5e6f7a8',
        contactInfo: '+1-555-0155',
      });

    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/patients/:id', () => {
  it('updates a patient and keeps the search mirror in sync', async () => {
    const doctor = await createDoctor();
    const patient = await createPatient(doctor.id, { name: 'Jordan Fields' });

    const res = await request(app)
      .patch(`/api/patients/${patient.id}`)
      .set('Cookie', auth)
      .send({ name: 'Jordan Ellis', condition: 'Asthma' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Jordan Ellis', condition: 'Asthma' });

    const search = await request(app)
      .get('/api/patients')
      .query({ search: 'jordan e' })
      .set('Cookie', auth);
    expect(search.body.total).toBe(1);
  });

  it('can reassign a patient to another doctor', async () => {
    const alice = await createDoctor({ name: 'Alice Nguyen' });
    const bilal = await createDoctor({ name: 'Bilal Ahmed' });
    const patient = await createPatient(alice.id);

    const res = await request(app)
      .patch(`/api/patients/${patient.id}`)
      .set('Cookie', auth)
      .send({ doctorId: bilal.id });

    expect(res.status).toBe(200);
    expect(res.body.doctorId).toBe(bilal.id);
    expect(res.body.doctor.name).toBe('Bilal Ahmed');
  });
});

describe('DELETE /api/patients/:id', () => {
  it('soft-deletes: the row survives, the read paths do not show it (FR-13, FR-17)', async () => {
    const doctor = await createDoctor();
    const patient = await createPatient(doctor.id, { name: 'Jordan Fields' });

    const res = await request(app)
      .delete(`/api/patients/${patient.id}`)
      .set('Cookie', auth);
    expect(res.status).toBe(204);

    const list = await request(app).get('/api/patients').set('Cookie', auth);
    expect(list.body.total).toBe(0);

    const detail = await request(app)
      .get(`/api/patients/${patient.id}`)
      .set('Cookie', auth);
    expect(detail.status).toBe(404);

    // The audit trail is the entire point — the document is still there.
    const stored = await Patient.findById(patient.id).lean();
    expect(stored).not.toBeNull();
    expect(stored?.deletedAt).toBeInstanceOf(Date);
  });

  it('404s when deleting twice', async () => {
    const doctor = await createDoctor();
    const patient = await createPatient(doctor.id);

    await request(app).delete(`/api/patients/${patient.id}`).set('Cookie', auth);
    const second = await request(app)
      .delete(`/api/patients/${patient.id}`)
      .set('Cookie', auth);

    expect(second.status).toBe(404);
  });
});

describe('GET /api/patients/conditions', () => {
  it('returns the distinct conditions that drive the filter dropdown', async () => {
    const doctor = await createDoctor();
    await createPatient(doctor.id, { name: 'A One', condition: 'Migraine' });
    await createPatient(doctor.id, { name: 'B Two', condition: 'Asthma' });
    await createPatient(doctor.id, { name: 'C Three', condition: 'Asthma' });
    await createPatient(doctor.id, { name: 'D Four', condition: 'Gone', deletedAt: new Date() });

    const res = await request(app).get('/api/patients/conditions').set('Cookie', auth);

    expect(res.status).toBe(200);
    expect(res.body.conditions).toEqual(['Asthma', 'Migraine']);
  });
});
