# Doctor Tracker

An internal admin console for a small clinic: sign in, see where the roster
stands at a glance, drill into any doctor or patient, and keep the two tables
in sync. One admin user, two REST resources, two charts, and the plumbing to
make all of that feel responsive on a phone and legible on a desktop.

Two repos, deployed separately:

| Part | Stack | Repo |
|---|---|---|
| Frontend | Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · TanStack Query · Zustand · Recharts | `doctor_tracker_Fe` |
| Backend | Express 5 · TypeScript · Mongoose 8 · MongoDB Atlas · zod · bcryptjs · pino | `doctor_tracker_BE` |

Live:
- Frontend — `https://doctor-tracker-fe.vercel.app`
- Backend — `https://doctor-tracker-be.vercel.app`

Admin credentials (seeded):
- Email — `admin@doctortracker.com`
- Password — `Doctor123!`

---

## Setup

**Prerequisites:** Node 20.10+ (20.19+ recommended), npm 10+, a MongoDB Atlas
cluster (a free M0 is enough).

Clone both repos next to each other. The backend boots first — the frontend
cannot sign anyone in until the API is reachable.

### 1. Backend

```bash
cd doctor_tracker_BE
cp .env.example .env
npm install
npm run seed:admin        # creates the admin user
npm run seed:doctors      # 200 doctors
npm run seed:patients     # 10,000 patients, assigned non-uniformly
npm run dev               # http://localhost:5000
```

`.env.example`:

```ini
NODE_ENV=development
PORT=5000
API_PREFIX=/api/v1

MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/?retryWrites=true&w=majority
MONGODB_DB_NAME=careguide

CORS_ORIGINS=http://localhost:3000
DEFAULT_TIMEZONE=Asia/Dhaka

COOKIE_SECURE=false
COOKIE_SAMESITE=lax

SEED_ADMIN_EMAIL=admin@doctortracker.com
SEED_ADMIN_NAME=Admin DoctorTracker
SEED_ADMIN_PASSWORD=Doctor123!
SEED_CONFIRM=careguide
SEED_ENABLED=true

LOG_LEVEL=debug
```

Only three fields are mandatory: `MONGODB_URI`, `CORS_ORIGINS`, and the three
`SEED_ADMIN_*` values. The environment is validated by zod at boot
(`src/config/env.ts`), so a missing or malformed variable stops the process
immediately and names the field, rather than surfacing as a confusing 500 on
the first request that touches it.

### 2. Frontend

```bash
cd doctor_tracker_Fe
cp .env.example .env.local
npm install
npm run dev               # http://localhost:3000
```

`.env.example`:

```ini
NEXT_PUBLIC_API_BASE_URL=http://localhost:5000
```

`NEXT_PUBLIC_*` variables are **inlined into the browser bundle at build
time** — set them in Vercel *before* the build runs, not after. Changing one
and clicking "Redeploy" without a new commit does nothing until you trigger
a fresh build.

### 3. Sign in

Open `http://localhost:3000`, log in with the seeded admin above, and the
dashboard, doctors list and patients list are the three nav items.

### Scripts, both sides

Each repo installs, lints, type-checks, tests and builds on its own — no
workspace linking the two together.

| Backend | Frontend |
|---|---|
| `npm run dev` · `npm run build` · `npm start` | `npm run dev` · `npm run build` · `npm start` |
| `npm run typecheck` · `npm run lint` | `npm run typecheck` · `npm run lint` |
| `npm test` (Vitest + supertest) | `npm test` (Vitest + Testing Library) |
| `npm run seed[:admin|:doctors|:patients]` | — |
| `npm run explain` (query plans + latency) | — |

---

## System architecture

