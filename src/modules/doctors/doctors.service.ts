import type { FilterQuery } from 'mongoose';
import { env } from '../../config/env.js';
import { Doctor, type DoctorAttrs } from '../../models/Doctor.js';
import { Patient } from '../../models/Patient.js';
import { ApiError } from '../../lib/ApiError.js';
import { cache, CacheKeys, invalidateDerivedCaches } from '../../lib/cache.js';
import { nameTokenFilter, tokenizeName } from '../../lib/nameSearch.js';
import { paginate, toSkip, type Paginated } from '../../lib/pagination.js';
import { buildDateRange } from '../../lib/queryPrimitives.js';
import type { CreateDoctorBody, ListDoctorsQuery, UpdateDoctorBody } from './doctors.schema.js';

export interface DoctorDTO {
  id: string;
  name: string;
  specialization: string;
  hospital: string;
  phone: string;
  email: string;
  createdAt: string;
  updatedAt: string;
  /** Only present on the detail view — see `getDoctor`. */
  patientCount?: number;
}

type LeanDoctor = DoctorAttrs & { _id: unknown };

function toDoctorDTO(doctor: LeanDoctor): DoctorDTO {
  return {
    id: String(doctor._id),
    name: doctor.name,
    specialization: doctor.specialization,
    hospital: doctor.hospital,
    phone: doctor.phone,
    email: doctor.email,
    createdAt: doctor.createdAt.toISOString(),
    updatedAt: doctor.updatedAt.toISOString(),
  };
}

export function buildDoctorFilter(query: ListDoctorsQuery): FilterQuery<DoctorAttrs> {
  const filter: FilterQuery<DoctorAttrs> = { deletedAt: null };

  if (query.search) {
    // Per-word anchored match against the multikey `nameTokens` index — so a surname
    // finds the doctor, and it is still an index prefix scan rather than the collection
    // scan a `/…/i` regex would force.
    const tokens = nameTokenFilter(query.search);
    if (tokens) filter.nameTokens = tokens;
  }
  if (query.specialization) filter.specialization = query.specialization;
  if (query.hospital) filter.hospital = query.hospital;

  const createdAt = buildDateRange(query.from, query.to);
  if (createdAt) filter.createdAt = createdAt;

  return filter;
}

export async function listDoctors(query: ListDoctorsQuery): Promise<Paginated<DoctorDTO>> {
  const filter = buildDoctorFilter(query);

  // FR-8: the page is produced by the database. Fetching everything and slicing in the
  // client is what stops working at 10,000 records.
  const [doctors, total] = await Promise.all([
    Doctor.find(filter)
      .sort({ createdAt: -1 })
      .skip(toSkip(query.page, query.limit))
      .limit(query.limit)
      .lean<LeanDoctor[]>(),
    Doctor.countDocuments(filter),
  ]);

  return paginate(doctors.map(toDoctorDTO), {
    page: query.page,
    limit: query.limit,
    total,
  });
}

export async function getDoctor(id: string): Promise<DoctorDTO> {
  // Both reads are keyed off the same id, so neither depends on the other's result —
  // issuing them together costs one round trip instead of two. The count is discarded
  // if the doctor turns out not to exist, which is the cheaper half of the trade.
  const [doctor, patientCount] = await Promise.all([
    Doctor.findOne({ _id: id, deletedAt: null }).lean<LeanDoctor | null>(),
    Patient.countDocuments({ doctorId: id, deletedAt: null }),
  ]);

  if (!doctor) throw ApiError.notFound('Doctor');

  return { ...toDoctorDTO(doctor), patientCount };
}

export async function createDoctor(body: CreateDoctorBody): Promise<DoctorDTO> {
  const created = await Doctor.create({
    ...body,
    nameTokens: tokenizeName(body.name),
    deletedAt: null,
  });

  invalidateDerivedCaches();
  return toDoctorDTO(created.toObject());
}

export async function updateDoctor(id: string, body: UpdateDoctorBody): Promise<DoctorDTO> {
  // `findOneAndUpdate` triggers the searchableName hook, so `nameTokens` cannot drift
  // out of sync with a renamed doctor.
  const updated = await Doctor.findOneAndUpdate(
    { _id: id, deletedAt: null },
    { $set: body },
    { new: true, runValidators: true },
  ).lean<LeanDoctor | null>();

  if (!updated) throw ApiError.notFound('Doctor');

  invalidateDerivedCaches();
  return toDoctorDTO(updated);
}

/**
 * NOTE: there is deliberately no delete here. The requirement covers creating and
 * listing doctors; deletion was confirmed out of scope with the client, so the route
 * does not exist rather than existing and refusing. See the README's assumptions.
 */

/** Distinct values that populate the list page's filter dropdowns. */
export async function getDoctorFacets(): Promise<{
  specializations: string[];
  hospitals: string[];
}> {
  return cache.wrap(`${CacheKeys.facets}doctors`, env.CACHE_TTL_SECONDS, async () => {
    const [specializations, hospitals] = await Promise.all([
      Doctor.distinct('specialization', { deletedAt: null }),
      Doctor.distinct('hospital', { deletedAt: null }),
    ]);
    return {
      specializations: specializations.filter(Boolean).sort((a, b) => a.localeCompare(b)),
      hospitals: hospitals.filter(Boolean).sort((a, b) => a.localeCompare(b)),
    };
  });
}

export async function assertDoctorExists(id: string): Promise<void> {
  const exists = await Doctor.exists({ _id: id, deletedAt: null });
  if (!exists) throw ApiError.notFound('Doctor');
}
