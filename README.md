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

For the Member 2 own-branch room and dated room-block API core, run `npm run test:m2-room-api --workspace backend`. The isolated HTTP/database test verifies Branch Manager writes, permitted Service Staff reads, strict branch scoping, room-number uniqueness, active room-type checks, half-open block dates, cross-branch denial and affected-line conflicts for blocks, deactivation and room-type reassignment. The route factory accepts Member 1 authorization/context middleware and remains unmounted until that production middleware exists. Physical-condition changes use Member 3's separate M3-S18 audited route factory (`PATCH /api/rooms/:roomId/condition`), which also awaits production session middleware and mounting.

For the Member 2 room administration UI core (M2-S15), open `/admin/rooms` and run `npm run test:m2-room-admin-ui --workspace frontend`. The shadcn panel manages room types/amenities for Chain Managers and own-branch rooms/dated blocks for Branch Managers; Branch Managers and Service Staff use the separate audited condition endpoint. Catalogue capacity/deactivation conflicts now return affected booking lines, while the existing database guards remain authoritative. Forms validate exact decimal rates, capacities, names, UUIDs, reasons and half-open calendar dates; rejected writes retain drafts and successful writes refresh records. Vite proxies `/api` to the local backend on port 4000. The production page currently has no verified session adapter, so it loads no records and disables writes; it must be connected to Member 1's real session/CSRF contract after the protected backend factories are mounted. No browser-selected role/branch or actor header is used for production access. M2-S15 remains unchecked until authenticated end-to-end AT-23/AT-24/AT-27 checks pass. To review the interactive sample UI without a database, start the frontend and visit `/tests/room-administration-preview.html`; this development fixture uses an in-memory transport and is excluded from the production router/build.

For the Member 2 availability function and API, run `npm run test:m2-availability --workspace backend`. Migration `m2_007` adds the parameterized `fn_available_rooms` set-returning function and an active-stay index; `GET /api/availability` accepts `branchId`, `checkIn`, `checkOut`, `guestCount`, optional `roomTypeId` and optional `immediateCheckIn` (default `false`). Results require active room/branch/type records, sufficient capacity, no overlapping block or open BOOKED/CHECKED_IN assignment and a condition other than OUT_OF_SERVICE. Immediate check-in additionally requires READY, while a non-overlapping future search may return a currently CLEANING room.

For the Member 2 staff booking-create core, run `npm run test:m2-booking-create --workspace backend`. Migration `m2_008` adds `sp_create_booking`, which rechecks the selected rooms, catalogue rates and latest published production billing policy inside one transaction, then creates one booking header, all room lines, status histories, room assignments and Member 4's DRAFT invoice atomically. The authorization-injected route factory provides quote and confirmation endpoints for own-branch Front Desk staff. It remains unmounted until Member 1 supplies the M1-S08/M1-S09 production authentication, role and branch context middleware; therefore M2-S10 remains incomplete even though its transaction and isolated API coverage pass.

For the Member 2 staff booking list/detail core, run `npm run test:m2-booking-read --workspace backend`. The authorization-injected route factory provides `GET /api/bookings` with bounded pagination and `GET /api/bookings/:bookingId`. Both derive scope exclusively from the authenticated Front Desk branch context; list rows aggregate line summaries so a multi-room booking appears once, while detail responses include every current or terminal room line plus complete status, revision and physical-room assignment histories. Out-of-branch IDs return the same not-found response as unknown IDs. The router remains unmounted until Member 1 supplies the production M1-S08/M1-S09 middleware, so M2-S11 remains incomplete.

For the Member 2 booking-line modification core, run `npm run test:m2-booking-modify --workspace backend`. Migration `m2_009` adds atomic routines for adding a quoted BOOKED line, revisioning dates/guests/rates on a still-BOOKED line, and moving a BOOKED or CHECKED_IN line while closing and preserving the previous assignment. Every successful change refreshes Member 4's DRAFT invoice while retaining approved discounts and explicit price adjustments; a paid-down reduction can therefore return a visible credit. Checked-in dates and rates remain fixed, with a Branch Manager-approved difference stored as a signed line-attributed `PRICE_ADJUSTMENT`. The authorization-injected POST/PATCH route factory remains unmounted until Member 1's production middleware and the preceding booking tasks are complete, so M2-S12 remains incomplete.

For the Member 2 online guest booking-create core, run `npm run test:m2-online-booking --workspace backend`. Migration `m2_010` derives the booking owner exclusively from the authenticated `user_account` → `guest_account` link, forces `DIRECT_ONLINE`, rechecks every selected room and current base rate, confirms the latest effective production billing policy, and atomically creates the multi-room booking and DRAFT invoice. The `/api/guest/bookings/quote` and `/api/guest/bookings` route factory rejects client-supplied `guestId` and booking-channel fields. It remains unmounted until Member 1 supplies production online-guest session middleware, so M2-S13 remains incomplete.

