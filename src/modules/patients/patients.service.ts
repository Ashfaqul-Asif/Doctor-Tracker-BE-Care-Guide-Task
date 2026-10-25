import type { FilterQuery } from 'mongoose';
import { Doctor } from '../../models/Doctor.js';
import { Patient, type PatientAttrs } from '../../models/Patient.js';
import { ApiError } from '../../lib/ApiError.js';
import { cache, CacheKeys, invalidateDerivedCaches } from '../../lib/cache.js';
import { env } from '../../config/env.js';
import { nameTokenFilter, tokenizeName } from '../../lib/nameSearch.js';
import { paginate, toSkip, type Paginated } from '../../lib/pagination.js';
import { buildDateRange } from '../../lib/queryPrimitives.js';
import type {
  CreatePatientBody,
  ListPatientsQuery,
  UpdatePatientBody,
} from './patients.schema.js';

export interface PatientDoctorSummary {
  id: string;
  name: string;
  specialization: string;
}

export interface PatientDTO {
  id: string;
  name: string;
  condition: string;
  doctorId: string;
  contactInfo: string;
  createdAt: string;
  updatedAt: string;
  doctor?: PatientDoctorSummary | null;
}

type LeanPatient = PatientAttrs & { _id: unknown };

function toPatientDTO(patient: LeanPatient, doctor?: PatientDoctorSummary | null): PatientDTO {
  const dto: PatientDTO = {
    id: String(patient._id),
    name: patient.name,
    condition: patient.condition,
    doctorId: String(patient.doctorId),
    contactInfo: patient.contactInfo,
    createdAt: patient.createdAt.toISOString(),
    updatedAt: patient.updatedAt.toISOString(),
  };
  if (doctor !== undefined) dto.doctor = doctor;
  return dto;
}

export function buildPatientFilter(query: ListPatientsQuery): FilterQuery<PatientAttrs> {
  // `deletedAt: null` leads every filter, matching the leading field of every compound
  // index on the collection — and keeping soft-deleted rows out of every read path.
  const filter: FilterQuery<PatientAttrs> = { deletedAt: null };

  if (query.search) {
    // Per-word anchored match against the multikey `nameTokens` index — identical
    // semantics to the doctors list, because both go through the same builder.
    const tokens = nameTokenFilter(query.search);
    if (tokens) filter.nameTokens = tokens;
  }
  if (query.condition) filter.condition = query.condition;
  if (query.doctorId) filter.doctorId = query.doctorId;

  const createdAt = buildDateRange(query.from, query.to);
  if (createdAt) filter.createdAt = createdAt;

  return filter;
}

/**
 * Resolves doctor summaries for a page of patients in one extra query keyed by `_id`,
 * rather than letting `populate` fan out per document.
 */
async function attachDoctors(patients: LeanPatient[]): Promise<Map<string, PatientDoctorSummary>> {
  const ids = [...new Set(patients.map((patient) => String(patient.doctorId)))];
  if (ids.length === 0) return new Map();

  const doctors = await Doctor.find({ _id: { $in: ids } })
    .select('name specialization')
    .lean();

  return new Map(
    doctors.map((doctor) => [
      String(doctor._id),
      { id: String(doctor._id), name: doctor.name, specialization: doctor.specialization },
    ]),
  );
}

export async function listPatients(
  query: ListPatientsQuery,
  options: { includeDoctor?: boolean } = {},
): Promise<Paginated<PatientDTO>> {
  const { includeDoctor = true } = options;
  const filter = buildPatientFilter(query);

  const [patients, total] = await Promise.all([
    Patient.find(filter)
      .sort({ createdAt: -1 })
      .skip(toSkip(query.page, query.limit))
      .limit(query.limit)
      .lean<LeanPatient[]>(),
    Patient.countDocuments(filter),
  ]);

  if (!includeDoctor) {
    return paginate(
      patients.map((patient) => toPatientDTO(patient)),
      { page: query.page, limit: query.limit, total },
    );
  }

  const doctors = await attachDoctors(patients);
  return paginate(
    patients.map((patient) => toPatientDTO(patient, doctors.get(String(patient.doctorId)) ?? null)),
    { page: query.page, limit: query.limit, total },
  );
}

