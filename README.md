# SkyNest HRGSMS

A professional hotel management and booking system supporting both staff management (room allocation, employee bookings) and direct guest reservations. Built with a modern full-stack architecture.

## 👥 Member Contributions

The following summarizes each member's contribution area and implemented work recorded in the [shared work log](member_work_log.md) and [member handoffs](member_summary_table.md). Integration and follow-up fixes span multiple members; this summary does not mark every planned subtask as complete.

| Member | Contribution area | Recorded contributions |
|---|---|---|
| **Member 1 — Dulranga** | Identity, guests and shared foundations | Ordered database migrations; branch, role, staff and guest-account schemas; password-based login/logout, secure sessions, role/branch authorization and guest ownership checks; registration, guest-profile and account screens; audited staff/branch administration APIs; append-only audit logging, non-financial configuration and versioned billing policies; shared staff dashboard and navigation. |
| **Member 2 — Imandi** | Room inventory, availability and reservations | Room-type/amenity catalogue and branch room/block management; normalized multi-room bookings with separately dated/priced room lines and assignment/revision/status histories; lifecycle, overlap, concurrency and capacity guards; availability search and multiple-room selection; staff booking creation, list/detail and room-line modification; direct guest booking and own-booking history APIs/screens; reservation contracts and integration verification. |
| **Member 3 — Kulunu** | Check-in, active stays and services | Service catalogue, service-usage and physical-condition history schemas; per-room-line check-in and active-stay APIs/screens; service recording with price snapshots and room-line or booking-wide attribution; controlled service voiding with draft-invoice refresh; audited READY/CLEANING/OUT_OF_SERVICE transitions; lifecycle integration tests and room-history compatibility repairs. |
| **Member 4 — Chamikara** | Billing, payments and end-of-stay workflows | Invoice, invoice-line and payment/refund schemas; exact LKR charge calculation, policy-linked DRAFT/FINAL invoices and consolidated balances; partial payments, manual refunds and payment history; per-line checkout with an exact-zero balance gate; per-line/whole-booking cancellation and per-line no-show workflows; staff billing screens, shared booking finder and cancellation quote/receipt repairs. |
| **Member 5 — Thusath** | Reporting, administration and audit review | Reporting views/queries, APIs and screens for current occupancy, guest billing, service usage, monthly branch revenue and top services; shared report filters and CSV exports; branch/account administration and non-financial configuration screens using Member 1's contracts; audit-log review and entity filtering; report reconciliation, authorization and export-parity repairs. |

Detailed scope and acceptance status: [Dulranga](member_tasks/member_1_dulranga.md), [Imandi](member_tasks/member_2_imandi.md), [Kulunu](member_tasks/member_3_kulunu.md), [Chamikara](member_tasks/member_4_chamikara.md) and [Thusath](member_tasks/member_5_thusath.md). Remaining handoffs include full owner acceptance, authenticated guest cancellation controls, Branch Manager-approved price adjustments and historical reporting/admin features identified in the work log.

## 🏗️ Project Structure

```
CS3043-HRGSMS/
├── frontend/           # React + Vite frontend application
├── backend/            # Express.js backend API
├── package.json        # Root workspace configuration
├── docker-compose.yml  # Full local stack (db + migrations + backend + frontend)
├── .env.example        # Docker Compose configuration template
├── backend/Dockerfile  # Backend image (Express + TypeScript)
├── frontend/Dockerfile # Frontend image (Vite build served by Vite preview)
├── DESIGN.md           # Design system reference
├── LAYOUT.md           # Layout architecture reference
├── CONTEXT.md          # Project context and stack overview
├── SkyNest_HRGSMS_SRS_v1.0.md  # Version 1.4 draft SRS (legacy filename)
├── member_summary_table.md    # Draft member ownership and handoffs
├── member_tasks/             # One-commit-sized plans and workflow for each member
├── docs/archive/             # Historical project records (not active decisions)
└── member_work_log.md         # Shared actual-work log, organized by member
```

## 🛠️ Tech Stack

**Frontend:**
- React 18 with TypeScript
- Vite (fast build tool & dev server)
- Tailwind CSS v4
- shadcn/ui components
- TanStack React Router for routing

**Backend:**
- Express.js with TypeScript
- CORS enabled for cross-origin requests
- Node.js runtime

**Database:**
- PostgreSQL 18 with native UUIDv7 generation (`uuidv7()`)
- Parameterized raw SQL; Member 2's rate fields use exact LKR `numeric(12,2)`

The SRS uses this stack, not Next.js. It covers staff-assisted and direct online guest bookings through linked `guest_account` records. Its amended target permits multiple separately dated/priced room lines under one booking, with room-assignment history. The active Member 2 migrations implement the normalized baseline and its database integrity guards directly through M2-S28; reservation API/UI integration is mounted with verified sessions, with remaining owner acceptance described in the integration audit.