For the Member 2 online guest own-booking read core, run `npm run test:m2-online-booking-read --workspace backend`. Migration `m2_011` adds the ownership/newest-first booking index, while the authorization-injected route factory provides bounded `GET /api/guest/bookings` and `GET /api/guest/bookings/:bookingId` reads. Both resolve the linked guest from the authenticated account; list results contain only that guest's bookings, detail includes every room line plus status, revision and assignment history, and unknown or other-owner IDs return the same not-found response. Internal guest/staff actor identifiers are omitted from the guest-facing DTO. The router remains unmounted until Member 1 supplies production online-guest session middleware, so M2-S14 remains incomplete.

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
- **member_work_log.md** — Current execution records; recheck against source and requirements. The removed memory file is preserved as [historical context](docs/archive/imandi-memory-2026-10-07.md).
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

## Member 2 guest My Bookings UI core (M2-S21)

`/guest/my-bookings` lists the signed-in guest's reservations, and `/guest/my-bookings/:bookingId` displays every active/terminal room line under one reference. Own history includes staff-assisted bookings as well as DIRECT_ONLINE bookings. Each line shows its own dates, guest count, agreed rate and state, previous/current room assignments, actual occupancy times, state changes and date/guest/rate revisions. Room type labels are current catalogue metadata; previous assignments and agreed rates remain preserved. The guest screen excludes internal identity/contact/condition metadata and free-text staff notes. It displays no invented booking-level status or final bill.

The GET-only client calls M2-S14's `/api/guest/bookings?limit=20&offset=…` and `/api/guest/bookings/:bookingId` with same-origin credentials. It supplies no guest/user/branch identity overrides or `x-user-id` header. Backend ownership checks authorize every request; the UI cannot establish ownership from an ID alone. Unknown and other-owner UUIDs show the same safe `Booking not found` state. Expired/denied reads clear list/detail data and require a new verified session; late responses cannot restore another booking's detail. Loading, empty, failure, reload, back and bounded pagination states are provided. Both list/detail use guest-only navigation.

Run `npm run test:m2-guest-booking-read-ui --workspace frontend`. `/tests/guest-booking-records-preview.html` is a development-only in-memory sample for mixed/all-five states, pagination, empty lists, denial, failed reads and missing/other-owner IDs; it makes no database requests or writes. Production remains gated until Member 1 supplies verified guest identity and mounts M2-S14 after its dependencies. M2-S21 stays unchecked pending authenticated live ownership checks. The old Member 4 `GuestBookingsPage.tsx` cancellation simulator is preserved but no longer mounted as My Bookings; integrating Member 4's authenticated cancellation quote/confirmation controls remains its guest action handoff. The read screen directs guests to contact SkyNest for changes/cancellation and provides no cancellation/payment/staff mutation action.

## Member 2 direct guest booking UI core (M2-S20)

`/guest/bookings/new` provides the direct guest reservation screen with guest-only navigation. It reuses multi-room availability search: every line keeps its own dates, guests and room type within one selected branch. A fresh M2-S13 server quote shows each base rate/room charge, exact-decimal service charge and tax, combined provisional total, and published policy terms. Guests must explicitly review the quote before confirming. Selection edits and rejected stale rates/policies invalidate that review; a fresh quote needs a new acknowledgement. One unavailable room rejects the entire confirmation, retains the draft and rechecks every selected line. No write is automatically replayed; unknown confirmation outcomes block another submission and direct the guest to the hotel.

The API client sends only branch/search criteria and server-quoted type/rate/policy values. Ownership and DIRECT_ONLINE channel are derived by the backend from the authenticated account, with no guest ID/actor/channel inputs. The receipt shows one reference, every agreed room line and the server's DRAFT total; guest/actor IDs, NIC/contact details and unrelated response metadata are excluded. No online payment is taken; payment is arranged through cash or verified bank transfer with the hotel.

Run `npm run test:m2-guest-booking-ui --workspace frontend`. The development-only `/tests/guest-booking-preview.html` uses sample identity, rates and an in-memory transport; it makes no database requests or payments. The production session seam is null until Member 1 supplies the verified guest session and mutation/CSRF headers. Its `accountKind` is a frontend adapter discriminator, not a database enum or authentication provider. Member 1 must finish guest identity/linking and protected M2-S13 mounting before live ownership/confirmation checks can pass; M2-S20 remains unchecked. Guest booking history (M2-S21) is a later task.

## Member 2 staff room-line modification UI core (M2-S19)

`/bookings/:bookingId/edit` opens from the staff booking detail's **Manage room lines** action. It supports adding a separately dated/priced room line, changing a still-BOOKED line's dates/guests/current catalogue rate, and moving a BOOKED or CHECKED_IN line to an available own-branch room. All other lines and complete assignment/revision/status histories remain visible. CHECKED_IN dates/guests/agreed rate stay fixed and targets require READY; this Front Desk screen sends no price adjustment, because non-zero approved differences require Branch Manager authority. Cancellation opens Member 4's existing `/cancellation` workflow; no line is deleted or cancelled here.