export async function getPatient(id: string): Promise<PatientDTO> {
  const patient = await Patient.findOne({ _id: id, deletedAt: null }).lean<LeanPatient | null>();
  if (!patient) throw ApiError.notFound('Patient');

  const doctors = await attachDoctors([patient]);
  return toPatientDTO(patient, doctors.get(String(patient.doctorId)) ?? null);
}

/**
 * Validates the assignment and returns the summary in one read.
 *
 * A bare existence check would have to be followed by a second lookup to build the
 * response, so this returns what it found rather than a boolean. Deliberately a 400 and
 * not a 404: the patient's `doctorId` is a field of the submitted body, so the caller's
 * *input* is what is wrong.
 */
async function requireDoctor(doctorId: string): Promise<PatientDoctorSummary> {
  const doctor = await Doctor.findOne({ _id: doctorId, deletedAt: null })
    .select('name specialization')
    .lean();

  if (!doctor) {
    throw ApiError.badRequest('That doctor does not exist', [
      { field: 'doctorId', message: 'No live doctor with that id' },
    ]);
  }

  return { id: String(doctor._id), name: doctor.name, specialization: doctor.specialization };
}

export async function createPatient(body: CreatePatientBody): Promise<PatientDTO> {
  // The validation read already returned the doctor, and `Patient.create` returns the
  // row it wrote — so the response can be assembled from what is in hand. Re-reading via
  // `getPatient` here cost two extra round trips for data neither call could change.
  const doctor = await requireDoctor(body.doctorId);

  const created = await Patient.create({
    ...body,
    nameTokens: tokenizeName(body.name),
    deletedAt: null,
  });

  invalidateDerivedCaches();
  return toPatientDTO(created.toObject(), doctor);
}

export async function updatePatient(id: string, body: UpdatePatientBody): Promise<PatientDTO> {
  // A reassignment validates the incoming doctor and yields its summary at the same
  // time; an update that leaves the assignment alone still has to look it up afterwards.
  const reassignedTo = body.doctorId ? await requireDoctor(body.doctorId) : undefined;

  const updated = await Patient.findOneAndUpdate(
    { _id: id, deletedAt: null },
    { $set: body },
    { new: true, runValidators: true },
  ).lean<LeanPatient | null>();

  if (!updated) throw ApiError.notFound('Patient');

  invalidateDerivedCaches();

  if (reassignedTo) return toPatientDTO(updated, reassignedTo);

  const doctors = await attachDoctors([updated]);
  return toPatientDTO(updated, doctors.get(String(updated.doctorId)) ?? null);
}

/**
 * FR-13 / FR-17: soft delete. The row stays so dashboard history stays truthful and
 * there is an audit trail; every read path filters `deletedAt: null`.
 */
export async function softDeletePatient(id: string): Promise<void> {
  const result = await Patient.updateOne(
    { _id: id, deletedAt: null },
    { $set: { deletedAt: new Date() } },
  );

  if (result.matchedCount === 0) throw ApiError.notFound('Patient');
  invalidateDerivedCaches();
}

/**
 * Distinct conditions, for the filter dropdown. Conditions are free text (confirmed
 * with the client), so the option list has to come from the data rather than an enum.
 */
export async function listConditions(): Promise<string[]> {
  return cache.wrap(`${CacheKeys.facets}conditions`, env.CACHE_TTL_SECONDS, async () => {
    const conditions = await Patient.distinct('condition', { deletedAt: null });
    return conditions.filter(Boolean).sort((a, b) => a.localeCompare(b));
  });
}
