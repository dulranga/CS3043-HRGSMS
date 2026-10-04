# SkyNest HRGSMS

A professional hotel management and booking system supporting both staff management (room allocation, employee bookings) and direct guest reservations. Built with a modern full-stack architecture.

## 🏗️ Project Structure

```
CS3043-HRGSMS/
├── frontend/           # React + Vite frontend application
├── backend/            # Express.js backend API
├── package.json        # Root workspace configuration
├── DESIGN.md           # Design system reference
├── LAYOUT.md           # Layout architecture reference
├── CONTEXT.md          # Project context and stack overview
├── SkyNest_HRGSMS_SRS_v1.0.md  # Version 1.4 draft SRS (legacy filename)
├── member_summary_table.md    # Draft member ownership and handoffs
├── member_tasks/             # One-commit-sized plans and workflow for each member
├── memory.md                 # Verified cross-task project decisions
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

The SRS uses this stack, not Next.js. It covers staff-assisted and direct online guest bookings through linked `guest_account` records. Its amended target permits multiple separately dated/priced room lines under one booking, with room-assignment history. The active Member 2 migrations implement the normalized baseline and its database integrity guards directly through M2-S28; later reservation API and UI work remains pending.

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
- Set `MIGRATIONS_DIR` to override the folder and `PG_SCHEMA` to apply into an isolated schema
  instead of `public`.
- `npm run test:migrations` proves the workflow against a clean temporary PostgreSQL schema: it
  applies fixture migrations, asserts the resulting objects, checks re-runs are skipped and verifies
  a failing migration is rolled back and not recorded. Set `PG_TEST_URL` to target a disposable
  database in CI; otherwise `PG_URL` from `backend/.env` is used.

For the Member 2 room catalogue migration, run `npm run test:m2-catalogue --workspace backend` from the repository root with `backend/.env` configured. The test applies `backend/migrations/m2_001_room_catalogue.sql` inside an isolated PostgreSQL schema and rolls it back. The shared ordered migration runner is tracked under M1-S02; this test does not install catalogue tables into the application schema.

For the Member 2 multi-room booking schema, run `npm run test:m2-booking --workspace backend`. The test creates minimal `guest` and `user_account` parents, applies `backend/migrations/m2_002_booking.sql`, and verifies that one normalized booking header can own multiple separately dated and priced room lines. It also checks line statuses, immutable status/revision histories, exact LKR rates and negative constraints. The schema never creates booking-header room facts or `booking_status_history`.

For the Member 2 target room inventory schema, run `npm run test:m2-rooms --workspace backend`. The test applies M2-S02 through M2-S04 with minimal Member 1 parents and verifies branch-scoped room numbers, dated blocks, the READY/CLEANING/OUT_OF_SERVICE condition domain and the absence of `room.booking_id`.

For the Member 2 line-based room assignment schema, run `npm run test:m2-assignments --workspace backend`. The test applies M2-S02 through M2-S05 in isolated schemas and verifies UUIDv7 assignment history, line/room foreign keys, ordered decision and occupancy timestamps, at most one open assignment per line and concurrent duplicate rejection. It also proves that one booking can hold several open line assignments and that M2-S05 does not add a booking-level room pointer or prematurely reject non-overlapping future use of the same room; M2-S06 owns the date-overlap, active-line, same-branch, block and occupancy guards.

For the Member 2 reservation-integrity guards, run `npm run test:m2-guards --workspace backend`. The test applies M2-S02 through M2-S06 in isolated PostgreSQL schemas and verifies deferred line/assignment/status-history lifecycle consistency, half-open overlap rules, same-branch bookings, checked-in occupancy, blocks, room/branch/type active-state protection and append-only assignment history. Its two-session cases prove that overlapping reservations, booking-versus-block and booking-versus-branch-deactivation races cannot commit inconsistent states.

For the Member 2 capacity and room-type edit guards, run `npm run test:m2-capacity-guards --workspace backend`. The test applies M2-S02 through M2-S28 in isolated PostgreSQL schemas and verifies assigned-line capacity at assignment and guest-count edit time, rejects unsafe room-type capacity reductions and room type changes, permits valid edits after assignment closure, preserves historical lines/rates/assignments, and exercises concurrent booking-versus-catalogue and booking-versus-room edits.

For the Member 2 room-type/amenity catalogue API core, run `npm run test:m2-catalogue-api --workspace backend`. The test mounts the route factory with test-only authorization handlers and verifies parameterized search, validation, Chain Manager writes, forbidden-role denials, active filtering, atomic amenity links, rate-snapshot persistence and reservation conflict mapping in an isolated PostgreSQL schema. The production router remains unmounted until Member 1 supplies the authenticated read and Chain Manager middleware required by M2-S07; this test adapter is not an application authentication mechanism.

For the Member 2 own-branch room and dated room-block API core, run `npm run test:m2-room-api --workspace backend`. The isolated HTTP/database test verifies Branch Manager writes, permitted Service Staff reads, strict branch scoping, room-number uniqueness, active room-type checks, half-open block dates, cross-branch denial and affected-line conflicts for blocks, deactivation and room-type reassignment. The route factory accepts Member 1 authorization/context middleware and remains unmounted until that production middleware exists. Physical-condition changes are intentionally absent from this router until Member 3 supplies the M3-S18 audited condition operation.

For the Member 2 availability function and API, run `npm run test:m2-availability --workspace backend`. Migration `m2_007` adds the parameterized `fn_available_rooms` set-returning function and an active-stay index; `GET /api/availability` accepts `branchId`, `checkIn`, `checkOut`, `guestCount`, optional `roomTypeId` and optional `immediateCheckIn` (default `false`). Results require active room/branch/type records, sufficient capacity, no overlapping block or open BOOKED/CHECKED_IN assignment and a condition other than OUT_OF_SERVICE. Immediate check-in additionally requires READY, while a non-overlapping future search may return a currently CLEANING room.

For the Member 2 staff booking-create core, run `npm run test:m2-booking-create --workspace backend`. Migration `m2_008` adds `sp_create_booking`, which rechecks the selected rooms, catalogue rates and latest published production billing policy inside one transaction, then creates one booking header, all room lines, status histories, room assignments and Member 4's DRAFT invoice atomically. The authorization-injected route factory provides quote and confirmation endpoints for own-branch Front Desk staff. It remains unmounted until Member 1 supplies the M1-S08/M1-S09 production authentication, role and branch context middleware; therefore M2-S10 remains incomplete even though its transaction and isolated API coverage pass.

For the Member 2 staff booking list/detail core, run `npm run test:m2-booking-read --workspace backend`. The authorization-injected route factory provides `GET /api/bookings` with bounded pagination and `GET /api/bookings/:bookingId`. Both derive scope exclusively from the authenticated Front Desk branch context; list rows aggregate line summaries so a multi-room booking appears once, while detail responses include every current or terminal room line plus complete status, revision and physical-room assignment histories. Out-of-branch IDs return the same not-found response as unknown IDs. The router remains unmounted until Member 1 supplies the production M1-S08/M1-S09 middleware, so M2-S11 remains incomplete.

For the Member 2/3 reconciliation, run `npm run test:m3-current-baseline --workspace backend`. It applies the numbered migration chain in temporary schemas with transaction-local schema isolation, verifies data-preserving upgrades from the published Member 3 mocks, and exercises real booking creation, guarded per-line check-in, active stays and partial checkout together. The existing `m3_001`/`m3_002` mock keys are retained; `m3_003` upgrades usage, `m3_004` upgrades the catalogue and `m3_005` upgrades history using Member 2's `room_condition_enum`. Member 3's protected route factories await Member 1 session middleware and remain unmounted. The unnumbered `backend/migrations/audit_and_config.sql` and the production runner's session-scoped schema selection on transaction pools remain separate owner gaps; do not use that runner for isolated pooled-database verification.

## 🔌 API Endpoints

The backend runs on `http://localhost:4000` and exposes:

