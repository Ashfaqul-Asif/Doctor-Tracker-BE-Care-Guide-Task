import { connectToDatabase, disconnectFromDatabase } from '../db/connect.js';
import { Doctor } from '../models/Doctor.js';
import { Patient } from '../models/Patient.js';
import { listDoctors } from '../modules/doctors/doctors.service.js';
import { listPatients } from '../modules/patients/patients.service.js';

/**
 * Turns "the queries are indexed" from a claim into a check (Definition of Done #3).
 *
 * Reports, for each hot query: which index the planner chose, how many documents it had
 * to touch to return a page, and whether a blocking in-memory SORT was needed. Exits
 * non-zero on a collection scan, so this can gate a release rather than just inform one.
 *
 * Run with:  npm run explain
 */

interface PlanFacts {
  stages: string[];
  indexNames: string[];
}

/**
 * The explain shape moved between server versions (the classic engine nests
 * `winningPlan.inputStage`, the slot-based engine nests `winningPlan.queryPlan`), so
 * this walks the whole tree instead of reaching for a fixed path.
 */
function collectPlanFacts(node: unknown, facts: PlanFacts = { stages: [], indexNames: [] }): PlanFacts {
  if (Array.isArray(node)) {
    for (const item of node) collectPlanFacts(item, facts);
    return facts;
  }
  if (!node || typeof node !== 'object') return facts;

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'stage' && typeof value === 'string') facts.stages.push(value);
    else if (key === 'indexName' && typeof value === 'string') facts.indexNames.push(value);
    else collectPlanFacts(value, facts);
  }
  return facts;
}

interface ExplainResult {
  executionStats?: {
    nReturned?: number;
    executionTimeMillis?: number;
    totalKeysExamined?: number;
    totalDocsExamined?: number;
  };
}

async function report(label: string, explainable: { explain(verbosity: string): Promise<unknown> }) {
  const raw = (await explainable.explain('executionStats')) as ExplainResult;
  const facts = collectPlanFacts(raw);
  const stats = raw.executionStats ?? {};

  const usedCollScan = facts.stages.includes('COLLSCAN');
  const blockingSort = facts.stages.includes('SORT');
  const index = [...new Set(facts.indexNames)].join(', ') || '(none)';

  console.log(`\n${label}`);
  console.log(`  index          ${index}`);
  console.log(`  stages         ${[...new Set(facts.stages)].join(' → ')}`);
  console.log(`  returned       ${stats.nReturned ?? '?'}`);
  console.log(`  keys examined  ${stats.totalKeysExamined ?? '?'}`);
  console.log(`  docs examined  ${stats.totalDocsExamined ?? '?'}`);
  console.log(`  time           ${stats.executionTimeMillis ?? '?'}ms`);
  if (usedCollScan) console.log('  ✗ COLLSCAN — this query is not using an index');
  if (blockingSort) console.log('  ! blocking SORT — the sort is not being served by the index');

  return { usedCollScan, blockingSort };
}

async function percentile(label: string, run: () => Promise<unknown>, iterations = 30) {
  // One untimed pass so connection setup and the planner cache don't land in the sample.
  await run();

  const timings: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const started = performance.now();
    await run();
    timings.push(performance.now() - started);
  }
  timings.sort((a, b) => a - b);

  const at = (p: number) => timings[Math.min(Math.ceil(p * timings.length) - 1, timings.length - 1)] ?? 0;
  console.log(
    `  ${label.padEnd(34)} p50 ${at(0.5).toFixed(1)}ms   p95 ${at(0.95).toFixed(1)}ms   max ${(timings.at(-1) ?? 0).toFixed(1)}ms`,
  );
  return at(0.95);
}

async function main(): Promise<void> {
  await connectToDatabase();

  const [doctorCount, patientCount] = await Promise.all([
    Doctor.countDocuments({ deletedAt: null }),
    Patient.countDocuments({ deletedAt: null }),
  ]);
  console.log(`Dataset: ${doctorCount} doctors, ${patientCount} patients`);

  if (patientCount === 0) {
    console.error('\nNothing to measure — run `npm run seed` first.');
    await disconnectFromDatabase();
    process.exit(1);
  }

  const sampleDoctor = await Doctor.findOne({ deletedAt: null }).lean();
  const sampleCondition = await Patient.findOne({ deletedAt: null }).select('condition').lean();

  console.log('\n=== Query plans ===');
  const results = [
    await report(
      'Doctors — default list (deletedAt + createdAt sort)',
      Doctor.find({ deletedAt: null }).sort({ createdAt: -1 }).limit(20),
    ),
    await report(
      'Doctors — filtered by specialization',
      Doctor.find({ deletedAt: null, specialization: sampleDoctor?.specialization })
        .sort({ createdAt: -1 })
        .limit(20),
    ),
    await report(
      'Doctors — per-word name prefix search',
      Doctor.find({ deletedAt: null, nameTokens: { $all: [/^a/] } }).limit(20),
    ),
    await report(
      "Patients — one doctor's list (the hottest query)",
      Patient.find({ deletedAt: null, doctorId: sampleDoctor?._id })
        .sort({ createdAt: -1 })
        .limit(20),
    ),
    await report(
      'Patients — filtered by condition',
      Patient.find({ deletedAt: null, condition: sampleCondition?.condition })
        .sort({ createdAt: -1 })
        .limit(20),
    ),
  ];

  console.log('\n=== Latency (database round trip, excludes HTTP) ===');
  const p95s = [
    await percentile('GET /api/doctors', () => listDoctors({ page: 1, limit: 20 })),
    await percentile('GET /api/doctors?search=', () =>
      listDoctors({ page: 1, limit: 20, search: 'a' }),
    ),
    await percentile('GET /api/patients', () => listPatients({ page: 1, limit: 20 })),
    await percentile('GET /api/doctors/:id/patients', () =>
      listPatients({ page: 1, limit: 20, doctorId: String(sampleDoctor?._id) }, { includeDoctor: false }),
    ),
  ];

  await disconnectFromDatabase();

  const scans = results.filter((result) => result.usedCollScan).length;
  const slowest = Math.max(...p95s);
  console.log(`\nWorst p95: ${slowest.toFixed(1)}ms (budget 300ms)`);

  if (scans > 0) {
    console.error(`\n✗ ${scans} quer${scans === 1 ? 'y is' : 'ies are'} running a collection scan.`);
    process.exit(1);
  }
  console.log('✓ Every hot query is index-backed.');
}

main().catch(async (error: unknown) => {
  console.error('Explain failed:', error);
  await disconnectFromDatabase().catch(() => undefined);
  process.exit(1);
});
