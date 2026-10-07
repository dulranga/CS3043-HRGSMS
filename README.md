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

For the Member 2 room-type/amenity catalogue API core, run `npm run test:m2-catalogue-api --workspace backend`. The test mounts the route factory with test-only authorization handlers and verifies parameterized search, validation, Chain Manager writes, forbidden-role denials, active filtering, atomic amenity links, rate-snapshot persistence and reservation conflict mapping in an isolated PostgreSQL schema. This test adapter is not an application authentication mechanism; `backend/src/index.ts` mounts the production router with Member 1's M1-S09 session middleware (any signed-in user reads, CHAIN_MANAGER writes).

For the Member 2 own-branch room and dated room-block API core, run `npm run test:m2-room-api --workspace backend`. The isolated HTTP/database test verifies Branch Manager writes, permitted Service Staff reads, strict branch scoping, room-number uniqueness, active room-type checks, half-open block dates, cross-branch denial and affected-line conflicts for blocks, deactivation and room-type reassignment. `backend/src/index.ts` mounts the route factory with Member 1's M1-S09 middleware: FRONT_DESK/SERVICE_STAFF/BRANCH_MANAGER read and BRANCH_MANAGER writes, always scoped to the session's assigned branch. Physical-condition changes use Member 3's separate M3-S18 audited route factory (`PATCH /api/rooms/:roomId/condition`, `createRoomConditionRouter`), which is not yet mounted in `backend/src/index.ts`.