## 📋 Prerequisites

Before you begin, ensure you have installed:
- **Node.js** (v18 or higher) — [Download](https://nodejs.org/)
- **npm** (comes with Node.js)
- **PostgreSQL 18** for database migrations and integration tests
- A code editor (VS Code recommended)

Verify installation:
```bash
node --version
npm --version
```

## 🚀 Quick Start

### 1. Install Dependencies

Install all dependencies for both frontend and backend from the root directory:

```bash
npm install
```

This uses npm workspaces to install dependencies in both `frontend/` and `backend/` directories.

### 2. Start Development Servers

Run both frontend and backend in parallel:

**Terminal 1 - Backend:**
```bash
npm run dev:backend
```
Backend will start on `http://localhost:4000`

**Terminal 2 - Frontend:**
```bash
npm run dev:frontend
```
Frontend will start on `http://localhost:5173` (Vite default)

Both should be running to ensure full functionality.

The backend allows up to 15 seconds to establish a PostgreSQL connection, including
hosted-database wake-up and TLS authentication. If registration reports a temporary
service failure, check backend/database connectivity before retrying. Run
`npm run test:db-connection --workspace backend` to verify delayed connection handling;
this check uses the configured database with read-only SQL through a local delay proxy.

## 📝 Available Commands

### Root Level Commands

```bash
# Install dependencies
npm install

# Run both servers in separate terminals
npm run dev:backend     # Start Express backend (port 4000)
npm run dev:frontend    # Start Vite frontend (port 5173)

# Build for production
npm run build:backend   # Compile backend TypeScript
npm run build:frontend  # Build frontend for production
```

### Frontend Commands

```bash
cd frontend

npm run dev      # Start Vite dev server
npm run build    # Build for production (TS check + Vite bundle)
npm run preview  # Preview production build
```

### Backend Commands

```bash
cd backend

npm run dev              # Start with tsx watch (auto-reload on file changes)
npm run build            # Compile TypeScript to dist/
npm run start            # Run compiled JavaScript (use after build)
npm run migrate          # Apply pending SQL migrations using PG_URL
npm run seed             # Seed additive demonstration data (idempotent; see below)
npm run test:seed        # Verify the seed on an isolated schema, including idempotency
npm run test:migrations  # Apply migrations to an isolated temp schema and assert
```

### Database migrations

Version-controlled SQL migrations live in `backend/migrations/` and are applied in order by
`backend/src/migrations/migrate.ts`. Name every file `<memberid>_<version>_<name>.sql`, for example
`m1_001_create_branch_and_role.sql`; a bare `<version>_<name>.sql` (no member prefix, e.g.
`0000_create_audit_and_config.sql`) is also accepted and runs first as a bootstrap. The runner
rejects malformed names and duplicate `<memberid>_<version>` keys, and orders migrations by member
number (`m1` before `m2`) and then version.

- `npm run migrate` (or `node dist/migrations/cli.js` after a build) applies pending files against
  `PG_URL`, recording each in `schema_migrations`. Every file runs inside its own transaction, so a
  failure rolls back that file only and stops the run; a session advisory lock serialises concurrent
  runners.
- Supply a direct, session-capable `PG_URL` when running migrations. Transaction-pooler URLs do
  not preserve the advisory lock/search path between migrations. The CLI uses the supplied URL
  unchanged; the root test runner prepares a direct connection for its isolated suites.
- Set `MIGRATIONS_DIR` to override the folder and `PG_SCHEMA` to apply into an isolated schema
  instead of `public`.
- `npm run test:migrations` proves the workflow against a clean temporary PostgreSQL schema: it
  applies fixture migrations, asserts the resulting objects, checks re-runs are skipped and verifies
  a failing migration is rolled back and not recorded. Set `PG_TEST_URL` to target a disposable
  database in CI; otherwise `PG_URL` from `backend/.env` is used.

### Seeding demonstration data

`npm run seed` (or `node dist/seed/cli.js` after a build) loads the additive demonstration dataset for manual and UI testing: demonstration staff and one online guest, room types/amenities/rooms, a six-service catalogue, non-demo billing policy, dated room block and six bookings covering the full lifecycle (two-room different-rate, two-simultaneous-Single, checked-in, cancelled, no-show and DIRECT_ONLINE guest booking) with partial and settling payments plus service usage and one voided charge.

- **Idempotent and additive:** the seed resolves or creates every entity by a stable natural key (`demo.*` usernames, `DEMO-*` booking references, `Demo *` catalogue names), drives the real SQL contracts (`sp_create_booking`, `sp_create_online_guest_booking`, check-in, service usage, `fn_record_payment`, checkout, cancellation, no-show) and never mutates or deletes non-demo rows. Re-running adds only missing work.
- **Sign in** with `demo.chain`, `demo.frontdesk`, `demo.service`, `demo.branchmanager`, `demo.admin`, `demo.auditor`, `demo.frontdesk.kandy` or `demo.guest`; the password is `SkyNest#2026` (override with `DEMO_SEED_PASSWORD`).
- **Isolated, repeatable runs:** `npm run seed -- --schema demo` applies the migration chain into a new `demo` schema and seeds it; add `--reset` to drop and rebuild that schema first. `--reset` requires `--schema` and never targets the shared `public` schema.
- `npm run test:seed` verifies the Table 48 baseline and idempotency in a throwaway schema.
- The shared development database currently has a drifted `room_status_history` (a pre-`reason` mock table using the old `room_condition` enum), so the audited `fn_set_room_condition` and therefore the checkout transaction cannot run there. The seed detects this, applies guarded initial conditions directly and skips only the checkout/FINAL-invoice demonstration; use an isolated schema (or a clean database) for a FINAL invoice.


## 🔌 API Endpoints

The backend runs on `http://localhost:4000` and exposes:

- `GET /` — Home endpoint
- `GET /rooms` — Get all rooms
- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/session` — session cookie authentication (M1-S08)
- `POST /api/auth/register` — public online guest registration; `POST /api/guests/:guestId/link-code` — FRONT_DESK issues a 24-hour link code so an existing guest profile can be claimed (M1-S10)
- `POST /api/guests/search`, `POST /api/guests`, `GET|PATCH /api/guests/:guestId`, `POST /api/guests/:guestId/deactivate|reactivate` — FRONT_DESK guest-profile maintenance (M1-S11)
- `GET /api/guest/profile`, `PATCH /api/guest/profile` — online guest own-profile read and edit (M1-S12)
- `POST /api/users/search`, `GET /api/users/:userId`, `POST /api/users`, `PATCH /api/users/:userId`, `POST /api/users/:userId/disable|reactivate` — staff-account administration (M1-S13)
- `GET /api/branches`, `GET /api/branches/:branchId`, `POST /api/branches`, `PATCH /api/branches/:branchId`, `POST /api/branches/:branchId/deactivate|reactivate` — audited branch-record administration (M1-S20)
- `GET /api/guest/bookings`, `GET /api/guest/bookings/:bookingId`, `GET /api/bookings/:bookingId/invoice|payments` — online guest own-booking and payment summary (M1-S18; read cores owned by M2/M4)
- Additional endpoints as per SRS requirements



## Integration verification (8 October 2026)

Run all current automated suites from the repository root:

```bash
npm test
npm run test:frontend
npm run test:backend
```


## 📖 Design & Layout References

- **DESIGN.md** — Complete design system (colors, typography, spacing, shadows, motion)
- **LAYOUT.md** — Layout architecture and responsive design guidelines
- **CONTEXT.md** — Project context and technology stack details
- **SkyNest_HRGSMS_SRS_v1.0.md** — ER-aligned SRS draft; unresolved design decisions are in Appendix C
- **member_summary_table.md** — Proposed member tasks, table ownership and cross-team handoffs
- **member_tasks/** — Five member-specific subtask checklists and completion workflows
- **member_work_log.md** — Current execution records; recheck against source and requirements. The removed memory file is preserved as [historical context](docs/archive/imandi-memory-2026-10-07.md).

Always refer to these documents when making design or layout decisions.

## 🎨 Component Library

All UI components use shadcn/ui primitives located in `frontend/src/components/ui/`. Always extend existing shadcn components rather than building custom ones.

Key utilities:
- `cn()` helper in `frontend/src/lib/utils.ts` — Combines clsx + tailwind-merge for className management

## 🔧 Development Tips

### Frontend
- Hot Module Replacement (HMR) is enabled — changes reflect instantly
- TypeScript strict mode is enabled
- Path alias `@/` maps to `frontend/src/`

### Backend
- Uses `tsx watch` for automatic restart on file changes
- Environment variables can be set in a `.env` file (default PORT=4000)
- `SESSION_SECRET` (at least 32 characters) is required to start the server; see `backend/.env.example`. For plain-HTTP local development set `SESSION_COOKIE_SECURE=false` (rejected in production)
- CORS is enabled for frontend requests

### TypeScript
Both frontend and backend use TypeScript. Run type checking:

```bash
# Frontend
cd frontend && npx tsc --noEmit

# Backend
cd backend && npx tsc --noEmit
```

## 📦 Building for Production

### Frontend
```bash
npm run build:frontend
```
Creates optimized static files in `frontend/dist/`

### Backend
```bash
npm run build:backend
```
Compiles TypeScript to JavaScript in `backend/dist/`

Then run with:
```bash
cd backend && npm start
```

## 🐳 Docker (frontend + backend + PostgreSQL)

Run the whole stack with Docker Compose. The application images are pulled from
GitHub Container Registry (built by `.github/workflows/docker-publish.yml`); the
frontend is the static Vite build served by Vite's preview server, which also
reverse-proxies `/api` to the Express backend on the same origin, so the HTTP-only
session cookie works without any cross-site setup.

```bash
cp .env.example .env        # then set SESSION_SECRET (openssl rand -hex 32)
docker compose pull         # optional: refresh the :latest app images
docker compose up           # db -> one-shot migrations -> backend -> frontend
```

- Open the app at **http://localhost:8080** (override with `FRONTEND_PORT`).
- The backend is also published on `http://localhost:4000` (`BACKEND_PORT`).
- PostgreSQL 18 is required (its native `uuidv7()` is the default for every
  primary key); data lives in the `db-data` volume and is published on
  `POSTGRES_PORT`.

Images and layout:

- `docker-compose.yml` — pulls
  `ghcr.io/dulranga/cs3043-hrgsms/skynest-backend:latest` and
  `ghcr.io/dulranga/cs3043-hrgsms/skynest-frontend:latest` (multi-arch:
  `linux/amd64` + `linux/arm64`; override `BACKEND_IMAGE` / `FRONTEND_IMAGE` in
  `.env` to pin a tag or use a local build), plus `db` (healthchecked), `migrate`
  (one-shot, idempotent SQL runner invoked as `backend/dist/migrations/cli.js`)
  and an optional `seed` profile.
- `backend/Dockerfile` and `frontend/Dockerfile` build those images (in CI, or
  locally with `docker build -f backend/Dockerfile .`).

Load the idempotent demonstration dataset into the running stack:

```bash
docker compose --profile seed run --rm seed
# then sign in with demo.frontdesk / SkyNest#2026 (see the seeding notes above)
```

Stop the stack with `docker compose down` (add `-v` to also delete the database
volume). The app forces `Secure` cookies when `NODE_ENV=production`;
`http://localhost` is treated as a secure context by Chrome/Firefox/Edge, so the
defaults sign in fine. To use plain HTTP from a non-localhost host or Safari, set
`NODE_ENV=development` and `SESSION_COOKIE_SECURE=false` in `.env`.

### Deploy to Azure Container Apps

`.github/workflows/docker-publish.yml` builds and pushes both images on every
push to `dev`, then redeploys them to Azure Container Apps. Azure access uses
GitHub's OIDC federation — GitHub mints a short-lived token, Azure exchanges it,
and the federated identity holds an RBAC role assignment — so no long-lived
Azure secret is stored.

One-time Azure setup:

1. Create the identity — an Azure AD **app registration** or a **user-assigned
   managed identity** — and add a **federated credential** for this repository,
   e.g. `repo:<owner>/<repo>:ref:refs/heads/dev` (add more for any other
   refs/environments you deploy from).
2. Grant that identity an **RBAC role** that can update Container Apps (e.g.
   **Contributor** on the resource group).
3. Set repository **secrets**: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
   `AZURE_SUBSCRIPTION_ID`.
4. Set repository **variables**: `AZURE_RESOURCE_GROUP`,
   `AZURE_CONTAINER_APP_BACKEND`, `AZURE_CONTAINER_APP_FRONTEND` (the container
   app names).

Per app, the job runs `az containerapp update --image <ghcr image>:<git-sha>`,
which creates and activates a new revision — i.e. a redeploy. The container apps
must be able to pull the GHCR images: make the packages public or configure
registry credentials on each app.

## 🤝 Project Guidelines

- **Component Rule:** Use only shadcn components from `frontend/src/components/ui/`
- **Design System:** All visual decisions must align with `DESIGN.md`
- **Layout Architecture:** Reference `LAYOUT.md` for page structure and responsiveness
- **Git:** Agents must never create branches, commits, pushes or pull requests; provide proposed handoff text for a human.

## 📞 Need Help?

Refer to the project documentation:
- **Architecture Questions** → Check `LAYOUT.md` and `CONTEXT.md`
- **Design Questions** → Check `DESIGN.md`
- **Requirements & Specifications** → Check `SkyNest_HRGSMS_SRS_v1.0.md`
- **Agent Guidelines** → Check `AGENTS.md`



## 📄 License

This is a university project (CS3043 - Hotel Room Group Staff Management System).