```
            Browser (Next.js app, Vercel)
                      │
       httpOnly cookie: careguide_session
                      │
                      ▼
            Express API (Vercel)
         ┌────────────┼─────────────┐
         ▼            ▼             ▼
      auth/       doctors/      patients/
     (login,     (CRUD,        (CRUD,
      logout)    search,       search,
                 facets)       soft delete)
                      │
                      ▼
              dashboard/
         (summary $facet,
          timeseries $dateTrunc)
                      │
                      ▼
                MongoDB Atlas
```

**Request path.** The browser calls the API with `credentials: 'include'`.
On every call, `authenticate` middleware reads the opaque session token out
of the `careguide_session` cookie, hashes it, looks up the matching document
in the `sessions` collection, and attaches the user to `req`. There is no
JWT, no refresh rotation and no in-memory token — one cookie, one lookup.

**Error path.** Every mutation throws an `ApiError`; `errorHandler` is the
only exit, so every failure leaves as `{ error: { code, message, details? } }`.
The frontend's `lib/api.ts` wraps `fetch`, re-throws that shape as a typed
`ApiError`, and `isValidation` tells field-level failures apart from system
ones so forms can map `details` back onto their inputs.

**State ownership, frontend.** Four kinds of state, four owners —
deliberately no single global store:

| State | Owner |
|---|---|
| Server data (doctors, patients, dashboard) | TanStack Query — its cache *is* the store |
| Auth session | Zustand (`lib/stores/auth-store.ts`) |
| Ephemeral global UI (mobile nav) | Zustand (`lib/stores/ui-store.ts`) |
| Filters, search, pagination | **The URL** (`lib/hooks/use-query-params.ts`) |
| Form state | React Hook Form + zod resolver |

Server data is never mirrored into Zustand; two copies of a list is how a
table ends up displaying something the server disagrees with.

**Layout, backend.**

```
src/
  config/env.ts        zod-validated environment, fails fast at boot
  db/connect.ts        Mongoose connection + syncIndexes (dev/test only)
  models/              User · Doctor · Patient · Session
  middleware/          authenticate · requireRole · validate · errorHandler
  modules/
    auth/              login, logout, me
    doctors/           list · create · detail · update · :id/patients
    patients/          CRUD with soft delete
    dashboard/         summary ($facet) · timeseries ($dateTrunc)
  lib/                 ApiError · pagination · tokens · timeBuckets
  scripts/seed*.ts     guarded, destructive-per-collection seeders
  app.ts  server.ts  routes.ts
```

**Layout, frontend.**

```
app/
  (auth)/login/        the only anonymous route
  (dashboard)/         layout.tsx is the auth gate
    dashboard/         totals + both charts
    doctors/           list · [id] detail
    patients/          list with soft delete
components/
  common/              app-shell · filter-bar · pagination · responsive-table
  dashboard/           patients-per-doctor-chart · registrations-chart
  doctors/  patients/  forms, columns, pickers, dialogs
  ui/                  button · card · dialog · field · page-header
lib/
  api.ts               fetch wrapper
  query-keys.ts        one place every cache key is derived from
  hooks/  stores/  types.ts
tests/                 Vitest + Testing Library
```

---

## Technical decisions

Two choices worth calling out, both because they are the ones a reviewer
would push back on first.

### 1. Opaque session cookies, not JWTs

JWT + refresh rotation is the usual answer for a React SPA talking to a
separate API. This project does the opposite: one short, random,
server-generated token, delivered in an httpOnly cookie, with the hash
stored server-side in a `sessions` collection. The access token never
exists in JavaScript on the client at all.

Why:

- **One source of truth for "logged in".** Logout is `DELETE` on the
  session document — the cookie is instantly dead everywhere, with no
  "wait up to 15 minutes for the access token to expire" window. There is
  no revocation list to maintain alongside a signing key.
- **Nothing valuable in `localStorage`.** `localStorage` is reachable from
  any script that runs on the page, including a compromised dependency,
  and FR-2 of the brief rules it out explicitly. An httpOnly cookie is not.