The client consumes M2-S12's exact POST/PATCH contracts with same-origin credentials and Member 1's verified mutation headers. It reads the assigned type from M2-S07 for BOOKED changes and rechecks M2-S09 availability for add/move reviews. Staff explicitly acknowledge each fresh review. Known rejection states explain rollback, preserve drafts and require new review; changed-state/concurrency errors require reload. Unknown mutation outcomes block another submission until refreshed booking records and explicit booking/invoice reconciliation. Success displays the authoritative DRAFT total/balance/credit and reloads full histories; failed history refresh retains committed-result proof. Credits use Member 4's manual refund workflow under the existing invoice policy.

Run `npm run test:m2-booking-modification-ui --workspace frontend`. The development-only `/tests/staff-booking-modification-preview.html` simulates changes, conflicts, credits, denial and unknown outcomes entirely in memory. The production page currently makes no requests without a verified FRONT_DESK session/branch/CSRF adapter. Member 1 must complete that integration and mount the protected M2-S07/S11/S12 routes before authenticated live checks can pass; M2-S19 remains unchecked. Branch Manager-approved non-zero adjustment integration remains an owner handoff.

## Member 2 staff booking records UI core (M2-S18)

Open `/bookings` for the assigned-branch staff booking list and `/bookings/:bookingId` for a booking's complete room-line detail. The screen consumes M2-S11's GET-only contracts with bounded pagination, showing one booking card regardless of room count and derived mixed/partial progress. Detail includes all active/terminal lines, individual dates/occupants/agreed rates, current and closed room assignments, actual occupancy segments, status history and old/new date/guest/rate revisions. Historical assignment times and agreed rates are preserved; room type/capacity/condition labels describe current catalogue values. NIC/contact data and extra response fields are excluded from the screen's DTO. Denied reads clear records and not-found/failed reads offer reload/back recovery.

Run `npm run test:m2-staff-booking-read-ui --workspace frontend`. The development-only `/tests/staff-booking-records-preview.html` offers sample history, pagination, empty/missing records and denial simulations without database requests. Production pages currently show their missing-session gate and make no requests; Member 1 must supply verified staff identity/branch middleware and mount M2-S11's protected router before authenticated live reads can pass. M2-S18 remains unchecked for that dependency.

## Member 2 staff booking-create UI core (M2-S17)

Open `/bookings/new` for staff-assisted multi-room booking creation. A verified Front Desk session scopes room search to its assigned branch. Add/remove unconfirmed room lines with separate dates and occupants, supply an existing primary guest record ID and Front desk/Phone/Email channel, then request the M2-S10 server quote. Review per-line base rates, the selected policy and the provisional combined room/service-charge/tax total before acknowledging and confirming. Selection edits invalidate quotes; changed catalogue/policy values require a fresh quote and another review. Inventory conflicts retain and recheck lines and refresh results. A successful server response shows the booking reference, every agreed room line and one DRAFT invoice. Lost or unreadable confirmation responses block blind retries until staff verify booking records.

Run `npm run test:m2-staff-booking-ui --workspace frontend`. For sample-only browser review, visit `/tests/staff-booking-preview.html` while Vite runs; it uses in-memory transports and is excluded from production. The production page currently shows its missing-session gate and makes no requests: Member 1 must supply verified session/branch/CSRF integration, and M2-S10's protected booking routes must be mounted, before live bookings can be created. M2-S17 remains unchecked for that dependency. Drafts live only on this page; neither room selection nor quoting reserves inventory. Guest creation/lookup, check-in, payment, cancellation and checkout use their respective owners' workflows.

## Member 2 availability search (M2-S16)

Open `/rooms` for the shared staff/direct-guest availability search. It uses public `GET /api/availability` and `GET /api/availability/options`; the latter exposes only active branch IDs/names/cities and active room-type IDs/names, so the UI does not depend on protected administration endpoints or hard-coded UUIDs. Choose a branch, per-room dates/guest count, optional type and immediate READY-only filter, then add multiple rooms. Each selected line retains its own criteria and exact catalogue rate; mixed branches and overlapping selections of the same room are refused, while adjacent intervals are allowed. Recheck selected rooms to show stale inventory or catalogue changes without silently dropping lines.

Selections remain on the page and reserve no inventory. Booking confirmation, authenticated staff/guest identity and effective-policy quotes belong to the later booking tasks; this screen issues GET requests only. The configured database must contain active room types/rooms to show real results. The development-only `/tests/availability-preview.html` fixture supplies sample data and conflict/rate-change simulations without database access and is excluded from the production build. Run `npm run test:m2-availability-ui --workspace frontend` (15 tests) and `npm run test:m2-availability --workspace backend` (isolated database/API suite).

## 📄 License

This is a university project (CS3043 - Hotel Room Group Staff Management System).
