import { env } from '../config/env.js';
import { connectToDatabase, disconnectFromDatabase, syncAllIndexes } from '../db/connect.js';
import { seederNames, selectSeeders, type SeedContext } from './seeders/index.js';

/**
 * Seed runner.
 *
 * Populates the database with enough data that the performance requirements are
 * actually testable — a list endpoint that is fast against 12 rows tells you nothing.
 *
 *   npm run seed                      # every seeder, in dependency order
 *   npm run seed -- --only=admin      # just the administrator
 *   npm run seed -- --only=doctors,patients
 *   npm run seed -- --list
 *
 * Seeding is DESTRUCTIVE: each seeder clears its own collections first. It is therefore
 * disabled unless SEED_ENABLED=true, so pointing MONGODB_URI at the wrong cluster and
 * running this takes two mistakes rather than one.
 */

const DEFAULT_ADMIN_PASSWORD = 'Admin123!';

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function parseOnly(argv: string[]): string[] | null {
  const flag = argv.find((arg) => arg.startsWith('--only='));
  if (!flag) return null;

  const names = flag
    .slice('--only='.length)
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

  return names.length > 0 ? names : null;
}

/**
 * Three separate refusals, because they guard against three different mistakes: running
 * this at all in production, running it before deciding to, and shipping a well-known
 * password to somewhere that isn't a developer's laptop.
 */
function assertSeedingAllowed(): void {
  if (env.isProduction) {
    fail(
      'Refusing to seed: NODE_ENV=production.\n' +
        'This script drops the users, doctors, patients and refreshtokens collections.',
    );
  }

  if (!env.SEED_ENABLED) {
    fail(
      'Seeding is disabled.\n\n' +
        `  Set SEED_ENABLED=true in doctor_tracker_BE/.env to enable it.\n\n` +
        `  It will DROP and repopulate collections in the database "${env.mongoDbName}".\n` +
        '  Check MONGODB_URI points where you think it does before switching this on.',
    );
  }

  if (!env.isDevelopment && env.SEED_ADMIN_PASSWORD === DEFAULT_ADMIN_PASSWORD) {
    fail(
      `Refusing to seed the default admin password while NODE_ENV=${env.NODE_ENV}.\n` +
        'Set SEED_ADMIN_PASSWORD in doctor_tracker_BE/.env to something else.',
    );
  }
}

async function main(): Promise<void> {
  if (process.argv.includes('--list')) {
    console.log('Available seeders:\n');
    for (const name of seederNames()) console.log(`  ${name}`);
    return;
  }

  assertSeedingAllowed();

  const selected = selectSeeders(parseOnly(process.argv.slice(2)));

  await connectToDatabase();
  await syncAllIndexes();

  console.log(`\nSeeding "${env.mongoDbName}" — ${selected.map((s) => s.name).join(', ')}\n`);

  const context: SeedContext = { doctorIds: [] };
  for (const seeder of selected) {
    console.log(`▸ ${seeder.name} — ${seeder.description}`);
    await seeder.run(context);
  }

  if (selected.some((seeder) => seeder.name === 'admin')) {
    console.log('\nDone. Sign in with:');
    console.log(`  email:    ${env.SEED_ADMIN_EMAIL}`);
    console.log(`  password: ${env.SEED_ADMIN_PASSWORD}`);
    console.log('\nThese now exist as a bcrypt-hashed user in the database, not as config.');
  } else {
    console.log('\nDone.');
  }

  await disconnectFromDatabase();
}

main().catch(async (error: unknown) => {
  console.error('\nSeed failed:', error instanceof Error ? error.message : error);
  await disconnectFromDatabase().catch(() => undefined);
  process.exit(1);
});