- `GET /` — Home endpoint
- `GET /rooms` — Get all rooms
- Additional endpoints as per SRS requirements

## 📖 Design & Layout References

- **DESIGN.md** — Complete design system (colors, typography, spacing, shadows, motion)
- **LAYOUT.md** — Layout architecture and responsive design guidelines
- **CONTEXT.md** — Project context and technology stack details
- **SkyNest_HRGSMS_SRS_v1.0.md** — ER-aligned SRS draft; unresolved design decisions are in Appendix C
- **member_summary_table.md** — Proposed member tasks, table ownership and cross-team handoffs
- **member_tasks/** — Five member-specific subtask checklists and completion workflows
- **memory.md** — Durable verified project decisions; recheck against current files before use
- **member_work_log.md** — Shared record of what each member's completed or partial tasks changed and verified

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

## 🤝 Project Guidelines

- **Component Rule:** Use only shadcn components from `frontend/src/components/ui/`
- **Design System:** All visual decisions must align with `DESIGN.md`
- **Layout Architecture:** Reference `LAYOUT.md` for page structure and responsiveness
- **Git:** Never commit directly (use PR workflow as defined in project guidelines)

## 📞 Need Help?

Refer to the project documentation:
- **Architecture Questions** → Check `LAYOUT.md` and `CONTEXT.md`
- **Design Questions** → Check `DESIGN.md`
- **Requirements & Specifications** → Check `SkyNest_HRGSMS_SRS_v1.0.md`
- **Agent Guidelines** → Check `AGENTS.md`

## 📄 License

This is a university project (CS3043 - Hotel Room Group Staff Management System).