- **No single-flight refresh gymnastics.** With rotating refresh tokens, a
  burst of parallel 401s all try to refresh at once; the server reads the
  reuse and revokes the whole session. The usual fix is a shared in-flight
  promise in the client. With one cookie there is no refresh and no burst,
  so there is no gymnastics.
- **`SameSite`/`Secure` do the heavy lifting.** With the API and the
  frontend on different Vercel domains, the cookie is sent with
  `SameSite=None; Secure` — which also means the browser enforces HTTPS on
  every request carrying it. On localhost both flags relax to `Lax`/off.

The trade-off is a round-trip to Mongo on every authenticated request —
one indexed lookup by `tokenHash`. That is cheap, and it is the price for
being able to kill a session in one write instead of waiting for a token
to expire.

### 2. Filters live in the URL, not component state

Every list page — doctors, patients — reads its search term, filters and
page number out of `useSearchParams` and writes them back with
`router.replace`. There is no `useState` for "which page am I on" or
"what did I search for".

Why:

- **A filtered view is shareable.** Paste a URL into Slack, land on exactly
  the same page 7 with exactly the same "ENT, Dhaka" filter.
- **The back button behaves.** Browser history is already a stack of
  states; using it means the back button undoes a filter the way a user
  expects, with no custom "undo" code.
- **Hard refresh does not lose work.** Reload mid-list, land in the same
  place.
- **One source of truth for cache keys.** The TanStack Query key is
  derived from the URL params, so two tabs with the same URL share one
  cache entry instead of fetching twice.

The invariant that keeps this from biting: any filter change resets `page`
to 1. Changing a filter while on page 7 otherwise strands the user on an
empty result set, and the fix for *that* is messier than just always
resetting.

A related knock-on: search inputs are debounced
(`use-debounced-value.ts`) before they hit the URL. Writing to the URL on
every keystroke floods history and makes the back button useless;
debouncing the write, not just the query, keeps the history clean.

---

## Visual evidence

Desktop and mobile screenshots of the login, dashboard, doctors and
patients views are below. Each one is captured from the deployed app.

### Login

> _Screenshot placeholder — desktop_
>
> `![Login — desktop](./docs/screenshots/login-desktop.png)`

> _Screenshot placeholder — mobile_
>
> `![Login — mobile](./docs/screenshots/login-mobile.png)`

### Dashboard

> _Screenshot placeholder — desktop_
>
> `![Dashboard — desktop](./docs/screenshots/dashboard-desktop.png)`

> _Screenshot placeholder — mobile_
>
> `![Dashboard — mobile](./docs/screenshots/dashboard-mobile.png)`

### Doctors

> _Screenshot placeholder — desktop_
>
> `![Doctors — desktop](./docs/screenshots/doctors-desktop.png)`

> _Screenshot placeholder — mobile_
>
> `![Doctors — mobile](./docs/screenshots/doctors-mobile.png)`

### Patients

> _Screenshot placeholder — desktop_
>
> `![Patients — desktop](./docs/screenshots/patients-desktop.png)`

> _Screenshot placeholder — mobile_
>
> `![Patients — mobile](./docs/screenshots/patients-mobile.png)`

---

## Deployment notes

- **Vercel, both sides.** The frontend is a standard Next.js project; the
  backend runs the compiled Express app from `dist/`.
- **`NEXT_PUBLIC_API_BASE_URL` on Vercel must be set before building.** It
  is baked into the JS bundle at build time. A "Redeploy" of an old
  deployment reuses that deployment's original build — set the env var,
  then push a fresh commit (or use "Deploy from main").
- **Cross-domain cookies.** Once the two apps stop sharing a domain:
  - API: `CORS_ORIGINS=https://doctor-tracker-fe.vercel.app`,
    `COOKIE_SAMESITE=none`, `COOKIE_SECURE=true`.
  - Login working locally and failing in production is almost always one
    of those three.
- **Atlas Network Access.** Allowlist Vercel's egress IPs (or `0.0.0.0/0`
  for a demo cluster — this one is a demo cluster).
