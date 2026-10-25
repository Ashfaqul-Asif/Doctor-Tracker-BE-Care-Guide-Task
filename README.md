# Doctor Tracker — Backend (`doctor_tracker_BE`)

Express 5 + TypeScript + Mongoose 8 against MongoDB Atlas. Serves the
[frontend](../doctor_tracker_Fe) over REST; the full endpoint contract is in
[docs/api.md](../docs/api.md).

This is a standalone npm package — it installs, tests, builds and deploys on its own, with
no workspace linking it to the frontend. Run every command below from this directory.

---

## Setup

**Prerequisites:** Node 20.10+ (20.19+ recommended), npm 10+, a MongoDB Atlas cluster.

```bash
cd doctor_tracker_BE
cp .env.example .env
npm install
```

Fill in `.env`:

| Variable | Notes |
|---|---|
| `MONGODB_URI` | Atlas SRV string — **Connect → Drivers** in the Atlas UI |
| `MONGODB_DB_NAME` | Defaults to `careguide` |
| `MONGODB_URI_TEST` | Used by `npm test`; may be the same cluster |
| `MONGODB_DB_NAME_TEST` | **Must differ** from `MONGODB_DB_NAME` — the suite drops collections |
| `JWT_ACCESS_SECRET` | ≥32 chars |
| `JWT_REFRESH_SECRET` | ≥32 chars, different from the access secret |
| `CORS_ORIGINS` | Comma-separated allowlist. Credentials are on, so `*` is not permitted |
| `COOKIE_SECURE` / `COOKIE_SAMESITE` | `false` / `lax` locally; `true` / `none` when client and API are on different domains |
| `SEED_ENABLED` | **Must be `true` to run the seeders — see below** |

Generate the secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

The environment is validated by zod at boot ([`src/config/env.ts`](src/config/env.ts)) —
a missing or malformed variable stops the process immediately with the field named,
rather than surfacing as a confusing 500 on the first request that touches it.

Then:

```bash
npm run seed     # see below — requires SEED_ENABLED=true
npm run dev      # http://localhost:4000
```

Check it is up: `curl http://localhost:4000/api/health`

---

## Seeders

> **You must enable seeding before it will run.** Set `SEED_ENABLED=true` in
> `doctor_tracker_BE/.env`. Until you do, `npm run seed` refuses and exits non-zero.

### Why it is off by default

Seeding is **destructive** — every seeder drops its collections before repopulating.
`MONGODB_URI` is a single line in a file, and a seed run against the wrong cluster is not
recoverable. Requiring a second, explicit opt-in means that takes two mistakes rather
than one.

Three guards, each covering a different way to get this wrong
([`src/scripts/seed.ts`](src/scripts/seed.ts)):

| Guard | Behaviour |
|---|---|
| `NODE_ENV=production` | Refuses outright. There is no flag that overrides this. |
| `SEED_ENABLED` not `true` | Refuses, and names the database it *would* have dropped. |
| Default admin password outside development | Refuses, so `Admin123!` cannot reach a shared environment. |

All three exit `1`, so a misconfigured pipeline fails rather than continuing quietly.

### Running them

```bash
npm run seed              # every seeder, in dependency order
npm run seed:list         # what is available (no database connection, no guard)
npm run seed:admin        # just the administrator
npm run seed:doctors
npm run seed:patients     # reseed patients, keep the existing roster
```

Or select several at once:

```bash
npm run seed -- --only=doctors,patients
```

Order is taken from the registry, not from the flags, so dependencies hold however you
type it.

### What each one does

| Seeder | Clears | Inserts |
|---|---|---|
| `admin` | `users`, `refreshtokens` | One admin, password bcrypt-hashed at cost 12 |
| `doctors` | `doctors` | `SEED_DOCTORS` (default 200) |
| `patients` | `patients` | `SEED_PATIENTS` (default 10,000) |

Two details that matter:

- **`createdAt` is spread over the last 12 months.** Mongoose only fills timestamps in
  when they are unset, so the explicit values survive `insertMany`. Without this the
  registrations chart collapses into a single spike at seed time.
- **Patient assignment is skewed, not uniform.** A handful of doctors carry far more
  patients than the rest, so the "top doctors" chart has a real shape and a bug in its
  ordering would be visible.

Running `patients` alone resolves doctors from the database, and fails with a clear
message if the roster is empty — a patient is never orphaned (FR-16).

### The admin credentials are *not* configuration

`SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` are inputs to the **admin seeder only**.
The password is bcrypt-hashed into a `users` document at seed time and never read again:

```ts
// src/scripts/seeders/adminSeeder.ts
await User.create({
  email: env.SEED_ADMIN_EMAIL,
  passwordHash: await hashPassword(env.SEED_ADMIN_PASSWORD),
  role: 'admin',
});
```

Login queries that document and has no access to those variables:

```ts
// src/modules/auth/auth.service.ts
const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
const matches = await bcrypt.compare(password, user.passwordHash);
```

So changing `SEED_ADMIN_PASSWORD` does nothing until you re-run the seeder, and deleting
both variables afterwards leaves login working. They exist to solve the bootstrap problem
— there is no sign-up endpoint, because this is an internal admin tool, so something has
to create user #1.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Watch mode on :4000 (tsx) |
| `npm run build` | Compile `src/` to `dist/` |
| `npm start` | Run the compiled output |
| `npm run typecheck` | Types across `src/` **and** `tests/` |
| `npm run lint` | ESLint, type-aware — catches what tsc cannot (floating promises, misused async) |
| `npm test` | Vitest + supertest against `MONGODB_URI_TEST` |
| `npm run test:fast` | Only the suites needing no database — what CI runs without an Atlas secret |
| `npm run test:coverage` | `npm test` with a v8 coverage report and thresholds |
| `npm run seed*` | See [Seeders](#seeders) |
| `npm run explain` | Query plans and latency — **exits non-zero on a collection scan** |

### `npm run explain`

Turns "the queries are indexed" from a claim into a check. For each hot query it prints
the index the planner chose, keys vs. documents examined, whether a blocking in-memory
`SORT` was needed, and p50/p95 latency — then fails the process if anything ran a
`COLLSCAN`. Run `npm run seed` first; it needs a populated database to mean anything.

---

## Layout

```
src/
  config/env.ts          zod-validated environment, fails fast at boot
  db/connect.ts          connection + syncIndexes (dev/test only)
  models/                User · Doctor · Patient · RefreshToken
    plugins/             searchableName — keeps `nameTokens` in sync on all write paths
  middleware/            authenticate · requireRole · validate · rejectOperatorKeys
                         · rateLimit · errorHandler
  modules/
    auth/                login, refresh rotation, logout
    doctors/             list · create · detail · update · :id/patients · facets
    patients/            CRUD with soft delete · conditions
    dashboard/           summary ($facet) · timeseries ($dateTrunc)
  lib/                   ApiError · pagination · cache · tokens · timeBuckets
  scripts/
    seed.ts              guarded runner
    seeders/             admin · doctors · patients
    explain.ts           query plans + latency
  app.ts  server.ts  routes.ts
tests/                   supertest suites + pure-logic unit tests
```

Conventions worth knowing before editing:

- **No `asyncHandler` wrapper.** Express 5 forwards rejected promises to the error
  middleware natively.
- **Errors leave through one door.** Throw an `ApiError`; `errorHandler` serialises every
  failure as `{ error: { code, message, details? } }`.
- **Validated input lives on `req.validated`**, read with the typed `validated()` helper.
  Nothing writes back over `req.query` — in Express 5 it is a getter with no setter.
- **Every read path filters `deletedAt: null`**, which is also the leading field of every
  compound index.
- **Reads are open to any authenticated role; writes are `admin`.** Feature routers apply
  `authenticate` at the top so a new route is closed by default, and each mutating route
  adds `requireRole('admin')` — placed *before* `validate`, so an unauthorised caller gets
  a 403 rather than a 400 that would disclose the schema.
- **Rotation revokes before it issues.** `rotateSession` claims the presented refresh
  token with a conditional `findOneAndUpdate({ revokedAt: null })`, so concurrent
  refreshes resolve to one winner. It fails closed: if issuing the replacement then
  fails, the user re-authenticates rather than being left with two live tokens.

---

## Tests

```bash
npm test
```

Requires `MONGODB_URI_TEST`. The suite drops collections between cases, so the API
refuses to start a test run when `MONGODB_DB_NAME_TEST` matches `MONGODB_DB_NAME`.

`tests/unit.test.ts` and `tests/foundation.test.ts` need no database and cover the
bucket arithmetic, date-range widening, regex escaping, pagination maths, the cache's
in-flight deduplication and the NoSQL-injection guard:

```bash
npm run test:fast
```

CI falls back to exactly this subset when no `MONGODB_URI_TEST` secret is configured,
and says so in the run log rather than reporting a green build it did not earn.

### Coverage

```bash
npm run test:coverage
```

The thresholds in `vitest.config.ts` are **provisional** — they were added without a
measured baseline, since the environment had no reachable cluster. Calibrate them on the
first full run against a real `MONGODB_URI_TEST` and pin them just under the real
numbers.

---

## Deployment

Render, Railway or Fly. Set every variable from `.env.example`, allowlist the platform's
egress IPs in Atlas under **Network Access**, and leave `SEED_ENABLED` unset — the
production guard refuses regardless, but there is no reason to have it there.

Cross-domain deployment needs `COOKIE_SAMESITE=none`, `COOKIE_SECURE=true`, and
`CORS_ORIGINS` listing the client's exact origin.
