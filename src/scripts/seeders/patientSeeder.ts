import { faker } from '@faker-js/faker';
import { env } from '../../config/env.js';
import { tokenizeName } from '../../lib/nameSearch.js';
import { Doctor } from '../../models/Doctor.js';
import { Patient } from '../../models/Patient.js';
import { CONDITIONS } from '../seedData.js';
import { BATCH_SIZE, pick, randomCreatedAt, skewedIndex, type Seeder } from './shared.js';

export const patientSeeder: Seeder = {
  name: 'patients',
  description: `Patients assigned across the roster (SEED_PATIENTS, currently ${env.SEED_PATIENTS})`,

  async run(context) {
    // Running this seeder on its own is legitimate — reseed patients, keep the roster —
    // so fall back to the doctors already in the database.
    if (context.doctorIds.length === 0) {
      const existing = await Doctor.find({ deletedAt: null }).select('_id').lean();
      context.doctorIds = existing.map((doctor) => doctor._id);
    }

    if (context.doctorIds.length === 0) {
      throw new Error(
        'No doctors to assign patients to. Run the doctors seeder first (FR-16: a patient is never orphaned).',
      );
    }

    await Patient.deleteMany({});

    let inserted = 0;
    while (inserted < env.SEED_PATIENTS) {
      const size = Math.min(BATCH_SIZE, env.SEED_PATIENTS - inserted);
      const batch = Array.from({ length: size }, () => {
        const name = faker.person.fullName();
        const createdAt = randomCreatedAt();
        return {
          name,
          nameTokens: tokenizeName(name),
          condition: pick(CONDITIONS),
          doctorId: context.doctorIds[skewedIndex(context.doctorIds.length)],
          contactInfo: faker.phone.number({ style: 'international' }),
          deletedAt: null,
          createdAt,
          updatedAt: createdAt,
        };
      });

      await Patient.insertMany(batch);
      inserted += size;
      process.stdout.write(`\r  inserted ${inserted}/${env.SEED_PATIENTS} patients`);
    }
    process.stdout.write('\n');

    // A silent collapse of the date spread would only show up much later as a
    // suspiciously boring chart, so assert it here where it is cheap to notice.
    const [oldest] = await Patient.find().sort({ createdAt: 1 }).limit(1).lean();
    const [newest] = await Patient.find().sort({ createdAt: -1 }).limit(1).lean();
    console.log(
      `  createdAt spans ${oldest?.createdAt.toISOString().slice(0, 10)} → ${newest?.createdAt
        .toISOString()
        .slice(0, 10)}`,
    );
  },
};
