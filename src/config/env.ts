import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment is validated once, at boot. A misconfigured deployment should fail
 * immediately and loudly rather than surfacing as a confusing 500 on the first
 * request that happens to touch the missing value.
 */

const booleanish = z.enum(['true', 'false']).default('false').transform((v) => v === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  // The base path every API route is mounted under. Driven by env so the prefix is a
  // deployment decision, not a code change — e.g. API_PREFIX=/api/v1. Must start with "/".
  API_PREFIX: z.string().startsWith('/').default('/api/v1'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  // Pretty-printed logs via `pino-pretty` are a local-dev convenience only. The
  // transport runs in a worker thread and `pino-pretty` is a devDependency, so it
  // is neither installed nor functional on serverless/bundled hosts like Vercel.
  // Opt in explicitly with LOG_PRETTY=true in a local .env; every deployed
  // environment leaves it unset and emits plain JSON.
  LOG_PRETTY: booleanish,

  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required (MongoDB Atlas SRV string)'),
  MONGODB_DB_NAME: z.string().min(1).default('careguide'),
  // An explicitly blank `MONGODB_URI_TEST=` in .env is a common way to say "not set" —
  // treated the same as the variable being absent entirely, so it doesn't need deleting.
  MONGODB_URI_TEST: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(1).optional(),
  ),
  MONGODB_DB_NAME_TEST: z.string().min(1).default('careguide_test'),

  /**
   * No signing secrets live here, and that is the point.
   *
   * Sessions are opaque random tokens stored hashed in the database, so nothing is
   * signed and there is no key to configure, protect or rotate. Deployment carries a
   * database URI and cookie settings — no cryptographic material at all.
   */
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(7),

  COOKIE_SECURE: booleanish,
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_DOMAIN: z.string().min(1).optional(),

  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  LOGIN_RATE_MAX: z.coerce.number().int().positive().default(5),
  LOGIN_RATE_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),

  /**
   * Refresh is rate limited too, but far more loosely than login: it is a legitimate
   * background call, and one user with several tabs open will make a handful per window
   * without doing anything wrong. The limit exists to cap a stolen cookie being ground
   * against the endpoint, not to police normal use.
   */
  REFRESH_RATE_MAX: z.coerce.number().int().positive().default(60),
  REFRESH_RATE_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),

  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(120),

  /**
   * Seeding is destructive — it drops every collection before repopulating. It is
   * therefore off unless switched on explicitly, so that running `npm run seed` against
   * the wrong `MONGODB_URI` takes two mistakes rather than one.
   */
  SEED_ENABLED: booleanish,
  SEED_ADMIN_EMAIL: z.email().default('admin@careguide.dev'),
  SEED_ADMIN_PASSWORD: z.string().min(8).default('Admin123!'),
  SEED_DOCTORS: z.coerce.number().int().positive().default(200),
  SEED_PATIENTS: z.coerce.number().int().positive().default(10_000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Deliberately console.error, not the logger — the logger depends on this module.
  console.error('\nInvalid environment configuration:\n');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  }
  console.error(
    '\nCopy doctor_tracker_BE/.env.example to doctor_tracker_BE/.env and fill in the blanks.\n',
  );
  process.exit(1);
}

const raw = parsed.data;
const isTest = raw.NODE_ENV === 'test';

const mongoDbName = isTest ? raw.MONGODB_DB_NAME_TEST : raw.MONGODB_DB_NAME;

// `npm test` drops its database between runs. Refuse to point that at the real one.
if (isTest && mongoDbName === raw.MONGODB_DB_NAME) {
  console.error(
    `\nRefusing to run tests against the primary database "${mongoDbName}".\n` +
      'Set MONGODB_DB_NAME_TEST to a distinct database name.\n',
  );
  process.exit(1);
}

/**
 * Any `<…>` token left in a connection string is an unreplaced placeholder — a real URI
 * never contains angle brackets, since they would have to be percent-encoded. Matching
 * the shape rather than a list of names keeps this working as Atlas renames them; the
 * UI currently emits `<db_username>:<db_password>`, and has used `<user>:<password>`.
 */
const PLACEHOLDER = /<[^>]+>/;

/**
 * A test URI that was never filled in is treated as absent, so tests fall back to the
 * primary cluster. That is safe because the *database name* is what keeps them apart
 * (guarded above), and it means only one line of `.env` has to be edited to get a
 * working setup rather than the same string pasted twice.
 */
const testUri =
  raw.MONGODB_URI_TEST && !PLACEHOLDER.test(raw.MONGODB_URI_TEST)
    ? raw.MONGODB_URI_TEST
    : undefined;

const mongoUri = isTest ? (testUri ?? raw.MONGODB_URI) : raw.MONGODB_URI;

/**
 * Whether the connection string is still the unedited `.env.example` value.
 *
 * Reported rather than enforced here: `connectToDatabase` raises it at the point of use.
 * Failing at import time would take down everything that merely *loads* config — the
 * unit and middleware suites never open a connection and have no reason to care.
 */
const hasPlaceholderMongoUri = PLACEHOLDER.test(mongoUri);

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  isDevelopment: raw.NODE_ENV === 'development',
  isTest,
  mongoUri,
  mongoDbName,
  hasPlaceholderMongoUri,
  corsOrigins: raw.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
} as const;

export type Env = typeof env;