For the Member 2 room administration UI core (M2-S15), open `/admin/rooms` and run `npm run test:m2-room-admin-ui --workspace frontend`. The shadcn panel manages room types/amenities for Chain Managers and own-branch rooms/dated blocks for Branch Managers; Branch Managers and Service Staff use the separate audited condition endpoint. Catalogue capacity/deactivation conflicts now return affected booking lines, while the existing database guards remain authoritative. Forms validate exact decimal rates, capacities, names, UUIDs, reasons and half-open calendar dates; rejected writes retain drafts and successful writes refresh records. Vite proxies `/api` to the local backend on port 4000. The production page currently has no verified session adapter, so it loads no records and disables writes; it must be connected to Member 1's real session/CSRF contract. No browser-selected role/branch or actor header is used for production access. M2-S15 remains unchecked until authenticated end-to-end AT-23/AT-24/AT-27 checks pass. To review the interactive sample UI without a database, start the frontend and visit `/tests/room-administration-preview.html`; this development fixture uses an in-memory transport and is excluded from the production router/build.

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
- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/session` — session cookie authentication (M1-S08)
- `POST /api/auth/register` — public online guest registration; `POST /api/guests/:guestId/link-code` — FRONT_DESK issues a 24-hour link code so an existing guest profile can be claimed (M1-S10)
- `POST /api/guests/search`, `POST /api/guests`, `GET|PATCH /api/guests/:guestId`, `POST /api/guests/:guestId/deactivate|reactivate` — FRONT_DESK guest-profile maintenance (M1-S11)
- `GET /api/guest/profile`, `PATCH /api/guest/profile` — online guest own-profile read and edit (M1-S12)
- `POST /api/users/search`, `GET /api/users/:userId`, `POST /api/users`, `PATCH /api/users/:userId`, `POST /api/users/:userId/disable|reactivate` — staff-account administration (M1-S13)
- `GET /api/branches`, `GET /api/branches/:branchId`, `POST /api/branches`, `PATCH /api/branches/:branchId`, `POST /api/branches/:branchId/deactivate|reactivate` — audited branch-record administration (M1-S20)
- `GET /api/guest/bookings`, `GET /api/guest/bookings/:bookingId`, `GET /api/bookings/:bookingId/invoice|payments` — online guest own-booking and payment summary (M1-S18; read cores owned by M2/M4)
- Additional endpoints as per SRS requirements

Staff guest profiles (M1-S11) are FRONT_DESK-only and chain-wide (`guest.manage`). Responses never contain the raw NIC, only `maskedNic` (`•••••567V`) and `hasNic`. Search takes `{ query?, nic?, includeInactive?, limit? }` in a POST body so NICs stay out of URLs: `query` (2–100 characters) matches name, email or phone digits as a literal substring, and `nic` matches exactly only. Create/update share the M1-S10 identity locks: a NIC match is always refused (`GUEST_NIC_EXISTS`); an email/phone match returns `POSSIBLE_DUPLICATE` with masked candidates unless `confirmNotDuplicate: true`. Deactivation is refused while the guest has a BOOKED or CHECKED_IN line and immediately disables a linked online login. Run `npm run test:m1-guest-profiles --workspace backend`.

Staff guest-profile UI (M1-S16): `/guests` (in the staff sidebar) gives FRONT_DESK search-before-create (FR-019), a masked-NIC results table, a create form, and a detail panel with edit, deactivate/reactivate (optional reason; blocked with the open-booking count) and the deferred **Issue link code** action. Because the API never returns the raw NIC, edit uses dirty-field diffing and sends only changed keys. `POSSIBLE_DUPLICATE` lists masked candidates and offers a "different person — continue" override; `GUEST_NIC_EXISTS` has no override. Non-FRONT_DESK roles see an "Access restricted" card. The client is `frontend/src/lib/guests.ts`; the new dependency-free shadcn primitives `Table` and `Badge` live in `frontend/src/components/ui/`.

Online guest own-profile UI (M1-S17): `/account` is a guest-only page (no staff sidebar, search or navigation) that reads and edits the signed-in guest's own profile via `/api/guest/profile`. It shows only a masked NIC, uses dirty-field diffing for edits (a blank NIC keeps the current value), and enforces the one-contact rule. Staff sessions get a "this area is for guest accounts" card; deactivated sessions get a session-ended card; `POSSIBLE_DUPLICATE` offers a confirm while `GUEST_NIC_EXISTS` does not. Signed-in guests see a "My account" link in the home navigation. The client is `frontend/src/lib/guestAccount.ts`. Run `npm run test:m1-guest-account --workspace backend`.

Online guest own-profile (M1-S12) is guest-only (no staff access). The guest reads and edits only their own profile linked at account creation (M1-S10 registration). Validation and duplicate rules match the staff API; NIC is always masked. Deactivation at the staff level (M1-S11) is enforced here—a deactivated guest's existing cookie fails on the next request. The linked guest's booking and payment history is surfaced by the account summary (M1-S18) through Member 2's own-booking reads and Member 4's invoice/payment reads. Run `npm run test:m1-guest-account --workspace backend`.

Staff-account administration (M1-S13): writes are SYSTEM_ADMINISTRATOR-only (`account.write`) and reads are SYSTEM_ADMINISTRATOR/AUDITOR (`account.read`), chain-wide. Create takes `{ fullName, username, email?, phone?, nic?, branchId, roleId, password? }`; without a `password` a one-time `temporaryPassword` is returned (never stored or audited). Update accepts partial contact/branch/role changes plus `password` (a reset kills the officer's existing cookie immediately via the M1-S08 hash fingerprint). Disable/reactivate are soft flags on both `officer` and `user_account` — nothing is ever deleted (FR-074) — and an administrator cannot disable their own account. NIC is masked like the guest API, search is a POST with exact-only NIC matching, and every write is audited with only changed fields. The non-login system principal has no officer row and is unreachable. Run `npm run test:m1-staff-accounts --workspace backend`.

Branch-record administration (M1-S20, FR-008/AT-25): reads use `branch.read` (any staff role) and writes use `branch.write` (SYSTEM_ADMINISTRATOR only), both chain-wide. Create takes `{ name, city, address?, active? }`; update accepts partial `name`/`city`/`address` changes; deactivate/reactivate are explicit endpoints with an optional `reason` recorded in the audit evidence. A branch is never deleted, so rooms, officers and bookings keep a valid FK, and member 2's `m2_guard_branch_deactivation` rejects deactivation while any room in the branch has a current BOOKED/CHECKED_IN assignment, returning `BRANCH_HAS_ACTIVE_ASSIGNMENTS`. Because that trigger and Member 2's booking validation both lock the branch row, a booking cannot slip past a concurrent deactivation. Run `npm run test:m1-branches --workspace backend`.

Online guest reservations summary (M1-S18, FR-020/FR-082/AT-15): `/account` now lists the signed-in guest's own bookings below the profile. It mounts Member 2's M2-S14 read router at `/api/guest` behind Member 1's guest session middleware (`authorization.guest`) and calls Member 4's `GET /api/bookings/:bookingId/invoice|payments`, so the summary never duplicates their APIs or screens. Expanding a booking shows every room line (room type, assigned room, stay, guests, rate and line status) under its one owned booking, and the invoice/payment history is shown once per booking (no per-line duplication). Ownership is derived server-side from the authenticated account: only the guest's own booking list is returned, other-owner or guessed booking ids return `BOOKING_NOT_FOUND`, and Member 4 reads return `FORBIDDEN` for another guest's booking. The clients are `frontend/src/lib/guestBookings.ts` and `frontend/src/components/account/GuestReservations.tsx`. Run `npm run test:m1-guest-booking-summary --workspace backend`.

Online guest registration (M1-S10) creates a new `user_account` + `guest` + `guest_account`, but refuses details (email, phone or NIC) that match an existing guest profile. That guest must instead get a link code from the front desk after an identity check and register with `{ username, password, linkCode }`. Codes are HMAC-signed with `SESSION_SECRET`, bound to one guest, never stored, and stop working once the profile is linked. Failed attempts are audited and limited to 10 per client address per 15 minutes. Registration does not sign in; the client calls `/api/auth/login` next. Run `npm run test:m1-guest-registration --workspace backend`.

Online guest registration UI (M1-S15): the public `/register` route offers both M1-S10 paths behind one form — **New guest** (full name, an email or phone, optional NIC, username and password) and **I have a link code** (link code, username, password). Client-side validation mirrors the server (`frontend/src/lib/registration.ts`), and failures are mapped to safe messages: a matching profile (`PROFILE_EXISTS`) never reveals which detail matched and instead offers the link-code path, unusable/expired/reused codes (`INVALID_LINK_CODE`/`LINK_CODE_USED`), taken usernames and throttling (`TOO_MANY_ATTEMPTS` with retry minutes) are shown without leaking data, and inline field errors come from the server's `VALIDATION_ERROR.fields`. On success the page confirms the account and sends the guest to `/login` (preserving a safe `redirect`). The `Sign up`/`Get Started` calls to action and the sign-in page link here.

Sign-in UI (M1-S14): `/login` (`?redirect=`, `?reason=expired`) is one form for staff and guests, built from the shadcn `Card`/`Input`/`Button`/`Alert` primitives. It validates required fields inline with `aria-invalid`/`aria-describedby`, offers a show/hide password toggle and a busy state that blocks double submission, and maps server failures to distinct messages: wrong credentials, disabled account (`ACCOUNT_DISABLED`), throttling (with retry minutes), connection failure and expired session; the password field is cleared after a failed attempt. On success it sends staff to `/dashboard` and guests to `/`, following only a same-app sanitized `redirect`. The client is `frontend/src/lib/auth.ts` with `frontend/src/components/auth/AuthProvider.tsx`. Verified in real headless Chrome (form render, empty-submit validation, the real `INVALID_CREDENTIALS` response, and a fulfilled `ACCOUNT_DISABLED` response) alongside `npm run build:frontend`; the mapped login contract is covered by `npm run test:m1-auth --workspace backend`.

Protected `/api/*` routes require the session cookie; identity headers such as `x-user-id`/`x-role` are ignored when the router is mounted with Member 1's middleware. Staff permissions come from the version-controlled role matrix in `backend/src/authorization.ts` (M1-S09; SRS §6.1.4 working mapping pending TBD-15 sign-off). `/api/admin/*` and `/api/reports/*` use a default-deny route policy, so a new route there must be added to `ADMIN_ROUTE_POLICY`/`REPORT_ROUTE_POLICY` before it is reachable. Run `npm run test:m1-authorization --workspace backend` for the per-role, cross-branch and AT-24 checks. The frontend calls the API through relative `/api/...` URLs (Vite proxies them) so the cookie is sent.

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

## Member 2 staff booking-create UI core (M2-S17)

Open `/bookings/new` for staff-assisted multi-room booking creation. A verified Front Desk session scopes room search to its assigned branch. Add/remove unconfirmed room lines with separate dates and occupants, supply an existing primary guest record ID and Front desk/Phone/Email channel, then request the M2-S10 server quote. Review per-line base rates, the selected policy and the provisional combined room/service-charge/tax total before acknowledging and confirming. Selection edits invalidate quotes; changed catalogue/policy values require a fresh quote and another review. Inventory conflicts retain and recheck lines and refresh results. A successful server response shows the booking reference, every agreed room line and one DRAFT invoice. Lost or unreadable confirmation responses block blind retries until staff verify booking records.

Run `npm run test:m2-staff-booking-ui --workspace frontend`. For sample-only browser review, visit `/tests/staff-booking-preview.html` while Vite runs; it uses in-memory transports and is excluded from production. The production page currently shows its missing-session gate and makes no requests: Member 1 must supply verified session/branch/CSRF integration, and M2-S10's protected booking routes must be mounted, before live bookings can be created. M2-S17 remains unchecked for that dependency. Drafts live only on this page; neither room selection nor quoting reserves inventory. Guest creation/lookup, check-in, payment, cancellation and checkout use their respective owners' workflows.

## Member 2 availability search (M2-S16)

Open `/rooms` for the shared staff/direct-guest availability search. It uses public `GET /api/availability` and `GET /api/availability/options`; the latter exposes only active branch IDs/names/cities and active room-type IDs/names, so the UI does not depend on protected administration endpoints or hard-coded UUIDs. Choose a branch, per-room dates/guest count, optional type and immediate READY-only filter, then add multiple rooms. Each selected line retains its own criteria and exact catalogue rate; mixed branches and overlapping selections of the same room are refused, while adjacent intervals are allowed. Recheck selected rooms to show stale inventory or catalogue changes without silently dropping lines.

Selections remain on the page and reserve no inventory. Booking confirmation, authenticated staff/guest identity and effective-policy quotes belong to the later booking tasks; this screen issues GET requests only. The configured database must contain active room types/rooms to show real results. The development-only `/tests/availability-preview.html` fixture supplies sample data and conflict/rate-change simulations without database access and is excluded from the production build. Run `npm run test:m2-availability-ui --workspace frontend` (15 tests) and `npm run test:m2-availability --workspace backend` (isolated database/API suite).

## 📄 License

This is a university project (CS3043 - Hotel Room Group Staff Management System).
