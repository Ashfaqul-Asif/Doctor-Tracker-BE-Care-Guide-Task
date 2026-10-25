import type { PipelineStage } from 'mongoose';
import { env } from '../../config/env.js';
import { Doctor } from '../../models/Doctor.js';
import { Patient } from '../../models/Patient.js';
import { cache, CacheKeys } from '../../lib/cache.js';
import { defaultRange, fillGaps, truncateToInterval } from '../../lib/timeBuckets.js';
import type { TimeInterval, TimeseriesQuery } from './dashboard.schema.js';

/**
 * FR-19: every number on this page is computed by the database. Fetching the
 * collections and reducing them in JavaScript would move ~10k documents over the wire
 * to answer a question about six of them.
 */

export interface TopDoctor {
  doctorId: string;
  name: string;
  specialization: string;
  patients: number;
}

export interface DistributionBucket {
  bucket: string;
  doctors: number;
}

export interface DashboardSummary {
  totals: {
    doctors: number;
    patients: number;
    patientsLast30Days: number;
    averagePatientsPerDoctor: number;
  };
  topDoctors: TopDoctor[];
  distribution: DistributionBucket[];
  generatedAt: string;
}

const BUCKET_BOUNDARIES = [1, 5, 10, 25, 50, 100];
const BUCKET_LABELS: Record<string, string> = {
  '1': '1–4',
  '5': '5–9',
  '10': '10–24',
  '25': '25–49',
  '50': '50–99',
  '100': '100+',
  over: '100+',
};

interface PatientFacetResult {
  totals: Array<{ total: number }>;
  recent: Array<{ total: number }>;
  topDoctors: Array<{
    doctorId: string;
    patients: number;
    name?: string;
    specialization?: string;
  }>;
  distribution: Array<{ _id: number | string; doctors: number }>;
  doctorsWithPatients: Array<{ total: number }>;
}

function buildSummaryPipeline(thirtyDaysAgo: Date): PipelineStage[] {
  return [
    // Rides the leading field of every index on the collection, and keeps
    // soft-deleted patients from corrupting the totals (the reason FR-17 exists).
    { $match: { deletedAt: null } },
    {
      $facet: {
        totals: [{ $count: 'total' }],
        recent: [{ $match: { createdAt: { $gte: thirtyDaysAgo } } }, { $count: 'total' }],
        topDoctors: [
          { $group: { _id: '$doctorId', patients: { $sum: 1 } } },
          // `_id` breaks ties so pagination-free "top 10" is at least deterministic.
          { $sort: { patients: -1, _id: 1 } },
          { $limit: 10 },
          {
            $lookup: {
              from: 'doctors',
              localField: '_id',
              foreignField: '_id',
              as: 'doctor',
            },
          },
          { $unwind: { path: '$doctor', preserveNullAndEmptyArrays: true } },
          {
            $project: {
              _id: 0,
              doctorId: { $toString: '$_id' },
              patients: 1,
              name: '$doctor.name',
              specialization: '$doctor.specialization',
            },
          },
        ],
        distribution: [
          { $group: { _id: '$doctorId', patients: { $sum: 1 } } },
          {
            $bucket: {
              groupBy: '$patients',
              boundaries: BUCKET_BOUNDARIES,
              default: 'over',
              output: { doctors: { $sum: 1 } },
            },
          },
        ],
        doctorsWithPatients: [
          { $group: { _id: '$doctorId' } },
          { $count: 'total' },
        ],
      },
    },
  ];
}

export async function getSummary(): Promise<DashboardSummary> {
  return cache.wrap(`${CacheKeys.dashboard}summary`, env.CACHE_TTL_SECONDS, async () => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);

    // Doctors live in another collection, so they are one extra count rather than a
    // `$unionWith` bolted onto the patient pipeline. Two round trips, run in parallel.
    const [doctorCount, facetResults] = await Promise.all([
      Doctor.countDocuments({ deletedAt: null }),
      Patient.aggregate<PatientFacetResult>(buildSummaryPipeline(thirtyDaysAgo)),
    ]);

    const facets = facetResults[0];
    const totalPatients = facets?.totals[0]?.total ?? 0;
    const recentPatients = facets?.recent[0]?.total ?? 0;
    const doctorsWithPatients = facets?.doctorsWithPatients[0]?.total ?? 0;

    const distribution: DistributionBucket[] = [];
    // Doctors with no patients never appear in the patients collection, so the "0"
    // bucket has to be derived rather than aggregated — omitting it would quietly
    // under-report the roster.
    const doctorsWithNone = Math.max(doctorCount - doctorsWithPatients, 0);
    distribution.push({ bucket: '0', doctors: doctorsWithNone });

    for (const bucket of facets?.distribution ?? []) {
      distribution.push({
        bucket: BUCKET_LABELS[String(bucket._id)] ?? String(bucket._id),
        doctors: bucket.doctors,
      });
    }

    const topDoctors: TopDoctor[] = (facets?.topDoctors ?? []).map((entry) => ({
      doctorId: entry.doctorId,
      name: entry.name ?? 'Unknown doctor',
      specialization: entry.specialization ?? '—',
      patients: entry.patients,
    }));

    return {
      totals: {
        doctors: doctorCount,
        patients: totalPatients,
        patientsLast30Days: recentPatients,
        averagePatientsPerDoctor:
          doctorCount === 0 ? 0 : Math.round((totalPatients / doctorCount) * 10) / 10,
      },
      topDoctors,
      distribution,
      generatedAt: new Date().toISOString(),
    };
  });
}

export interface TimeseriesResponse {
  interval: TimeInterval;
  from: string;
  to: string;
  points: Array<{ date: string; count: number }>;
}

export async function getTimeseries(query: TimeseriesQuery): Promise<TimeseriesResponse> {
  const fallback = defaultRange(query.interval);
  const from = query.from ?? fallback.from;
  const to = query.to ?? fallback.to;

  const key = `${CacheKeys.dashboard}timeseries:${query.interval}:${from.toISOString()}:${to.toISOString()}`;

  return cache.wrap(key, env.CACHE_TTL_SECONDS, async () => {
    const dateTrunc: Record<string, unknown> = {
      date: '$createdAt',
      unit: query.interval,
    };
    // `startOfWeek` is only meaningful for weekly bins.
    if (query.interval === 'week') dateTrunc.startOfWeek = 'monday';

    const rows = await Patient.aggregate<{ _id: Date; count: number }>([
      { $match: { deletedAt: null, createdAt: { $gte: from, $lte: to } } },
      { $group: { _id: { $dateTrunc: dateTrunc }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);

    const counts = new Map<number, number>(
      rows.map((row) => [truncateToInterval(new Date(row._id), query.interval).getTime(), row.count]),
    );

    return {
      interval: query.interval,
      from: from.toISOString(),
      to: to.toISOString(),
      points: fillGaps(counts, from, to, query.interval),
    };
  });
}
