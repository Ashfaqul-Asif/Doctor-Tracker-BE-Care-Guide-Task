import { env } from '../../config/env.js';
import { Session } from '../../models/Session.js';
import { User } from '../../models/User.js';
import { hashPassword } from '../../modules/auth/auth.service.js';
import type { Seeder } from './shared.js';

/**
 * Creates the first administrator.
 *
 * There is no sign-up endpoint — this is an internal tool, so user #1 has to come from
 * somewhere. `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` are inputs to *this script only*:
 * the password is bcrypt-hashed into a `User` document here and never read again. Login
 * queries the database, not the environment.
 */
export const adminSeeder: Seeder = {
  name: 'admin',
  description: 'Administrator account (bcrypt-hashed into the users collection)',

  async run() {
    // Sessions belong to users; leaving them behind would orphan them.
    await Promise.all([User.deleteMany({}), Session.deleteMany({})]);

    await User.create({
      email: env.SEED_ADMIN_EMAIL,
      passwordHash: await hashPassword(env.SEED_ADMIN_PASSWORD),
      role: 'admin',
    });

    console.log(`  created admin ${env.SEED_ADMIN_EMAIL}`);
  },
};
