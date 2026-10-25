import { faker } from '@faker-js/faker';
import { env } from '../../config/env.js';
import { tokenizeName } from '../../lib/nameSearch.js';
import { Doctor } from '../../models/Doctor.js';
import { HOSPITALS, SPECIALIZATIONS } from '../seedData.js';
import { pick, randomCreatedAt, type Seeder } from './shared.js';

export const doctorSeeder: Seeder = {
  name: 'doctors',
  description: `Doctor roster (SEED_DOCTORS, currently ${env.SEED_DOCTORS})`,

  async run(context) {
    await Doctor.deleteMany({});

    const docs = Array.from({ length: env.SEED_DOCTORS }, (_unused, index) => {
      const name = faker.person.fullName();
      const tokens = tokenizeName(name);
      const createdAt = randomCreatedAt();
      return {
        name,
        nameTokens: tokens,
        specialization: pick(SPECIALIZATIONS),
        hospital: pick(HOSPITALS),
        phone: faker.phone.number({ style: 'international' }),
        // `Doctor.email` is unique, and faker recycles names long before SEED_DOCTORS is
        // exhausted — deriving the local part from the row index keeps the address
        // readable while making a collision impossible by construction.
        email: `${tokens.join('.')}.${index + 1}@hospital.test`,
        deletedAt: null,
        createdAt,
        updatedAt: createdAt,
      };
    });

    // The explicit createdAt/updatedAt survive: Mongoose's timestamp helpers only fill
    // these in when they are unset. That spread is what gives the registrations chart a
    // shape instead of one spike at seed time.
    const doctors = await Doctor.insertMany(docs);

    // Hand the ids to the patients seeder rather than making it re-query for them.
    context.doctorIds = doctors.map((doctor) => doctor._id);

    console.log(`  inserted ${doctors.length} doctors`);
  },
};
