# SkyNest shared member work log

Record actual project-task work here for all five members, including partial or blocked outcomes. Under the relevant member section, include the date and task ID, changes made, tests/build commands and results, decisions/handoffs, and remaining work. Do not claim a checklist item complete without acceptance evidence. Do not record secrets or real guest data. Keep durable project decisions in `memory.md` as well.

## Member 1 — Dulranga

### 25 September 2026 — M1-S03 / M1-S04 (branch, role, user_account, officer)

- Added `backend/migrations/0001_create_branch_and_role.sql`: `branch` and `role` per SRS Table 40 plus the §6.1.4 role set. UUIDv7 PKs with version checks, `timestamptz` timestamps, non-blank `name`/`city`/`role_name`, ER `text(65535)` on `branch.address` mapped to PostgreSQL `text` with a 65,535-char cap, `active` defaults true, unique `role_name`. No branch-name unique constraint (TBD-14 leaves natural keys open). Seeded the three chain branches (Colombo, Kandy, Galle — A/D-01, FR-008) and the six §6.1.4 roles (FRONT_DESK, SERVICE_STAFF, BRANCH_MANAGER, CHAIN_MANAGER, SYSTEM_ADMINISTRATOR, AUDITOR).
- Added `backend/migrations/0002_create_user_account_and_officer.sql`: `user_account` (unique non-blank `username`, nullable `password_hash` mapped to `text` with cap, `last_login_at`, `active`) and shared-key `officer` (`officer_id` is both PK and FK to `user_account.user_id`; role/branch FKs on `officer` only). Adopted the §6.1.4 identity contract: `nic varchar(255)` optional, stored trimmed/uppercase via CHECK, unique among non-null officers via a partial unique index. Seeded one dedicated non-login system principal (`username='system'`, null `password_hash`, fixed UUIDv7 `01a0d81b-502c-7c85-95b8-401c6323f1db`).
- Added `backend/tests/m1Identity.test.cjs` and the `test:m1-identity` script. The isolated-schema test applies 0001→0002, verifies column/type inventories, UUIDv7 generation/rejection (uuidv4 + nil), seed counts (3 branches, 6 roles, 1 system principal), role-name uniqueness/non-blank, address/password 65,535 caps, shared-key officer insert, branch/role FK rejection, non-normalized and duplicate `nic` rejection, deactivation (active=false) and restricted parent deletion.
- Verification: `npm run test:m1-identity --workspace backend` passed (1 test). `npm run build:backend`, `node --check backend/tests/m1Identity.test.cjs` and `git diff --check` passed. The scratch schema rolled back, so the application schema was not modified.
- Remaining handoffs: (1) `npm run migrate` cannot yet apply the ordered chain because `backend/migrations/create_audit_and_config.sql` and the `m2_*` files do not use the `<version>_<name>.sql` convention (the runner rejects `create_audit_and_config.sql`); Members 2/5 need to rename/relocate those before the full chain runs. (2) M1-S01 owner sign-off on the identity choices is still open; this task adopted the §6.1.4 working target as directed, not a formally approved contract. (3) The role-permission matrix itself remains under TBD-15 (M1-S09). (4) Disjoint staff/guest-account enforcement is deferred until `guest_account` (M1-S05) exists.
- Lecture concepts applied: shared-key one-to-one (officer PK = user_account FK), partial unique B-tree index for "unique among non-null" NIC, typed referential integrity with restricted parent deletion, domain CHECK constraints for normalized text, and exact UUIDv7 identity keys.

### 25 September 2026 — M1-S05 (guest, guest_account)

- Added `backend/migrations/0003_create_guest_and_guest_account.sql`: `guest` (optional trimmed/uppercase `nic` with a partial unique index, non-blank `full_name`, `active`) and `guest_account` (UUIDv7 PK, required + unique `guest_id` and `user_id` FKs — one online account per guest and vice versa). Added two BEFORE triggers enforcing the §6.1.4 disjoint staff/guest rule in both directions: a `user_account` that is already an `officer` cannot be linked as a `guest_account`, and a `user_account` already linked as a `guest_account` cannot become an `officer` (SQLSTATE 23514).
- Added `backend/tests/m1Guests.test.cjs` and the `test:m1-guests` script. The isolated-schema test applies 0001→0003, verifies column inventories, UUIDv7 generation, a valid normalized guest + one-to-one link, duplicate/takeover-prone links (one account per guest and one guest per account), FK integrity, non-normalized and duplicate NIC rejection, both disjoint staff/guest trigger directions, and restricted parent deletion.
- Verification: `npm run test:m1-guests --workspace backend` passed (1 test). `npm run build:backend`, `node --check backend/tests/m1Guests.test.cjs` and `git diff --check` passed. Scratch schema rolled back; the application schema was not modified.
- Remaining handoffs: M1-S01 owner sign-off on the identity contract is still open (this adopts the §6.1.4 working target); the disjointness is now DB-enforced, but the takeover "proof of contact/identity control" at registration is an M1-S10 application-layer concern. The runner naming coordination gap with `create_audit_and_config.sql` and `m2_*` files still blocks a full `npm run migrate`.
- Lecture concepts applied: one-to-one cardinality via unique FKs, partial unique indexes, database-enforced disjointness with BEFORE triggers, and referential integrity with restricted deletion.

### 25 September 2026 — migration naming convention change

- Changed the migration runner (`backend/src/migrations/migrate.ts`) from a numeric `<version>_<name>.sql` pattern to `<memberid>_<version>_<name>.sql`. A bare `<version>_<name>.sql` (no member prefix) is still accepted and treated as a bootstrap that sorts first. Sorting is member number (`m1` before `m2`) then version; the `schema_migrations.version` key is now `<memberid>_<version>` (or the bare `<version>` for bootstrap files).
- Renamed Member 1's migrations to the new convention: `m1_001_create_branch_and_role.sql`, `m1_002_create_user_account_and_officer.sql`, `m1_003_create_guest_and_guest_account.sql`. `create_audit_and_config.sql` is present as `0000_create_audit_and_config.sql` (bootstrap) and still needs reconciliation with M1-S06/M1-S07.
- Updated `backend/tests/migrationRunner.test.ts` fixtures/assertions to `m0_*` names, the two M1 test files' migration path references, and the README migration-naming section.
- Verification: `npm run test:migrations --workspace backend` passed (3 tests); `npm run test:m1-identity` and `npm run test:m1-guests` each passed (1 test); `npm run build:backend` and `git diff --check` passed. A full ordered-chain apply in a scratch schema applied all 8 migrations (0 skipped) and created all expected tables, then dropped the schema. No migration was applied to the application schema.
- Handoff: `npm run migrate` now loads and orders all current files; the `0000_` audit/config bootstrap still conflicts with the target `audit_log`/`system_config` DDL I own, to be resolved in M1-S06/M1-S07.

### 29 September 2026 — M1-S06 (audit_log append-only contract)

- Added `backend/migrations/m1_004_create_audit_log.sql`, a corrective migration that reconciles the legacy `0000_create_audit_and_config.sql` placeholder `audit_log` by dropping it and rebuilding the target table. Columns match Table 40 plus the shared actor contract: `audit_id uuidv7` PK with a version check, required `user_id` FK → `user_account.user_id` (restricted), non-blank `entity_name`/`entity_id varchar(255)`, `action varchar(50)` with the 11-label §6.1.4 CHECK (`CREATE, UPDATE, DELETE, DEACTIVATE, REACTIVATE, STATUS_CHANGE, VOID, REVERSE, PUBLISH, LOGIN, LOGOUT`), `before_value`/`after_value text` capped at 65,535 chars, `changed_at timestamptz NOT NULL` and `ip_address varchar(255)`. DBR-025 indexes cover `changed_at`, `user_id`, `(entity_name, entity_id)` and `action`. A `BEFORE UPDATE OR DELETE` trigger raises SQLSTATE 55000, making the table append-only (FR-079/DBR-011/NFR-SAF-04).
- Added `backend/src/audit.ts` exporting `AUDIT_ACTIONS` (the 11 controlled labels), `maskSensitiveValues` (recursively redacts password/password_hash/NIC/token/secret keys in before/after evidence) and `appendAudit` (inserts one masked audit entry against a queryable client).
- Added `backend/tests/m1Audit.test.ts` and the `test:m1-audit` script. One test covers redaction in isolation; the other applies m1_001→m1_004 in a clean scratch schema and verifies the column/type inventory, that all 11 labels insert (and an unknown label is rejected 23514), actor FK rejection (23503) and non-null actor (23502), UUIDv7-only IDs, non-blank entity fields, text(65535) caps, masked `appendAudit` evidence, append-only UPDATE/DELETE denial (55000) and restricted actor deletion (23001).
- Verification: `npm run test:m1-audit --workspace backend` passed (2 tests). `npm run test:m1-identity`, `npm run test:m1-guests` and `npm run test:migrations` each passed (1/1/3 tests). `npm run build:backend` and `git diff --check` passed. A full ordered-chain apply in a scratch schema applied all 11 files (0000 + m1_001..m1_004 + m2_001..m2_006, 0 skipped) and was then dropped. Scratch schemas rolled back; no migration was applied to the application schema.
- Remaining handoffs: (1) the app DB's legacy placeholder `audit_log` still holds two pre-contract `system_config` test rows (null actor, UUIDv4 ids) that `npm run migrate` will drop when m1_004 runs — these are not business evidence. (2) `system_config` stays unreconciled until M1-S07. (3) `adminController.ts` (`updateSystemConfig` writes `user_id || null`, `getAuditLogs` reads unfiltered) predates this contract and is superseded by M1-S08/M1-S13/M1-S20. (4) `appendAudit`/`maskSensitiveValues` are ready for M1-S08 login/logout, M1-S13 account admin and M1-S19 policy publication.
- Lecture concepts applied: append-only history via a BEFORE UPDATE/DELETE trigger, typed referential integrity with restricted deletion, domain CHECK constraints (controlled action label set), exact UUIDv7 identity keys and supporting indexes for audit lookups.

### 3 October 2026 — M1-S19 (typed append-only billing_policy)

- Added `backend/migrations/m1_005_create_billing_policy.sql` per SRS §4.7.4/§6.1.4/FR-076/DBR-035: UUIDv7 PK, `effective_from date`, three `numeric(5,2)` percentages (0–100), three `numeric(12,2)` LKR fees (≥ 0), `no_show_grace_days smallint` (1–7), required `is_demo`, `created_by` restricted FK to `user_account.user_id`, `created_at timestamptz`, unique (`effective_from`, `created_at`) and a descending lookup index. A BEFORE INSERT trigger takes a transaction advisory lock (serializing publication), overwrites `created_at` with `clock_timestamp()`, and allows only an active CHAIN_MANAGER officer (SRS §6.1.4 working mapping) or the non-login system principal for `is_demo` rows (else SQLSTATE 42501). An AFTER INSERT trigger writes a PUBLISH `audit_log` row by the publisher in the same transaction; UPDATE/DELETE/TRUNCATE raise 55000. Seeds one `is_demo=true` zero-rate/zero-fee/one-grace-day policy effective 2026-01-01 by the system principal.
- Member 4's interim `m1_004_billing_policy_mock.sql` (origin/dev, commit 7e8d1a6) already creates a same-column `billing_policy` that `m4_001`'s `invoice.billing_policy_id` references, and the shared dev DB ran it. m1_005 therefore uses `CREATE TABLE IF NOT EXISTS`, reuses the mock's `billing_policy_effective_created_unique` name, adds the missing default/UUIDv7 check/index/triggers in place and seeds the demo row only if none exists, so it upgrades the mock without dropping the invoice FK and re-runs idempotently.
- Added `backend/src/billingPolicy.ts`: `validateBillingPolicyInput` (field errors; rejects `isDemo` in production), `publishBillingPolicy`, `findEffectiveBillingPolicy(client, env, confirmedAt?)` (latest by `effective_from`, `created_at`, id descending; `effective_from` ≤ Asia/Colombo confirmation date and `created_at` ≤ confirmation time; production excludes demo rows and returns null to block confirmation; defaults to transaction `now()`; accepts timestamptz text to keep microseconds), `getBillingPolicy`, `listBillingPolicies`. Money is exchanged as decimal strings.
- Added `backend/tests/m1BillingPolicy.test.ts` and `test:m1-billing-policy`: validation unit test; clean-schema test (column types/precision, demo seed + audit, invalid ranges/null/UUIDv4 rejection, DB-set `created_at`, FRONT_DESK/BRANCH_MANAGER/SYSTEM_ADMINISTRATOR/inactive CHAIN_MANAGER/guest/system-non-demo/unknown publication denial, production demo rejection, PUBLISH audit, same-date correction ordering and confirmation-time cutoff, Asia/Colombo midnight boundary, history ordering, append-only denial, restricted actor deletion); mock-upgrade/idempotent re-run test; two-session test where the second same-date publication blocks on the lock and receives a later `created_at`.
- Fixed `tests/m1Audit.test.ts` to use only its scratch schema on `search_path`: with `public` included, m1_004's unqualified `DROP TABLE IF EXISTS audit_log` resolved to `public.audit_log` (rolled back, and stopped by a dev-DB view, but unsafe).
- Verification: `npm run test:m1-billing-policy` 4/4 pass; `test:m1-identity` 1, `test:m1-guests` 1, `test:m1-audit` 2, `test:migrations` 3, `test:m2-room-lines` 2, `test:m2-guards` 2 pass; `npm run build:backend` and `git diff --check` pass. The runner applied all 12 files to a scratch schema (re-run: 0 applied, 12 skipped; one demo policy and its PUBLISH audit row), then the schema was dropped. No application schema was changed.
- Remaining handoffs: (1) Merge blocker: dev's `m1_004_billing_policy_mock.sql` and this branch's `m1_004_create_audit_log.sql` share runner key `m1_004` (the runner rejects duplicates); the mock should be removed when merging, since m1_005 supersedes it. The shared dev DB recorded `m1_004` as the mock, so its `audit_log` is still the legacy placeholder and needs a reviewed reconciliation there. (2) HTTP publish/read endpoints wait for M1-S08 sessions and M1-S09 authorization; CHAIN_MANAGER-only publication follows the SRS working mapping pending TBD-15 sign-off. (3) Members 2/4 should call `findEffectiveBillingPolicy` inside the confirmation transaction and store the returned id on the invoice. (4) Production non-demo values still need management approval (TBD-03); production lookups return null until one is published. (5) `0000`'s financial keys in `system_config` remain until M1-S07.
- Lecture concepts applied: domain CHECK constraints and exact `numeric` types, a composite candidate key (`effective_from`, `created_at`) with a supporting descending index for the ORDER BY … LIMIT 1 lookup, triggers enforcing append-only history and same-transaction audit, and transaction-scoped locking that serializes concurrent publications (verified with two sessions).

### 3 October 2026 — M1-S07 (non-financial system_config)

- Added `backend/migrations/m1_006_create_system_config.sql`. It drops the legacy `0000` placeholder `system_config` (no actor, no audit, financial keys `tax_rate`, `cancellation_fee_rate` etc. now superseded by `billing_policy`) and rebuilds the Table 40 shape: `config_key varchar(255)` sole PK, `config_value text` (non-blank, ≤ 65,535 chars), `effective_from date`, required `updated_by` restricted FK → `user_account.user_id`, `updated_at timestamptz`. CHECKs enforce lowercase snake_case keys and reject financial/secret-like key terms (tax, fee, rate, discount, charge, price, amount, percent, billing, cancellation, no_show, late_checkout, grace, refund, payment, invoice, password, secret, token) as whole `_`-separated words.
- Decision (Dulranga, 3 October 2026): no keys are seeded. Allowed keys come from the version-controlled `system_config_key_registry()` function (key + optional value regex), which ships empty; approved keys are added later by a reviewed migration using `CREATE OR REPLACE FUNCTION`. The existing `adminController.ts` was left unchanged at Dulranga's direction.
- A BEFORE INSERT/UPDATE trigger allows only an active SYSTEM_ADMINISTRATOR officer (SRS §6.1.4 working mapping, TBD-15) else SQLSTATE 42501; rejects key renames, unregistered keys and pattern-mismatched values (23514); and overwrites `updated_at` with `clock_timestamp()` and `effective_from` with the Asia/Colombo activation date, so no future scheduling is possible. An AFTER trigger writes a CREATE/UPDATE `audit_log` row in the same transaction with the raw old/new values (raw text keeps a maximum-length value within the audit cap) and `changed_at = updated_at`. DELETE/TRUNCATE raise 55000. There is no per-key version history; audit_log is the old-value evidence.
- Added `backend/src/systemConfig.ts` (`validateSystemConfigInput`, `setSystemConfig` single-statement upsert, `getSystemConfig`, `listSystemConfig`) and `backend/tests/m1SystemConfig.test.ts` with `test:m1-system-config`: validation unit test; clean-schema test (applies `0000` then m1_001→m1_006: column/PK inventory, legacy financial rows removed, empty registry rejects even an admin, test-only registry, every other role/disabled account/disabled officer/guest/system/unknown/null actor denied with no row or audit, CREATE/UPDATE audit with old value, caller-supplied future date overwritten, unauthorized and invalid updates leave value and audit unchanged, financial key rejected even when registered, 65,535-char value audited, savepoint rollback removes change and audit together (FR-080), delete/truncate denial, restricted actor deletion); two-session test where the second update blocks on the row lock and the audit chain is 30→45→60 with no lost update.
- Verification: `npm run test:m1-system-config` 3/3 pass; `test:m1-identity` 1, `test:m1-guests` 1, `test:m1-audit` 2, `test:m1-billing-policy` 4, `test:migrations` 3, `test:m2-guards` 4, `test:m2-capacity-guards` 2, `test:m4-payment` 1 pass; `npm run build:backend` and `git diff --check` pass. The runner applied all 15 files to a scratch schema (re-run: 0 applied, 15 skipped; empty `system_config` with four triggers), then the schema was dropped. No application schema was changed.
- Remaining handoffs: (1) The team must agree on concrete non-financial keys (e.g. a session-idle timeout for FR-005) before registering any. (2) The legacy `PUT /api/admin/config` (client-supplied `userId`) will fail after m1_006 because it has no authorized actor, and `GET` returns an empty list; M1-S08/S09 must provide session/authorization before a real config API is mounted, and Member 5's M5-S21 UI consumes it. `AdminConfigPage.tsx` still describes "rates and tax percentages", which no longer belong here. (3) Applying m1_006 to the shared dev DB drops the legacy financial rows; a dependent view on `system_config` would block the drop safely (no CASCADE).
- Lecture concepts applied: domain CHECK constraints and referential integrity with restricted deletion, BEFORE triggers as extra constraints and AFTER triggers for same-transaction audit, transaction atomicity (savepoint rollback test) and row-level locking preventing lost updates under concurrent writers.

## Member 2 — Imandi

### 5 October 2026 — M2-S14 online guest own-booking list/detail core (partial; production auth pending)

- Added `backend/migrations/m2_011_online_guest_booking_read_index.sql` with `booking_guest_created_idx (guest_id, created_at DESC, booking_id DESC)`. PostgreSQL does not automatically index the booking FK, and this targeted B-tree supports the recurring ownership-filtered, newest-first My Bookings query and its stable UUID tie-break pagination.
- Added `onlineGuestBookingReadService.ts` with parameterized, repeatable-read list/detail transactions. Each request first resolves an active `user_account` → `guest_account` → `guest` link, then filters `booking.guest_id` server-side. The bounded list aggregates each booking once with per-status counts and stay bounds; detail returns all current/terminal room lines plus closed/current assignments, status history and value revisions.
- Added `onlineGuestBookingReadController.ts` and `onlineGuestBookingReadRoutes.ts` for guest-only `GET /api/guest/bookings` and `GET /api/guest/bookings/:bookingId` handlers. Client `guestId`/branch filters are rejected, absent and other-owner booking UUIDs return the same generic 404 body, and the guest DTO omits internal guest IDs and staff/guest actor IDs from creation/status/revision records. Scratch reads use a transaction-local schema without `public`.
- Added `backend/tests/m2OnlineGuestBookingReadApi.test.ts` and `test:m2-online-booking-read`. The isolated PostgreSQL/HTTP suite passes 1/1 for unauthenticated/wrong-role/unlinked denial, an ownership-only two-booking list, bounded pagination, no client ownership override, complete two-line revision and room-move history, data minimization, invalid identifiers and identical random/other-owner 404 responses. The M2-S11 and M2-S13 regressions each pass 1/1, and the backend TypeScript build passes. The first M2-S11 regression attempt encountered a remote connection timeout; its immediate rerun passed without code changes.
- M2-S14 remains unchecked and its router remains unmounted because M2-S11/M2-S13 are still formally incomplete and Member 1's M1-S08/M1-S09 production online-guest session/ownership middleware is unavailable. No migration was applied to the application or public database during this task.
- Lecture concepts applied: ownership joins, selection/projection for least-data responses, grouped aggregates at booking-header granularity, repeatable-read consistency across multi-query detail assembly, bounded pagination and a workload-specific composite B-tree rather than indexing unrelated columns.

### 5 October 2026 — M2-S13 online guest multi-room booking-create core (partial; production auth pending)

- Added `backend/migrations/m2_010_online_guest_booking_create.sql` with `sp_create_online_guest_booking`. The procedure takes the authenticated `user_account.user_id`, resolves its active one-to-one `guest_account`/`guest` link inside the transaction and exposes no guest-ID parameter, preventing a caller from choosing another booking owner. It forces `DIRECT_ONLINE` and uses the authenticated account as the booking/history/audit actor.
- Reused the M2-S10 confirmation contract for online bookings: shared policy-publication locking, latest effective non-demo policy selection on the Asia/Colombo date, deterministic room locking, active branch/room/type checks, capacity, blocks, half-open overlap detection and exact current rate/type comparison. One transaction creates the header, every BOOKED line, initial status history, open assignment, CREATE audit row and Member 4 DRAFT invoice; any stale or invalid line rolls everything back.
- Added `onlineGuestBookingCreateService.ts`, `onlineGuestBookingCreateController.ts` and `onlineGuestBookingCreateRoutes.ts`. The parameterized quote/create service first validates the active linked guest account, the controller rejects unknown fields including `guestId` and `bookingChannel`, and the route factory exposes guest-only quote/create handlers intended for `/api/guest/bookings/quote` and `/api/guest/bookings`. Scratch-schema transactions deliberately exclude `public` from `search_path`.
- Added `backend/tests/m2OnlineGuestBookingCreateApi.test.ts` and `test:m2-online-booking`. The isolated PostgreSQL/HTTP suite passes 1/1 for missing/wrong authentication, unlinked accounts, missing policy, mixed-rate two-room creation, derived ownership and `DIRECT_ONLINE` channel, one DRAFT invoice, guest/channel/rate spoof rejection, stale catalogue and policy quotes, a second account receiving only its own booking and cross-branch all-line rollback. The M2-S10 and M1-S05 regressions each pass 1/1, and the backend TypeScript build passes.
- M2-S13 remains unchecked and its router remains unmounted because M2-S10 is still formally incomplete and Member 1's M1-S08/M1-S09 production session and online-guest ownership middleware are unavailable. No migration was applied to the application or public database during this task.
- Lecture concepts applied: normalized one-to-one ownership through foreign keys, server-derived identity, parameterized SQL, ACID all-line rollback, exact numeric rate snapshots, half-open interval predicates, deterministic row locking and database-side revalidation as the final concurrent-write defense.

### 5 October 2026 — M2-S12 booking-line add/change/move transaction/API core (partial; production auth pending)

- Added `backend/migrations/m2_009_booking_line_modifications.sql` with transaction-scoped staff authorization, target-room validation and atomic routines for adding a BOOKED line, revising a BOOKED line's dates/guest count/rate and moving BOOKED or CHECKED_IN lines. Deterministic booking, invoice, line, assignment and room locks support concurrent safety; each changed target is rechecked for branch, active room/type/branch, capacity, block and date overlap constraints.
- BOOKED changes preserve the previous values in `booking_room_line_revision`; every move closes the old `booking_room_assignment` before opening the new one. Checked-in moves preserve the line's dates and base rate, and only a Branch Manager can attach a non-zero signed `PRICE_ADJUSTMENT` for an approved difference. Successful operations refresh Member 4's DRAFT invoice while retaining its discount and explicit adjustments, so payments above a reduced total surface as credit.
- Added a hard-delete guard for `booking_room_line` so cancellation/removal remains Member 4's status workflow, plus audit events for add/change/move. Validation or invoice-refresh failures roll back the whole transaction, including assignments and sibling-safe invoice changes.
- Added parameterized `bookingModificationService.ts`, strict `bookingModificationController.ts` validation/error mapping and an authorization-injected `bookingModificationRoutes.ts` factory for staff line add, change and move endpoints. The service uses transaction-local schema isolation for tests and returns the changed line, current assignment and recalculated invoice balance.
- Added `backend/tests/m2BookingModificationApi.test.ts` and `test:m2-booking-modify`. The isolated PostgreSQL/HTTP suite passes 1/1, covering authorization, add, stale quote, block rollback, paid-down credit, full revision history, unchanged sibling lines, BOOKED move history, checked-in immutability and manager adjustment, branch denial, rollback and delete rejection. M2-S06 passes 4/4, M2-S28 passes 2/2, M2-S10 passes 1/1, Member 4 invoice lifecycle passes 12/12, and the backend TypeScript build passes.
- The legacy Member 4 payment-posting suite reaches 9/10 before failing because it sets `search_path` to its scratch schema plus the already contaminated `public` schema; duplicate enum-typed `fn_record_payment` overloads then make an uncast call ambiguous (`42725`). The new M2-S12 suite excludes `public`, explicitly casts payment arguments and verifies paid-down credit behavior. This pre-existing isolation problem was not changed under Member 2's scope.
- M2-S12 remains unchecked and its router remains unmounted because M2-S10 and Member 1's M1-S08/M1-S09 production session, role and branch-context middleware remain incomplete. No migration was applied to the application or public database during this task.
- Lecture concepts applied: ACID transactions and rollback, deterministic row locking to reduce deadlock/lost-update risk, exact `numeric` money arithmetic, parameterized queries, half-open stay intervals, immutable history tables and database constraints/triggers for cross-client integrity.

### 5 October 2026 — Imandi/dev conflict reconciliation

- Started an uncommitted merge of the verified dev tip and retained both the existing M2-S11 core and Member 3 implementations. Resolved the package test-script conflict without losing either member's scripts; removed committed conflict markers in the ownership summary and replaced stale operational handoffs with the implemented normalized M2-S03–S06/S28 baseline and checkout lock order.
- Corrected the M2-S11 test's booking function call with explicit UUID/channel/JSON argument casts so same-named functions in public cannot create ambiguous overload resolution. Its isolated suite passes; M2 creation, availability, catalogue/room APIs and reservation/capacity/type concurrency regressions also pass. Backend and frontend builds pass.
- A verification mistake applied 13 pending migrations to public through the existing runner's session-scoped schema selection on a transaction pool. The system_config replacement erased its prior rows; the user confirmed no snapshot/previous-value record is available. Three legacy values were recovered from audit evidence, but the original state cannot be proven/restored. The full incident, remaining owner gaps and human Git handoff are in `conflict_resolution_handoff.md`. No speculative restoration, commit or publication was performed. Task checkboxes remain unchanged.
- The user then identified main as a previous snapshot. Verified main at `1a30682d50bfdc65c8e5ee5076683515c852d4a17`; its tracked inventory contains source/migrations/tests and no live database dump/configuration snapshot. It already contains m1_006, so source history does not restore the erased configuration. No branch checkout or database restoration was performed. Git reports no unmerged paths or conflict markers; the resolution is staged and remains uncommitted.

### 4 October 2026 — M2-S11 staff booking list/detail API core (partial; production auth pending)

- Added `backend/src/services/bookingReadService.ts` with parameterized own-branch booking reads. `listStaffBookings` returns each header once with guest details, line-status counts and overall stay bounds; its branch predicate requires at least one assignment in the authorized branch and rejects any booking containing an assignment from another branch. Bounded `limit`/`offset` pagination prevents unbounded list responses.
- `getStaffBookingDetail` reads the header, every current or terminal room line, every closed/current room assignment, all line-status histories and all line revisions within one repeatable-read, read-only transaction. This gives the client one consistent nested snapshot during concurrent reservation updates. Unknown and out-of-branch booking IDs are indistinguishable to callers.
- Added `bookingReadController.ts` and `bookingReadRoutes.ts` for `GET /bookings` and `GET /bookings/:bookingId`. The controller rejects invalid UUIDs, pagination and client-supplied branch filters. The route factory requires an injected Front Desk authorization handler and branch context; it does not trust request query/body data for branch scope.
- Added `backend/tests/m2BookingReadApi.test.ts` and `test:m2-booking-read`. The isolated PostgreSQL/HTTP suite passes unauthenticated and wrong-role denial, branch-filtered list behavior, one header for a two-line/three-assignment booking, complete preserved room-move history, status history, cross-branch concealment, valid other-branch access and invalid input. The focused M2-S10 regression and backend TypeScript build also pass when run sequentially.
- M2-S11 remains unchecked and its router remains unmounted because M2-S10 and Member 1's M1-S08/M1-S09 production session, Front Desk role and branch-context middleware remain incomplete. After those dependencies land, mount both booking routers and run authenticated end-to-end acceptance checks. No application database migration was needed or applied for M2-S11.
- Lecture concepts applied: parameterized selection and joins, aggregation at booking-header granularity to prevent duplicate rows, projection into nested application DTOs, bounded pagination, reuse of existing PK/FK history indexes and repeatable-read transaction isolation for a consistent multi-query detail response.

### 4 October 2026 — M2-S10 staff booking-create transaction/API core (partial; production auth pending)

- Added `backend/migrations/m2_008_staff_booking_create.sql` with `sp_create_booking`. The function accepts multiple separately dated/priced room selections, validates an active own-branch Front Desk actor and guest, locks and rechecks active room/branch/type records, capacity, room blocks, overlapping assignments and current catalogue rates, and rejects stale client quotes. It selects the latest published non-demo billing policy effective on the Asia/Colombo confirmation date under a shared publication lock, so a same-date correction applies only to new bookings while existing invoice policy foreign keys remain unchanged.
- The same database transaction creates one booking header, all BOOKED room lines, initial status histories and open assignments, then calls Member 4's `fn_create_booking_draft_invoice` and verifies the single DRAFT invoice uses the selected immutable policy. Any invalid line or downstream invoice failure rolls back the whole booking. Existing M2-S06/M2-S28 constraints remain the final concurrency guards.
- Added `bookingCreateService.ts`, `bookingCreateController.ts` and `bookingCreateRoutes.ts` for quote and confirmation flows. Request parsing rejects unknown fields, invalid UUID/date/count/rate values, client-selected staff roles and unsupported staff channels; actor and branch identities come from injected authenticated context. Conflict responses distinguish re-quote, unavailable policy, inventory conflict and transaction retry cases.
- Added `backend/tests/m2BookingCreateApi.test.ts` and `test:m2-booking-create`. The isolated suite passes mixed Single/Double rates and one combined invoice (AT-01), two Singles at the same rate (AT-26), missing/demo/stale/corrected policies, inactive and cross-branch inventory, rate spoofing, direct-SQL actor spoofing, all-line rollback and simultaneous same-room confirmation. M2 availability, capacity, billing-policy and invoice regression suites also pass.
- M2-S10 remains unchecked and its router remains unmounted because Member 1's M1-S08/M1-S09 production session, Front Desk role and branch context middleware is not implemented. After that dependency lands, replace the test adapter, mount the router and run authenticated end-to-end acceptance checks. No migration was applied to the shared application database in this task.
- Lecture concepts applied: ACID transaction atomicity, exact `numeric` rate validation, normalized header/line/history/assignment relations, parameterized SQL, consistent row-lock ordering, transaction-scoped advisory locks and database constraints as the final concurrent-write defense.

### 3 October 2026 — M2-S09 parameterized availability function and API

- Added `backend/migrations/m2_007_available_rooms.sql` with the SRS `fn_available_rooms(branch, dates, capacity, immediate-check-in, optional room type)` set-returning function. It validates its scalar inputs and derives results from active room, branch and room-type records, sufficient capacity, physical condition, non-overlapping room blocks and open BOOKED/CHECKED_IN line assignments. Half-open comparisons permit adjacent stays; OUT_OF_SERVICE is always excluded, and CLEANING is excluded only for immediate check-in.
- Added the partial `booking_room_line_active_stay_idx` required for active-date availability work. The existing open-assignment and room-block indexes support the function's room-scoped anti-joins. No date-dependent ordinary view or stored AVAILABLE/RESERVED condition was introduced.
- Added `availabilityService.ts`, `availabilityController.ts` and `availabilityRoutes.ts`, mounted as `GET /api/availability`. The API validates branch/date/capacity/type/boolean query values, uses parameterized SQL inside a read-only transaction, returns room type, current base rate and active amenities, and treats omitted `immediateCheckIn` as `false`. Availability exposes no guest or booking-owner data; authentication remains required by the later booking-confirmation workflows.
- Added `backend/tests/m2Availability.test.ts` and `test:m2-availability`. The clean-schema SQL/API suite passes for capacity, optional room type, inactive room/branch/type, OUT_OF_SERVICE, current CLEANING, overlapping and adjacent blocks/assignments, closed history, BOOKED/CHECKED_IN states, active amenities and invalid/injection-shaped inputs. M2-S06 and M2-S28 regressions and the backend build also pass. Lecture concepts applied: parameterized set-returning functions, relational `NOT EXISTS` anti-joins, derived data, half-open interval predicates and a workload-specific partial index.

### 3 October 2026 — M2-S08 room and room-block API core (partial; auth/audit/condition dependencies pending)

- Added `backend/src/services/roomInventoryService.ts`, `controllers/roomInventoryController.ts` and `routes/roomInventoryRoutes.ts`. They implement parameterized own-branch room reads/writes and dated room-block CRUD, strict request validation, half-open date validation, active parent checks and transaction-scoped schema selection. Branch identity and actor identity come from an injected authenticated request context rather than request bodies.
- Room updates cover room number, room type and active state. Conflicting block, deactivation and room-type changes return the affected current BOOKED/CHECKED_IN lines so staff can reassign or cancel them first. The service follows the M2-S06 room-before-branch/type lock order and leaves database triggers as the final concurrent-write guard. It does not directly update `operational_status`; limited outages use dated blocks.
- Added `backend/tests/m2RoomInventoryApi.test.ts` and `test:m2-room-api`. The isolated HTTP/database test passes for Branch Manager writes, forbidden write roles, permitted Service Staff reads, own-branch scoping, room-number uniqueness, inactive type rejection, block interval and adjacency rules, cross-branch requests, affected-line block/deactivation conflicts, M2-S28 room-type reassignment conflicts and the absence of an unaudited physical-condition endpoint. The backend build and M2-S04/M2-S06/M2-S28 regression suites pass.
- M2-S08 remains unchecked. Member 1 M1-S08/M1-S09 authentication and branch middleware, Member 1's M1-S06 audit writer, and Member 3's M3-S18 audited physical-condition operation are not implemented, so `createRoomInventoryRouter` remains unmounted and production end-to-end AT-23/AT-24 evidence is still open. Lecture concepts applied: parameterized queries, transaction atomicity, joins for affected reservations, half-open intervals and consistent row-lock ordering.

### 3 October 2026 — M2-S07 catalogue API core (partial; auth/audit dependency pending)

- Added `backend/src/services/catalogueService.ts`, `controllers/catalogueController.ts` and `routes/catalogueRoutes.ts`. They implement room-type and amenity create/read/update/deactivate flows, literal substring search, active filtering, atomic room-type amenity replacement, strict request validation, parameterized values, safe error responses and complete-request retry responses for `40P01`/`40001`.
- Catalogue writes reuse the M2-S06/M2-S28 database guards, so active-assignment deactivation and unsafe capacity reductions return a conflict while rate changes affect only the catalogue. Existing room-line `rate_snapshot`, terminal lines and assignment history remain unchanged. Each operation uses a transaction; optional `PG_SCHEMA` isolation uses transaction-local `search_path` so pooled connections do not leak session state.
- Added `backend/tests/m2CatalogueApi.test.ts` and `test:m2-catalogue-api`. The isolated HTTP/database test covers Chain Manager writes, all five forbidden staff roles, authenticated guest/auditor reads, create/read/update/deactivate and search, unknown/invalid input, amenity links, literal injection-shaped search text, price-snapshot persistence, deactivation/capacity conflicts and successful deactivation after assignment closure. The focused suite, M2-S02/M2-S06/M2-S28 regressions and backend build pass.
- M2-S07 remains unchecked. Member 1 M1-S08/M1-S09 has not supplied authenticated-session/read/Chain Manager middleware, so `createCatalogueRouter` is not mounted in `index.ts`; the test-only authorization handlers are not production authentication. Member 1's M1-S06 audit-writing contract is also pending, so catalogue-change audit integration and authenticated end-to-end AT-24 evidence remain open. Lecture concepts applied: parameterized selection, joins/JSON aggregation, transaction atomicity, row-lock conflict handling and transaction-local session state.

### 3 October 2026 — M2-S28 capacity and room-type edit guards

- Added `backend/migrations/m2_006_capacity_type_edit_guards.sql`. It extends the M2-S06 assignment target validator to lock and read the assigned room type's capacity, rejects assignments or BOOKED line guest-count edits above that capacity, rejects a capacity reduction below any current BOOKED/CHECKED_IN assigned line's guest count, and rejects `room.room_type_id` changes while that room has such an assignment.
- Preserved terminal line values, agreed `rate_snapshot` values and closed assignment rows. Valid capacity changes that continue to accommodate current lines, plus capacity/type changes after valid assignment closure, remain allowed. The guard uses M2-S06's line→booking→room→branch→room-type assignment path; catalogue updates serialize on the room-type row and room type changes serialize on the room row.
- Added `backend/tests/m2CapacityTypeGuards.test.cjs` and `test:m2-capacity-guards`. The two suites cover schema objects, direct invalid and valid AT-27 cases, assignment/guest-count capacity checks, unchanged terminal history and three two-session directions: booking before capacity reduction, booking before room-type change and capacity reduction before booking.
- Verification passed: `npm run test:m2-capacity-guards --workspace backend` (2 tests), all M2-S02–S06 suites (9 regression tests), `node --check backend/tests/m2CapacityTypeGuards.test.cjs`, `npm run build:backend` and `git diff --check`. Live preflight found zero current assignments or capacity violations; the official runner applied only `m2_006`. A read-only audit confirmed the migration record, three functions, three triggers and guest-count revalidation. Lecture concepts applied: ACID conflict rollback, row-lock serialization, consistent lock ordering, trigger-enforced cross-table integrity and reuse of the existing B-tree access paths.

### 2 October 2026 — M2-S06 reservation lifecycle and concurrency guards

- Added `backend/migrations/m2_005_reservation_integrity_guards.sql`. Immediate triggers lock and recheck the line, booking, target room, branch and room type for open assignments; room blocks lock the target room; room, branch and room-type updates recheck current assignments. The guards reject half-open date overlaps, cross-branch bookings, two checked-in lines in one room, existing blocks, inactive parents, OUT_OF_SERVICE assignment targets and conflicting block/deactivation writes. A CLEANING room can retain a non-overlapping future BOOKED assignment but cannot check in until READY.
- Added initially deferred constraint triggers so a multi-table transaction may temporarily close/open assignments or update status/history in steps, while commit requires exactly one occupancy-consistent open assignment for BOOKED/CHECKED_IN lines, none for terminal lines and a continuous status-history chain. Added monotonic append-only assignment-history protection. Capacity reduction and room-type reassignment remain M2-S28.
- Added `room_block_room_dates_idx` and `room_room_type_idx` for the new conflict/deactivation paths, plus `backend/tests/m2ReservationGuards.test.cjs` and `test:m2-guards`. The four suites cover valid two-room bookings and adjacent stays, invalid direct writes, both assignment/block conflict directions, lifecycle/history/occupancy, parent state, and two-session overlapping-reservation, booking-versus-block and booking-versus-branch-deactivation races.
- Verification passed: `npm run test:m2-guards --workspace backend` (4 tests), all four earlier M2 migration suites (5 regression tests), `node --check backend/tests/m2ReservationGuards.test.cjs`, `npm run build:backend` and `git diff --check`. Preflight found zero live room lines/assignments/history; the official runner applied only `m2_005`. A live read-only audit confirmed its migration record, functions, immediate and initially deferred triggers, supporting indexes and unchanged zero reservation rows.
- Lock/retry handoff: multi-line callers process line and room UUIDs in deterministic order; SQLSTATE `23514`/`23505` are non-retryable business conflicts, while `40P01`/`40001` require a bounded retry of the whole transaction. Lecture concepts applied: ACID transaction-end consistency, isolation by shared-row locking, serializable conflict outcomes, deferred constraint checking, B-tree access paths and half-open interval predicates.

### 2 October 2026 — M2-S05 line-based room assignment history

- Added `backend/migrations/m2_004_booking_room_assignment.sql`. It creates UUIDv7 `booking_room_assignment` rows with required `line_id` and `room_id` foreign keys, assignment decision timestamps, nullable actual occupancy timestamps, strict timestamp ordering and restricted parent deletion. It deliberately has no `booking_id` or `room.booking_id` compatibility pointer.
- Added a partial unique B-tree index for at most one open assignment per line, a line-history index and a non-unique room/open index. Room-level uniqueness is deliberately absent because separate non-overlapping future lines may use the same room; M2-S06 will enforce date overlap, active-line lifecycle, same-branch, block, parent-active and checked-in occupancy rules under concurrency.
- Added `backend/tests/m2Assignments.test.cjs` and `test:m2-assignments`. The test applies M2-S02–S05 in isolated PostgreSQL schemas, proves multiple open room lines under one booking, validates history and negative constraints, and uses two sessions to show simultaneous open assignments for one line serialize and reject the loser with unique-violation SQLSTATE `23505`.
- Verification passed: `npm run test:m2-assignments --workspace backend` (2 tests), all three earlier Member 2 migration tests, `npm run build:backend`, `node --check backend/tests/m2Assignments.test.cjs` and `git diff --check`. The official runner then applied only `m2_004` to the configured `public` schema. A live read-only audit confirmed the exact seven columns, required checks/FKs/indexes, migration records `m2_001`–`m2_004` and zero assignment rows.
- Lecture concepts applied: normalized temporal association history, typed PK/FK referential integrity, partial unique and supporting B-tree indexes, and an ACID two-session concurrency test of the database-enforced invariant.

### 2 October 2026 — application database synchronized through M2-S04

- Rechecked the configured PostgreSQL 18.6 `public` schema before mutation. All existing Member 2 tables were empty, no external foreign keys or dependent views referenced them, and no `m2_*` migration versions were recorded. Removed the incomplete manually created Member 2 objects and obsolete `booking_status_enum`/`room_status_enum` in one transaction under the migration advisory lock, without `CASCADE`; the transaction would have rolled back on any unexpected dependency or nonempty table.
- Ran the official ordered migration runner. It applied `m2_001_room_catalogue.sql`, `m2_002_booking.sql` and `m2_003_room_inventory.sql`, recording `m2_001`–`m2_003`. The runner also applied the pending repository-owned `m1_004_billing_policy_mock.sql`, `m4_001_invoice_and_lines.sql` and `m4_002_payment.sql`; no Member 2 migration beyond M2-S04 exists or was applied.
- Live read-only catalog verification passed: all nine M2-S02–S04 tables exist; booking headers have no room-specific fields; `room.booking_id`, `booking_room_assignment`, `booking_status_history` and legacy enums are absent; the three target enums, three query indexes, append-only history function/triggers and migration records match the current SQL.
- Verification: `npm run test:m2-catalogue --workspace backend`, `npm run test:m2-booking --workspace backend`, `npm run test:m2-rooms --workspace backend` and `npm run build:backend` passed. At that synchronization stage, M2-S05 onward was unimplemented.
- Lecture concepts applied: dependency-ordered referential integrity, normalized booking/room-line relations, atomic reset and rollback, migration bookkeeping, and indexes plus triggers for efficient access and append-only temporal evidence.

### 2 October 2026 — retired correction-task documentation cleanup

- Removed all retired correction-task rows from Member 2's active checklist because their scopes are already represented by the direct normalized M2-S03/M2-S04 design or the future M2-S05 assignment task.
- Updated Member 4's invoice dependency to the actual room-line provider, M2-S03, and replaced the historical correction-task range with a general description. No migration, application code or database object changed.
- Verification: repository-wide search found no remaining references to the removed task IDs, and `git diff --check` passed.

### 29 September 2026 — direct normalized reset through M2-S04

- At Imandi's explicit direction, removed the temporary single-room compatibility implementation rather than retaining it as migration history. This reset was safe because all prior Member 2 database tests used rolled-back scratch schemas and no Member 2 migration had been applied to the application database.
- Rewrote `m2_002_booking.sql` so M2-S03 directly creates the guest/reference/channel-only booking header, multiple separately dated/priced `booking_room_line` rows, five line states and append-only line status/revision histories. It never creates booking-header stay dates, guest count, rate, status, actual occupancy, room pointer or `booking_status_history`.
- Rewrote `m2_003_room_inventory.sql` so M2-S04 directly creates branch-scoped rooms and dated blocks without `room.booking_id` and with only READY/CLEANING/OUT_OF_SERVICE physical conditions. Removed the temporary post-S04 correction migrations, tests and scripts; at that point the active Member 2 chain stopped at M2-S04 and later implementation tasks remained pending.
- Verification: `npm run test:m2-booking --workspace backend` passed (1 multi-room schema/constraint test), `npm run test:m2-rooms --workspace backend` passed (1 target room/block schema/constraint test), and `npm run test:m2-catalogue --workspace backend` passed (1 regression test). `npm run build:backend`, `node --check backend/tests/m2Booking.test.cjs`, `node --check backend/tests/m2Rooms.test.cjs` and `git diff --check` passed. The database tests used rolled-back PostgreSQL 18 scratch schemas; no application database was changed.
- Lecture concepts applied: normalization places repeating room facts under `booking_room_line`; PK/FK and CHECK constraints enforce entity, referential and domain integrity; append-only child histories preserve temporal evidence; exact `numeric(12,2)` protects rates; transactional scratch-schema tests leave no persistent database changes.

### 25 September 2026 — M2-S01 amended handoff confirmation

- Imandi confirmed that Members 1, 3, 4 and 5 agree to the amended multi-room reservation handoff. Updated the M2-S01 contract, Member 2 and Member 1 handoffs, shared ownership summary, SRS §6.1.8/Appendix C and project memory to record that confirmation without claiming implementation or completion of another member's task.
- Verification: read the current SRS, M2-S01 contract, member checklists and legacy migrations; checked the documentation diff and whitespace. No SQL, application code or database state changed, so runtime tests/builds were not run for this documentation-only update.
- Remaining handoffs: Members 2–4 still need a precise lock order, transaction and retry contract before the future M2-S06; owner-specific Appendix C checks and formal ER/evaluator review remain open. No corrective migration path remains.

### 18 September 2026 — M2-S01 and M2-S02

- Imandi reported that Members 1, 3 and 4 agree to use Member 2's reservation handoff, delegated the shared value choices, and removed the manual-SQL restriction. Added `member_tasks/m2_s01_reservation_contract.md`; cross-referenced exact status/channel sets and transitions, LKR `numeric(12,2)`, PostgreSQL 18 `uuidv7()`, UTC `timestamptz`, `user_account.user_id` actor FKs, `/api/*` routing and transaction ownership in Member 1/3/4 plans, `member_summary_table.md`, SRS §6.1.4/§6.1.8/Appendix C and `memory.md`. Removed the manual-SQL wording from Member 2's plan and the shared member workflow skill. Other members' own task checkboxes were not changed.
- Created `backend/migrations/m2_001_room_catalogue.sql` for Table 40's `room_type`, `amenity` and composite-key `room_type_amenity`. It enforces UUIDv7 IDs, nonblank names, positive capacity, non-negative finite two-decimal rates, FK integrity and restricted parent deletion. Added a focused Node/PostgreSQL test and `test:m2-catalogue` script.
- Verification: the configured development database reported PostgreSQL 18.6. `npm run test:m2-catalogue --workspace backend` passed (1 test) in a newly created scratch schema inside a transaction; type/length inventory, generated/rejected UUID versions including the nil UUID, rounding, invalid capacity/rates, missing FKs, duplicate/null link and restricted deletion were checked. Test rollback also confirmed its schema did not persist. `npm run build:backend`, `node --check backend/tests/m2Catalogue.test.cjs` and `git diff --check` passed. Rechecked SRS Table 40/§6.1.4/Appendix C against the migration and contract. No catalogue migration was applied to the application schema.
- Remaining handoffs recorded at that time: Member 1's M1-S02 ordered migration runner had to integrate this file; Member 1 still needed to implement the shared identity/system actor contract. Members 3/4 still owned service quantity and billing/payment enum/policy details, and the team needed evaluator review of the physical mapping. M2-S03 and later rows were open when this entry was written.
- Lecture concepts applied: typed PK/FK referential integrity, normalized many-to-many `room_type_amenity`, exact `numeric` rates, and ACID rollback in isolated migration tests. Reservation transaction isolation remains for later M2-S06/M2-S10 work.

## Member 3 — Kulunu

### 5 October 2026 — M3-S18 physical room-condition change operation (row checked)

- Added `backend/src/services/roomConditionService.ts`, `backend/src/controllers/roomConditionController.ts` (`patchRoomCondition`) and `backend/src/routes/roomConditionRoutes.ts` (`createRoomConditionRouter`, `PATCH /rooms/:roomId/condition`), plus `backend/tests/m3RoomCondition.test.cjs` (5 scenarios), `backend/tests/m3RoomConditionApi.test.cjs` (2 scenarios) and the `test:m3-room-condition` / `test:m3-room-condition-api` scripts. No migration was added, Member 2's `roomInventoryRoutes.ts` was not touched (its comment already reserves this route for Member 3), Member 4's `fn_checkout_room_line` was not modified, and nothing new is mounted in `backend/src/index.ts`.
- Authorization lives in the service, not only the controller, so no caller can bypass it: the room row is locked first, then the actor is resolved from `officer`/`role`/`user_account` and must be an active `BRANCH_MANAGER` or `SERVICE_STAFF` of that room's own branch. `FRONT_DESK` is deliberately refused a direct change because SRS §6.1.4 grants it no general condition-edit right; `CHAIN_MANAGER`, `SYSTEM_ADMINISTRATOR`, `AUDITOR`, other-branch staff, inactive officers and online guests are refused too. Typed `RoomConditionError` codes map to 400/403/404/409 instead of string matching.
- `checkoutCleaningTransition` is the internal entry point for Member 4's authorized checkout: it never begins or commits, so it joins the caller's transaction; it checks only that the actor is an active officer because checkout authorization stays in `verifyStaffCheckoutAccess`; and the atomic update, the OUT_OF_SERVICE guard and the single history append stay in the existing `fn_set_room_condition`.
- The audit trail is the append-only `room_status_history` that Member 3 owns per the M2-S01 contract; no new `audit_log` action was invented for a physical condition.
- Verification, all on the real numbered `m1`-`m4` chain in throwaway schemas (`PG_TEST_URL`/`PG_URL`, never the application database): `test:m3-room-condition` 5/5 and `test:m3-room-condition-api` 2/2 pass. Covered: every contract transition pair with exactly one history row carrying distinct old/new values, actor, timestamp and reason; a repeated value answering `changed: false` with no new row; 400 for labels outside the physical domain and 404 for an unknown room; the 409 OUT_OF_SERVICE conflict over both a BOOKED and a CHECKED_IN assignment, released once the stay ends; wrong-role/wrong-branch/inactive/guest refusals leaving no write; the internal transition surviving an explicit `ROLLBACK` with no surviving row and being idempotent; and a real `checkoutRoomLine` rolled back (line CHECKED_IN, assignment open, room READY) then committed (CLEANING, one history row attributed to the FRONT_DESK actor). Regressions: `test:m3-room-status-history` 1, `test:m3-check-in` 3, `test:m3-check-in-api` 2, `test:m3-active-stay` 2, `test:m3-service-catalogue` 1, `test:m3-service-catalogue-api` 1, `test:m3-service-usage` 1, `test:m3-service-usage-recording` 2, `test:m3-service-usage-api` 2, `test:m3-service-usage-void` 1, `test:m3-service-usage-void-api` 2, `test:m3-lifecycle-integration` 8, `test:m2-guards` 4, `test:m2-capacity-guards` 2, `test:migrations` 3, `build:backend`, `build:frontend`.
- Not rerun / still broken for pre-existing reasons: `test:m3-current-baseline` is red 0/2 because the full chain cannot be applied (`m5_002` 42703, `m5_003` 42501), which is why both new suites exclude exactly those two files with the reason documented in-file; Member 4's suites were not rerun because their scratch schemas share `public`; `test:m2-room-lines` still points at a missing test file.
- M3-S17 stays unchecked only because of that Member 5 chain blocker. Its stated M3-S18 dependency is now satisfied, and its evidence note was corrected from two blockers to one.

### 5 October 2026 — M3-S17 booking-lifecycle integration suite (M3-S17 left unchecked: two blockers)

- Added `backend/tests/m3BookingLifecycleIntegration.test.cjs` with the `test:m3-lifecycle-integration` script: eight scenarios that apply the real numbered migration chain to a freshly created schema and then drive the actual services and SQL, so nothing is asserted against a hand-written fixture schema. One seeded hotel provides a two-room booking (rooms 1 and 2), a single-room booking (room 3), a not-yet-checked-in booking (room 4), a single-line booking used for the FINAL path (room 5) and one room with no assignment at all (room 6), plus FRONT_DESK, SERVICE_STAFF, BRANCH_MANAGER and CHAIN_MANAGER officers in one branch and a FRONT_DESK officer in another.
- Partial two-room check-in: checking in one line leaves the sibling `BOOKED`, gives the checked-in line exactly one open occupancy segment that starts at the same instant used for the line transition, the line-history `BOOKED -> CHECKED_IN` row and the `audit_log` `STATUS_CHANGE` row, leaves the sibling with no segment and no transition, and the active-stay read model reports one occupied room rather than two. A repeat request on the same line is refused and still writes nothing.
- Race and rollback: an audit failure injected after the booking/line/assignment/room locks are taken leaves the line `BOOKED`, the segment unopened, no line transition, no audit row and the room `READY`. Two independent sessions then attempt the same line at once; exactly one resolves and exactly one is refused with the `Only BOOKED` conflict, and afterwards there is one segment, one transition, one audit row and still no `room_status_history` row. This is the race case that no earlier suite covered on a real chain.
- Occupancy segments and the checkout transition: after both lines are checked in and the balance is settled, `fn_checkout_room_line` closes the segment with `occupied_to = unassigned_at = checked_out_at` and `occupied_from < occupied_to`, writes the `CHECKED_IN -> CHECKED_OUT` transition at that same instant, leaves the sibling's segment open, keeps the invoice in `DRAFT` with a `PROV-` provisional reference, and moves the room to `CLEANING` with exactly one `room_status_history` event carrying the actor and reason. Wrapping that checkout in an explicit `BEGIN ... ROLLBACK` proves the condition transition and its history row belong to the checkout transaction: afterwards the line is still `CHECKED_IN`, the segment is still open, the room is still `READY` and no condition event exists. The final checkout with all lines terminal and a zero balance does issue the single `FINAL` invoice and cleans the second room once.
- Direct condition transitions (the M3-S18 behaviour the chain already ships): `fn_set_room_condition` writes one event per real change with the actor and reason, a repeated same-value call writes nothing (DBR-018), a `CLEANING -> OUT_OF_SERVICE -> READY` sequence logs three ordered events, and `OUT_OF_SERVICE` is refused with `23514` while a `BOOKED` assignment is open and again while a `CHECKED_IN` assignment is open, leaving the room `READY` with no event in both cases. Condition history rejects `UPDATE` and `DELETE` with `42501`.
- Service usage: room-specific usage takes its snapshot from the active catalogue price; cross-booking attribution is refused by the service and by the trigger (`23514`), an unknown line is a foreign-key failure (`23503`), a `BOOKED` line is refused, and booking-wide usage needs at least one checked-in line and stays explicitly unallocated. Changing `service.current_price` from 50 to 75 leaves the stored `unit_price_snapshot`, the stored amount, `fn_service_total` and the already-written invoice lines byte-identical, while a charge recorded afterwards snapshots 75. After settling, `voidServiceUsage` reports the exact reversal amount and a credit, retains the row with its original quantity, snapshot, recording actor and recording time, adds only the void metadata, writes exactly one `VOID` audit row, drops the charge from `fn_service_total` and refuses a repeat; the open-segment count, the assignment's occupancy columns and the `room_status_history` count are asserted unchanged across the void. With the invoice `FINAL`, both recording and voiding are refused and the charge stays unvoided.
- Cross-branch reads are covered too: another branch's FRONT_DESK officer gets `403 STAY_ACCESS_DENIED` for the same booking's occupied room, and nothing about that room changes.
- Upgrade path: the published `m3_001`/`m3_002` mock chain is applied first, a booking, a recorded usage row and a `room_status_history` row are written into it, and only then are `m3_003`/`m3_004`/`m3_005` applied. The upgrade keeps usage ids, quantity, snapshot, attribution, recording actor and the pre-existing history reason, keeps `fn_set_room_condition` for Member 4's checkout, and the upgraded guards then reject a history delete (`42501`), a `NaN` catalogue price (`23514`) and both a partial void update and a snapshot rewrite (`23514`). This restores coverage that only the currently failing `test:m3-current-baseline` had.
- Blocker 1 (not Member 3's to fix, nothing was rewritten): the full numbered chain cannot be applied cleanly. Applying the chain file by file to a scratch schema shows `m1_*` through `m4_007` succeeding and then `backend/migrations/m5_002_create_audit_indexes.sql` failing with `42703 column "branch_id" does not exist`, because it builds `idx_booking_branch_dates_status` on `booking (branch_id, check_in_date, status)` while Member 2's normalized booking header (M2-S03) keeps the branch on the room and the dates on the line. `m5_003_seed_config_values.sql` then fails with `42501 system_config changes require an active SYSTEM_ADMINISTRATOR officer`, because the chain seeds no such officer. The practical effect is that the existing `test:m3-current-baseline` is red in the current tree for this reason alone, which is exactly the kind of missing earlier coverage M3-S17 must not hide. This suite therefore applies the `m1`-`m4` chain and excludes precisely those two files; a final test asserts the reason still holds (no `branch_id`/`check_in_date` on `booking`, the stale index statement still failing with `42703`, the `system_config` write still failing with `42501` and no SYSTEM_ADMINISTRATOR officer in the chain), so the exclusion cannot silently outlive the defect: when Member 5 fixes the two files, that test fails and the exclusion is expected to be removed so a complete clean apply is verified.
- Blocker 2 (the stated M3-S18 dependency): M3-S18's authorized direct-condition operation does not exist yet. The chain only ships the `fn_set_room_condition` SQL function and Member 4's checkout call into it; there is no Member 3 service, controller or route, so M3-S18's own role/branch requirements (own-branch `BRANCH_MANAGER` or `SERVICE_STAFF` for a direct change, an authorized `FRONT_DESK` checkout invoking the internal `CLEANING` transition) and its wrong-role/wrong-branch scenarios cannot be exercised by any test. This suite covers what the chain actually ships — the transition, no-op, history and active-assignment conflict behaviour at the database level — and the checkout-side `CLEANING` transition with rollback, which is the consumer path that does exist.
- Verification: `npm run test:m3-lifecycle-integration --workspace backend` passes (8 scenarios; roughly five minutes because each scenario applies the whole chain to its own schema). All other Member 3 backend suites still pass: `test:m3-check-in` (3), `test:m3-check-in-api` (2), `test:m3-active-stay` (2), `test:m3-room-status-history` (1), `test:m3-service-catalogue` (1), `test:m3-service-catalogue-api` (1), `test:m3-service-usage` (1), `test:m3-service-usage-recording` (2), `test:m3-service-usage-api` (2), `test:m3-service-usage-void` (1), `test:m3-service-usage-void-api` (2). `test:m2-guards` (4) and `test:m2-capacity-guards` (2) pass and `npm run build:backend` and `npm run build:frontend` both succeed. `test:m3-current-baseline` fails 2/2 with the same `42703` chain error described above; `test:migrations` passes but only ever applies two synthetic widget migrations, so it never exercises the real chain.
- Earlier-unit-test audit, reported rather than papered over: `test:m3-current-baseline` is red for an upstream reason; `test:m2-room-lines` in `backend/package.json` points at `tests/m2RoomLines.test.cjs`, which does not exist in the repository, so Member 2's room-line unit suite is missing entirely; Member 4's `test:m4-invoice`, `test:m4-billing`, `test:m4-posting`, `test:m4-checkout` and `test:m4-checkout-api` all fail in this environment because their scratch schema keeps `public` in `search_path`, so `m1_004_create_audit_log.sql`'s `DROP TABLE IF EXISTS audit_log` resolves to the application database and is refused because Member 5's `backend/views/m5_staff_activity_audit.sql` view depends on it — those suites were stopped after the first failure and are Member 4's harness to fix; M3-S07/S08 remain unchecked rows whose routers are unmounted pending M1-S08/S09, so no mounted end-to-end route test exists for them. Also observed read-only: the configured application database has `m1_001` through `m4_007` recorded but not `m2_009`, `m2_010`, `m2_011`, `m3_006` or any `m5_*`, so the void guard and the later line/guest-read migrations exist in the repository but not in that database.
- M3-S17 is therefore deliberately left unchecked: its completion check requires clean-DB tests to pass (blocked by the two Member 5 migrations) and it depends on M3-S18 for the direct-condition role/branch scenarios (M3-S18 has no authorized operation yet). No product code, migration, Member 2/4/5 file or existing test was modified; the only changes are the new suite, the new `test:m3-lifecycle-integration` script and this record.
- Lecture concepts applied: integration tests that run the real DDL and the real transactional code paths instead of hand-built fixture schemas, so a defect in the actual guards cannot pass a mock-based suite; explicit concurrency testing with two independent sessions to prove pessimistic locking admits exactly one writer; rollback testing that asserts the absence of every side effect of an aborted transaction, including the physical-condition history row that a rollback must also undo; and treating a data-migration upgrade as a contract that preserves ids, snapshots, actors and existing history in place rather than recreating them.

### 5 October 2026 — M3-S16 service-usage void UI

- Extended `frontend/src/lib/serviceUsageViewModel.ts` with M3-S11's void decision layer. `USAGE_VOID_ROLES` (`BRANCH_MANAGER`, `CHAIN_MANAGER`, `SYSTEM_ADMINISTRATOR`) is deliberately the exact inverse of `USAGE_RECORDING_ROLES`, and `resolveVoidCapabilities` asserts that separation: whoever records a charge can never reverse it, which is what makes a reversal a separate authority rather than an undo. `BRANCH_MANAGER` is own-branch only, a rule the client cannot verify, so it stays with the server and any refusal is rendered as authoritative. `voidRowState` gives each row one of three states — voidable, already voided (repeat), or forbidden with the reason attached — so a repeat is refused in the UI for every role, not just for managers. `validateVoidDraft` treats the reason as optional, mirrors the audit column's 255-character limit as a validation error rather than a silent truncation, and `voidRequestPath` reuses the existing booking-scoped usage path. `parseVoidResult` reads M3-S11's 200 body and keeps `voided_amount` and the refreshed `billing` balance as exact fixed-point text. `applyVoidedUsage` implements FR-048 in the client: only `voided`, `voidedAt` and `voidedBy` change, while service, room-line attribution, quantity, unit-price snapshot, amount, `used_at`, `recorded_at` and `recorded_by` are copied through untouched, so the retained row still reports what was originally charged. `describeVoidFailure` maps every M3-S11 code, `isVoidRepeat` separates a repeat from any other refusal, and `describeListDenial` explains the read/void authority split described below.
- Added `frontend/src/components/usage/ServiceUsageVoidPanel.tsx` on existing shadcn primitives only (`Card`, `Button`, `Input`, `Label`, `Badge`); no new dependency was added. `VoidPermissionBanner` states the authority in force, `VoidConfirmation` is the explicit confirmation step required for a financial reversal: it names the service, attribution, quantity, snapshot and the exact reversal amount, then spells out that the original row is retained rather than deleted, that the row is marked VOIDED and leaves the billable subtotal, that an audit row stores the actor, server time and reason, that a FINAL invoice cannot be voided here and must be escalated (FR-058), and that a charge can only be voided once. The reason is optional and labelled with its audit limit. `Confirm void` is destructive and `Keep the charge` cancels. `VoidRowAction` renders no control at all for an already voided row, because FR-048 keeps it as history, and gives a forbidden role a disabled control with the reason rather than a dead button. `VoidOutcome` reports the reversed amount and, from M3-S11's refreshed balance, any resulting credit for Member 4's refund path.
- Extended `frontend/src/components/usage/ServiceUsagePanel.tsx` and `frontend/src/routes/ServiceUsagePage.tsx` for M3-S16. The panel takes an optional `voidWiring` object, so the void column, banner, confirmation and outcome appear only when voiding is wired and the table otherwise keeps its original six columns. Voided rows now also show their reversal actor and server time next to the VOIDED badge. The page posts `POST /api/bookings/:bookingRef/service-usage/:usageId/void` with the validated reason, re-checks locally that the selected row is still billable before sending (a stale render cannot request a repeat void), merges the authoritative reversal into the list, and re-reads the list when the server answers `USAGE_ALREADY_VOIDED` so a reversal made by someone else is shown instead of a stale local guess.
- Contract gap found and deliberately not papered over: M3-S10 scopes the usage list read to active own-branch `FRONT_DESK`/`SERVICE_STAFF`, while M3-S11 allows only `BRANCH_MANAGER`/`CHAIN_MANAGER`/`SYSTEM_ADMINISTRATOR` to void. The two role sets do not intersect, so a void authority cannot load the list this screen needs. The UI was built to both confirmed contracts and now says so explicitly (`describeListDenial`) instead of showing a void-capable role an empty charge list that looks like an uncharged booking. M3-S10's read rule was not widened here: it is another subtask's confirmed behavior, the TBD-15 role-matrix review is still open with the owners, and silently broadening a read rule to make a flow reachable would be an unapproved authorization change. Until the owners decide, the void flow is reachable end-to-end only once the list read includes the void authority.
- Added `frontend/tests/m3ServiceUsageVoidUi.test.ts` and `frontend/tests/m3ServiceUsageVoidPanel.test.tsx` with the `test:m3-service-usage-void-ui` script. Ten model cases cover the void/recording authority separation for all six roles plus an unknown actor, denial copy, the three per-row states including a manager being refused a second void, the request path, optional-reason and length validation, exact reversal/billing text, the FR-048 retained-row guarantee with a non-mutating merge, every M3-S11 failure code and the repeat classification. Ten server-rendered panel cases cover the void column for an authority, the full confirmation content and its copy, the optional reason with its limit and error, disabled controls with reasons for every forbidden role, a voided row showing `REVERSED` plus its reversal actor/time while only the billable row offers a void, distinct alerts for a denial, a repeat and a FINAL invoice, the success message with and without a credit, an in-flight void blocking a second confirmation, and the unwired panel keeping six columns.
- Verification: `npm run test:m3-service-usage-void-ui --workspace frontend` passes (20 tests). The M3-S15 screen it extends still passes unchanged (`test:m3-service-usage-ui`, 30), and `test:m3-service-catalogue-ui` (25), `test:m3-check-in-ui` (6) and `test:m3-active-stay-ui` (10) are unaffected. `npm run build:frontend` passes (`tsc` plus `vite build`, 1974 modules). The M3-S11 dependency was re-run against the real database: `npm run test:m3-service-usage-void --workspace backend` (1) and `npm run test:m3-service-usage-void-api --workspace backend` (2) pass, plus the M3-S09/S10 suites `test:m3-service-usage` (1) and `test:m3-service-usage-api` (2), so the routes, codes, single-reversal rule, retained original row and audit row this UI renders are green server-side. `git diff --check` is clean.
- No backend, migration, Member 2 or Member 4 behavior was touched and no new SQL was written. Presentation only: a disabled control is never treated as enforcement, and the server's `VOID_ACCESS_DENIED`, `USAGE_ALREADY_VOIDED`, `USAGE_NOT_FOUND`, `INVOICE_FINAL` and `VOID_REJECTED` remain the only authority.
- Remaining: the read/void authority split above must be resolved by the owners before the void flow is usable in production, alongside the still-open TBD-15 role-matrix review. End-to-end click-through also still depends on M1-S08/M1-S09 session middleware; `resolveSessionRole()` keeps returning `null` on purpose, with the development-only role preview covering the six seeded roles. The confirmation is an in-place step rather than a modal because the project has no dialog primitive and adding `@radix-ui/react-dialog` would be a new dependency outside this subtask's scope. M3-S17 still owes the integration coverage for a real reversal in a two-room booking, and Member 5's reports consume the same retained voided rows.
- Lecture concepts applied: modelling a financial correction as an append-only state transition (reversal metadata added to an immutable row) instead of an update-and-delete, which is what keeps the audit trail meaningful; separating authorization into two independent capability sets so a role can never both create and erase the same financial event; and treating the server's conflict response as a signal to re-read authoritative state rather than to patch local state optimistically.

### 5 October 2026 — M3-S15 service-usage record/list UI

- Added `frontend/src/lib/serviceUsageViewModel.ts` as the pure decision layer for the usage screen. `resolveUsageCapabilities` mirrors M3-S10's own rule: only active `FRONT_DESK`/`SERVICE_STAFF` can record, while `BRANCH_MANAGER`, `CHAIN_MANAGER`, `SYSTEM_ADMINISTRATOR`, `AUDITOR` and an unknown actor all stay read-only with an explicit reason rather than a hidden form. `buildUsagePayload` is the FR-045 guarantee that the client cannot spoof a price: it emits only `serviceId`, `quantity`, an optional `bookingRoomLineId` and an optional `usedAt`, and `validateUsageDraft` rejects a non-positive quantity, more than two decimals, a missing service, a malformed UUID, a malformed timestamp and any room line that is not one of the booking's checked-in lines (FR-044). `usageAvailability` blocks recording entirely while no line is checked in. `parseUsageList` reads M3-S10's `{ booking_id, usage: [...] }` list shape and `parseRecordedUsage` normalises the flat 201 body through the same parser, so a fresh row and a listed row cannot drift. `attributionLabel` renders `Unallocated (booking-wide)` for a null line (FR-044) and names the room otherwise, falling back to the raw line id rather than a blank cell. `usageTotals` sums non-void rows only (FR-050) and reports recorded, voided and unallocated counts, so a voided charge is visible but excluded. `parseUsageFailure`/`describeUsageFailure` map every M3-S10 code to staff-facing copy, and `isUsageAccessDenial` separates a branch `403` from a `404`/`401`/`500`.
- Extracted `frontend/src/lib/money.ts` as the shared exact fixed-point helper used by both the catalogue and usage screens, and refactored `serviceCatalogueViewModel.ts` onto it without changing behaviour. `sumMoney` and `multiplyMoney` work in integer hundredths of a rupee via `BigInt`, so no amount ever passes through a binary float. This surfaced a real FR-046 mismatch: `multiplyMoney` truncated `quantity * unit_price_snapshot`, but M3-S10 stores the amount with PostgreSQL `ROUND(quantity * unit_price_snapshot, 2)`, so the client could have displayed a cent below the stored charge. It now rounds half up in integer hundredths to match the server, and a regression case (`1.1 x 10.05 -> 11.06`, not `11.05`) pins that.
- Added `frontend/src/components/usage/ServiceUsagePanel.tsx` on existing shadcn primitives only (`Card`, `Button`, `Input`, `Label`, `Badge`). The form has no price field and states that the unit price comes from the catalogue on the server; attribution is a `Unallocated (booking-wide)` option plus one button per checked-in room, and the helper copy states that booking-wide usage is never spread across the rooms of a multi-room booking (FR-069). The `used_at` field is optional and documents that a back-dated time must fall inside the occupied assignment period, which is the server's FR-044 check. `UsagePermissionBanner` gives the AT-24-style denial or the checked-in-line reason, every write control is disabled when recording is not permitted, and a failed write renders the server's mapped message in a `role="alert"`. The list is a fluid full-width table inside `overflow-x-auto` with the service, attribution, quantity, `Unit price snapshot`, amount and voided state, alongside a `Billable subtotal` card that names what it excludes.
- Added `frontend/src/routes/ServiceUsagePage.tsx`, registered `/service-usage` in `frontend/src/router.ts` and added the `Service Usage` nav link in `RootLayout.tsx`. The page loads a booking by reference or UUID and reads M3-S10's usage list, M3-S08's `GET /api/stays/:bookingRef` for the only trustworthy checked-in lines, and M3-S05's active catalogue for the service picker. Identity again comes from `resolveSessionRole()`, which returns `null` on purpose until M1-S08/M1-S09 session middleware exists, with the same development-only role preview compiling out of production. The submission handler re-checks availability itself rather than trusting the disabled button, so a stale render cannot send a booking-wide charge the server would reject.
- Made a failed supporting read visible instead of silently empty. The stay and catalogue reads only support the usage screen, so their failures do not invalidate the usage list, but reporting them as "0 checked-in rooms" or "no active services" would have looked like an FR-044 refusal or an empty catalogue. `describeSupportFailure` now reports which supporting read failed and what it cost the operator. Voiding was deliberately left out: it is M3-S16.
- Added `frontend/tests/m3ServiceUsageUi.test.ts` and `frontend/tests/m3ServiceUsagePanel.test.tsx` with the `test:m3-service-usage-ui` script. Eighteen model cases cover the role matrix, availability, FR-044 labels including the unknown-line fallback, the price-free payload, quantity/timestamp/UUID validation, room attribution against the checked-in lines, the exact-text money cases including the rounding regression, FR-046 snapshot arithmetic, FR-050 totals, the immutable record merge, list sorting, supporting-read failures and every M3-S10 failure code. Twelve server-rendered panel cases assert that both recording roles get enabled controls with room and unallocated options, read-only roles get disabled controls plus the denial, a booking with no checked-in line is blocked with the FR-044 reason, the snapshot and amount appear, unallocated and room attribution render distinctly, a voided row is excluded from the subtotal, a rejected write and a FINAL invoice read differently, draft errors are wired to `aria-invalid`, and the empty states and explanatory copy render.
- Verification: `npm run test:m3-service-usage-ui --workspace frontend` passes (30 tests), the refactored `npm run test:m3-service-catalogue-ui --workspace frontend` still passes (25), `npm run test:m3-check-in-ui --workspace frontend` (6) and `npm run test:m3-active-stay-ui --workspace frontend` (10) are unchanged, and `npm run build:frontend` passes (`tsc` plus `vite build`, 1973 modules). Re-ran the M3-S10 dependency against the real database: `npm run test:m3-service-usage --workspace backend` passes (1) and `npm run test:m3-service-usage-api --workspace backend` passes (2), confirming the routes, role rule, snapshot and conflict behaviour this UI renders. `git diff --check` is clean.
- Fixes found by review and the new tests: `multiplyMoney` truncated instead of rounding like the server's `ROUND` (FR-046); an unused `UsageAttribution` panel import; a failed stay/catalogue read that was indistinguishable from an empty result; and a submit handler that relied on the disabled button for the FR-044 guard.
- No backend, migration, Member 2 or Member 4 behavior was touched, and no new SQL was written. The screen writes only through M3-S10's confirmed `POST /api/bookings/:bookingRef/service-usage` and never treats a disabled control as enforcement; the server remains the authority for the price snapshot, the checked-in-line check and the FINAL-invoice refusal.
- Remaining: `serviceUsageRoutes` is mounted under `/api`, but no session middleware exists in `backend/src/index.ts` yet, so a live request returns `401 AUTHENTICATION_REQUIRED` and the screen correctly stays read-only; end-to-end recording depends on Member 1's M1-S08/M1-S09. M3-S05's catalogue router is still unmounted, so until it is mounted the service picker is empty and the new supporting-read alert explains why. FR-069's aggregate reporting by line, booking, category and service name belongs to Member 5's `/api/reports` surface and M3-S17's integration tests, not to this record/list screen, and M3-S16 still owns voiding.
- Lecture concepts applied: keeping money exact in the database's own fixed-point semantics (integer hundredths, half-up rounding matching SQL `ROUND`) instead of adopting JavaScript's float arithmetic; treating a failed auxiliary read as a first-class error state so an empty result is never ambiguous; and enforcing a server invariant in the client as an early guard while still leaving the server authoritative.

### 5 October 2026 — M3-S14 chain-wide service catalogue UI

- Added `frontend/src/lib/serviceCatalogueViewModel.ts` as the pure decision layer. `resolveCatalogueCapabilities` maps the six seeded `role.role_name` values onto catalogue rights: only `CHAIN_MANAGER` gets create/price/active-state, so `BRANCH_MANAGER`, `FRONT_DESK`, `SERVICE_STAFF`, `SYSTEM_ADMINISTRATOR` and `AUDITOR` all render the AT-24 read-only state, and an unknown actor stays read-only rather than defaulting to write access. `USAGE_RECORDING_ROLES` marks `FRONT_DESK`/`SERVICE_STAFF` so the denial copy redirects them to usage recording instead of implying they may price services. `parseServiceList` normalises M3-S05's bare-array `GET` response and its `{ service }` write responses, keeping `numeric(12,2)` `current_price` as an exact fixed-point string so prices never pass through a float; `formatLkr` groups thousands. `activeFilterQuery` maps the UI filter onto M3-S05's `?active=true|false` parameter, `validatePrice`/`validateServiceDraft` mirror the server's non-negative price rule at the `numeric(12,2)` scale, `applyCreatedService`/`applyUpdatedService` merge write results immutably, and `catalogueCompleteness` checks FR-042's six services including room service, spa, laundry and minibar-related entries.
- Added `frontend/src/components/catalogue/ServiceCataloguePanel.tsx` on existing shadcn primitives only (`Card`, `Button`, `Input`, `Label`, `Badge`). Every create, price and active-state control is gated on the capability model, so a non-Chain-Manager sees disabled controls with an explicit per-action reason instead of a hidden form. `CataloguePermissionBanner` states the AT-24 position, `CatalogueWriteDenied` renders any server rejection as an authoritative `role="alert"` above the catalogue, and `CatalogueCompletenessNotice` reports the FR-042 gap. The list is a fluid full-width table inside `overflow-x-auto` plus a responsive `grid-cols-1 md:grid-cols-2 xl:grid-cols-3` card deck, matching `LAYOUT.md`.
- Added `frontend/src/routes/ServiceCataloguePage.tsx`, registered `/admin/services` in `frontend/src/router.ts` and added the `Service Catalogue` nav link in `RootLayout.tsx`. It loads on mount and on every filter change, posts `POST /services` and puts `PUT /services/:serviceId` with partial bodies (`current_price` or `active`), and keeps one rejection message for the page. The actor role comes from `resolveSessionRole()`, which currently returns `null` on purpose: M1-S08/M1-S09 session middleware is not mounted, so no trustworthy "who am I" contract exists and the screen must not guess one. A development-only role preview (`import.meta.env.DEV`, so Vite compiles it out of production builds) exercises all six AT-24 states locally and is documented in place as replaceable by the session role.
- Made the error handling accept both envelopes: M3-S05 answers with a flat `{ error: "message" }` while the other Member 3 endpoints use `{ error: { code, message } }`, so `parseCatalogueFailure` handles both and maps status to a code. `describeCatalogueFailure` always shows the canonical Chain-Manager sentence for `CATALOGUE_FORBIDDEN` instead of the server's raw `CHAIN_MANAGER` wording, keeps validation messages verbatim so they stay field-specific, and falls back to stable copy for other failures.
- Added `frontend/tests/m3ServiceCatalogueUi.test.ts` and `frontend/tests/m3ServiceCataloguePanel.test.tsx` with the `test:m3-service-catalogue-ui` script. Seventeen model cases cover the capability matrix for all six roles plus an unknown actor, the AT-24 forbidden set, usage-role redirect, denial copy, two-decimal money handling, price and draft validation, both response envelopes, active filtering and its query parameter, immutable create/update merges, FR-042 completeness, failure parsing for `403`/`404`/`401`/`400`/`500`, and the request paths. Eight server-rendered panel cases assert that `CHAIN_MANAGER` gets enabled controls with no denial copy, `FRONT_DESK`/`SERVICE_STAFF` get disabled price and create controls plus the usage redirect, the other three AT-24 roles and an unknown actor get read-only controls with no assumed role, a server `403` and a validation failure render distinct alerts, and the price/active/FR-042/empty/validation copy renders.
- Verification: `npm run test:m3-service-catalogue-ui --workspace frontend` passes (25 tests), `npm run test:m3-check-in-ui --workspace frontend` (6) and `npm run test:m3-active-stay-ui --workspace frontend` (10) still pass, and `npm run build:frontend` passes (`tsc` plus `vite build`, 1969 modules). Ran the M3-S05 dependency tests against the real database: `npm run test:m3-service-catalogue-api --workspace backend` passes (1) and confirms server-side that `CHAIN_MANAGER` writes are allowed while staff edits are rejected, and `npm run test:m3-service-catalogue --workspace backend` passes (1) on the M3-S02 migration. `git diff --check` is clean.
- Fixes found by the new tests: `parseCatalogueFailure` mapped every non-403/404 flat body to `VALIDATION_ERROR`, so a flat `401` lost its code and was replaced with a single `codeForStatus` mapping; the row denial paragraph originally rendered only the price reason, so the active-state denial copy was invisible for non-Chain-Managers and both reasons are now shown.
- No backend, migration, Member 2 or Member 4 behavior was touched, and no new SQL was written. The UI writes only through M3-S05's confirmed routes and never treats a disabled control as enforcement: the server remains the authority for every catalogue change.
- Remaining: `createServiceRouter` is still intentionally unmounted in `backend/src/index.ts` and M3-S05 is still an unchecked checklist row, so end-to-end click-through depends on Member 1's M1-S08/M1-S09 session middleware mounting it, and the `/services` base path is a provisional choice following the existing `serviceUsageRoutes` convention until that mount point is confirmed. `SERVICE_CATALOGUE_BASE` is the single constant to change. No authenticated current-role endpoint exists, so the screen cannot yet enable Chain Manager controls from a real session, and FR-042's six seeded services are a data requirement for M3-S02/M3-S05 rather than something this UI creates.
- Lecture concepts applied: centralising the authorization decision in one pure, exhaustively tested capability function so the UI cannot drift from the server's role rule; treating an unverified principal as the least-privileged case instead of a fallback assumption; keeping money as exact fixed-point text through the whole render path rather than parsing into binary floating point.

### 5 October 2026 — M3-S13 active-stay detail UI

- Added `frontend/src/lib/activeStayViewModel.ts` as the pure layer behind the active-stay screen. `mergeStayLines` treats M3-S08's `GET /api/stays/:bookingRef` response as the only authority for actual occupancy (a line is `OCCUPIED` only when its open assignment has an open occupancy segment) and merges those rows with the remaining lines from Member 2's `GET /api/bookings/:bookingId` read so a partially checked-in booking still shows every room. A line with no occupancy segment is `PENDING_CHECK_IN`; `CHECKED_OUT`, `CANCELLED` and `NO_SHOW` lines stay visible as history but are never counted as staying. `buildStayGroup` produces the per-booking counts and the `isPartiallyOccupied` flag, `summarizeStay` totals the panel, and `parseStayFailure`/`describeStayFailure`/`isBranchDenial` separate a branch `403 STAY_ACCESS_DENIED` from a `404`/`401`/`500`.
- Added `frontend/src/components/stay/ActiveStayPanel.tsx` on shadcn primitives only (`Card`, `Button`, `Input`, `Label`, `Badge`). Each booking renders one group header (guest, reference, `PARTIALLY OCCUPIED` badge, occupied/awaiting counts), a fluid full-width line table and a responsive `grid-cols-1 md:grid-cols-2` card deck; every line shows its own room number, line status, occupancy badge, stay window, guest count and occupancy start. Separate `ActiveStayBranchDenial`, `ActiveStayLoadFailure` and `ActiveStayEmptyState` states cover cross-branch refusal, other load failures and a booking with no occupied line.
- Added `frontend/src/routes/ActiveStayPage.tsx`, registered `/stays` in `frontend/src/router.ts` and added the `Active Stays` nav link in `RootLayout.tsx`. The page loads by booking reference or booking UUID; a UUID additionally fetches the booking detail so remaining lines appear next to occupied rooms, and a failed detail fetch degrades to the occupied rooms only instead of failing the page.
- Added `frontend/tests/m3ActiveStayUi.test.ts` and `frontend/tests/m3ActiveStayPanel.test.tsx` with the `test:m3-active-stay-ui` script. The view-model cases cover partial state (one `OCCUPIED`, one `PENDING_CHECK_IN`, correct counts and branch list), fully occupied and fully pending bookings not being flagged partial, closed/cancelled lines excluded from staying counts while remaining visible, a future `BOOKED` line never rendering as occupied, the active-stay read overriding the booking read on room and status, occupancy still resolving when no booking detail is available, `parseActiveStays` tolerating malformed payloads, branch denial versus other failures, the single-booking request path and the documented responsive breakpoints. The panel case server-renders the component and asserts the booking grouping, distinct room numbers, both statuses and the responsive `md:grid-cols-2` / `overflow-x-auto` classes in the markup.
- Verification: `npm run test:m3-active-stay-ui --workspace frontend` passes (10 tests), `npm run test:m3-check-in-ui --workspace frontend` still passes (6) and `npm run build:frontend` passes (`tsc` plus `vite build`, 1966 modules). Re-ran the dependency `test:m3-active-stay` (2) before starting: M3-S08's read resolves both checked-in rooms, excludes the future line and rejects a cross-branch actor, so M3-S13 is built against a green dependency. Two type errors surfaced during the build (`guest` missing on the local booking type, then a narrowed literal type) and were fixed by declaring the merged booking as `BookingStaySummary`.
- No backend, migration, Member 2 line/assignment or Member 4 checkout behavior was touched, and no new SQL was written. M3-S13 is presentation-only: it writes nothing and reads only M3-S08's and Member 2's confirmed contracts.
- Remaining: M3-S08 is still an unchecked checklist row, so end-to-end click-through depends on it and on Member 1's production session middleware (M1-S08/S09) mounting the protected routers. FR-040 also asks for booking-level payments and running balance beside the line rows; that is Member 4's billing surface (`fn_booking_balance` / invoice lines) and is deliberately not duplicated here. The responsive coverage asserts the shared layout tokens and the rendered breakpoints, not a real browser at each viewport.
- Lecture concepts applied: separating the authoritative read from derived presentation state so occupancy is never inferred client-side from a booking snapshot; modelling "partial" occupancy as an explicit aggregate over normalized per-line rows instead of a boolean guess, which keeps multi-room bookings inspectable rather than collapsing to a single stay.

### 5 October 2026 — M3-S12 line-specific check-in UI

- Added `frontend/src/lib/checkInViewModel.ts` as the UI's pure decision layer. It consumes the booking-detail line/assignment shape that Member 2's `GET /api/bookings/:bookingId` already returns, derives per-line check-in availability (`ELIGIBLE`, `NOT_BOOKED`, `NO_OPEN_ASSIGNMENT`, `ROOM_INACTIVE`, `ROOM_NOT_READY`, `OUTSIDE_STAY`), mirrors the server's stay-window rule using the Asia/Colombo stay date, and applies a successful response so only the selected line becomes `CHECKED_IN` while every other line keeps `BOOKED`. `applyCheckInSuccess` returns new line objects and never mutates the list it was given.
- Added `frontend/src/components/checkin/LineCheckInPanel.tsx`, built only from shadcn primitives (`Card`, `Button`, plus a new `Badge` in `frontend/src/components/ui/badge.tsx` following the Mono geometry from `DESIGN.md`). Each line renders its own room number, `BOOKED`/`CHECKED_IN` badge, physical `READY`/`CLEANING`/`OUT_OF_SERVICE` badge, stay window and a per-line "Check in this room" control that is disabled with an explanatory reason whenever the line is not eligible. Rejections render in an inline `role="alert"` block; a successful check-in renders a `role="status"` confirmation that names the line-specific scope.
- Added `frontend/src/routes/CheckInPage.tsx` and registered `/check-in` in `frontend/src/router.ts` with a navigation link in `RootLayout`. The page loads a booking by UUID, keeps one rejection message per line so one rejected room never disturbs its siblings, and posts to the M3-S07 route `POST /api/bookings/:bookingRef/lines/:lineId/checkin`. Stable backend codes map to staff-facing text (`CHECK_IN_CONFLICT`, `INVALID_CHECK_IN_STATE`, `BRANCH_ACCESS_DENIED`, `CHECK_IN_FORBIDDEN`, `STAFF_AUTHORIZATION_REQUIRED`, `AUTHENTICATION_REQUIRED`, `BOOKING_LINE_NOT_FOUND`), with a message fallback so an unmapped code still renders safely.
- Added `frontend/tests/m3CheckInUi.test.ts` and the `test:m3-check-in-ui` script. Six cases cover the acceptance criteria: two eligible lines where checking in one leaves the other `BOOKED` with `occupiedFrom` still null and no input mutation, readiness gating for `READY`/`CLEANING`/`OUT_OF_SERVICE`, rejection of `CHECKED_IN`/unassigned/inactive lines, the stay-window boundaries including the departure day, rejection-message mapping for conflict/branch/auth/unmapped failures, and the line-scoped request path.
- Verification: `npm run test:m3-check-in-ui --workspace frontend` passes (6 tests) and `npm run build:frontend` passes (`tsc` plus `vite build`, 1963 modules). No backend, migration, Member 2 line/assignment or Member 4 checkout behavior was touched. The first build failed on an unused `lastSuccess` panel prop (TS6133); the prop was removed because the page already renders the confirmation banner.
- Remaining: end-to-end click-through still depends on M3-S07 being mounted with Member 1's production session middleware (M1-S08/S09); the protected check-in router is still intentionally unmounted in `backend/src/index.ts`. Member 3 wrote no server state in this task, so the M3-S06 per-line invariants remain the single source of truth and the UI only reflects them.
- Lecture concepts applied: presenting the server as the transactional source of truth while the client mirrors only the guards needed for immediate feedback (readiness, stay window, line state); normalizing UI state into one pure, testable mapping function keeps the partial check-in acceptance case verifiable without a browser or a live database.

### 5 October 2026 — M3-S11 controlled service-usage void

- Added `backend/migrations/m3_006_service_usage_void_guard.sql` for SRS §4.6.2/FR-048/FR-058/NFR-SAF-04. A `BEFORE UPDATE OR DELETE` trigger keeps every recorded value (`usage_id`, booking, service, room line, `used_at`, `quantity`, `unit_price_snapshot`, `recorded_at`, `recorded_by`) immutable, requires `voided`, `voided_at` and `voided_by` to be set together, permits a void at most once, rejects any un-void or re-charge, and rejects deletion so the original financial event is retained.
- Added `voidServiceUsage` to `backend/src/services/serviceUsageService.ts`. It resolves the usage's booking, locks booking then invoice in Member 4's order, rejects FINAL invoices before any write, rejects an already voided row, stamps one server instant for the void, writes a single `audit_log` `VOID` row carrying the voided amount and optional reason, calls `fn_refresh_draft_invoice` and returns the resulting `fn_booking_balance` totals with explicit credit flagging for Member 4's manual refund path. Any failure rolls the whole void back.
- Added `POST /api/bookings/:bookingRef/service-usage/:usageId/void` to the usage controller/routes. Identity comes only from verified `req.user`; BRANCH_MANAGER may void own-branch usage, CHAIN_MANAGER/SYSTEM_ADMINISTRATOR across branches, and FRONT_DESK/SERVICE_STAFF recording roles are denied. Errors map to stable codes (`VOID_ACCESS_DENIED`, `USAGE_NOT_FOUND`, `USAGE_ALREADY_VOIDED`, `INVOICE_FINAL`, `VOID_REJECTED`). The usage list now returns `voided_by` so Member 5's reports and M3-S15/S16 UI can show the retained reversal.
- Added `backend/tests/m3ServiceUsageVoid.test.cjs` (`test:m3-service-usage-void`) and `backend/tests/m3ServiceUsageVoidApi.test.cjs` (`test:m3-service-usage-void-api`). The schema test covers partial voids, rewritten price/quantity/actor, deletion, repeated void, un-void and migration idempotency. The API tests cover own-branch void with original row/actor/time retention, one audit row, credit visibility after refresh, repeated void rejection, anonymous/recorder/cross-branch denial, wrong-booking and unknown-usage rejection and FINAL-invoice rejection with no refresh. Extended `test:m3-current-baseline` with a real-chain void: `fn_service_total` drops to 0.00, the settled payment becomes credit, and un-void/delete fail.
- Verification: `test:m3-service-usage-void` (1), `test:m3-service-usage-void-api` (2), `test:m3-current-baseline` (2), `test:m3-service-usage` (1), `test:m3-service-usage-recording` (2), `test:m3-service-usage-api` (2), `test:m3-check-in` (3), `test:m3-check-in-api` (2), `test:m3-active-stay` (2), `test:m3-room-status-history` (1), `test:m3-service-catalogue` (1), `test:m3-service-catalogue-api` (1), `test:m4-billing` (1), `test:m4-checkout` (10) and `test:reports` (1) all pass; `npm run build` passes. Fixed `resolveBookingAnyAssignment` to use the same unqualified booking predicate as the existing resolver.
- Remaining: TBD-15 role-matrix owner review of who may void, M3-S16 void UI, and Member 4 confirmation that a post-void credit is handled only through the existing manual refund path. M3-S18 room-condition work is still outstanding and untouched.
- Lecture concepts applied: normalization keeps the charge and its reversal on one audited row instead of duplicating events; exact fixed-point `numeric` preserves the original amount for audit while derived credit uses rounded values; `BEFORE UPDATE OR DELETE` triggers plus check constraints enforce invariants closer to the data than application code alone; pessimistic row locking in a deterministic booking-then-invoice order prevents lost updates between concurrent voids and draft refreshes; statement-level rollback keeps a failed void from leaving partial audit evidence.
- No commit, branch, push or PR was performed.

### 5 October 2026 — reconcile existing M3 cores with the current Member 2 baseline

- The historical entries below retain what Member 3 originally reported. Their old correction-task prerequisite claims and invoice-last proposal are superseded by this entry and the current reservation contract.
- Retained published m3_001/m3_002 mocks and upgraded their existing tables through unique m3_003 usage, m3_004 catalogue and m3_005 history keys. Reused room_condition_enum and preserved IDs, rates, immutable history, reason fields and the existing checkout hook. No M3-S18 authorization or later usage/UI task was implemented.
- Fixed real date-column comparison, server Asia/Colombo check-in timing and safe database-conflict responses. Protected M3 routes now require injected session middleware and verified req.user; routers remain unmounted while M1-S08/S09 is pending. M3-S07/S08 were returned to unchecked because fixture-level evidence did not complete production authentication acceptance.
- Eleven existing M3 tests pass. Two new transaction-local isolated tests pass for the complete numbered chain, preserved mock data, real M2 booking creation, partial check-in/active occupancy and M4 checkout history. Both builds pass. Existing M4 checkout API failures and the separate production runner/database verification incident are recorded in `conflict_resolution_handoff.md`.
- Lecture concepts applied: normalization, referential/domain integrity, exact decimal snapshots, immutable event history, atomic rollback, shared-row locking and transaction-local schema isolation. No commit or publication was performed.

### 29 September 2026 — M3-S01

- Published the target multi-room operational handoff in `member_tasks/m2_s01_reservation_contract.md`, the SRS §6.1.8 handoff, the Member 3 checklist and Member 4's consumer handoff.
- Defined one transaction and deterministic lock order: booking, affected lines by `line_id`, open assignments by `assignment_id`, affected rooms by `room_id`, then the DRAFT invoice for checkout. Defined per-line check-in, actual occupancy segments, no room-history event when READY is unchanged, Member 3's physical-condition operation, Member 4's checkout delegation and full rollback behavior.
- Explicitly excluded the current legacy booking-level status, one-open-assignment-per-booking rule and `room.booking_id` pointer from the target contract. M2/M4 confirmation remains open, so the M3-S01 checklist item is not marked complete.
- Verification: reviewed the current M2-S24/M2-S06/M2-S05/M2-S04 migrations, SRS §4.5-§4.6 and §6.1.7-§6.1.8, M2-S01, Member 4's plan and the transaction/normalization lecture references. Documentation-only change; no database or application build was required. `git status --short` was clean before editing.
- Lecture concepts applied: normalized line/assignment relationships remove duplicated room pointers; ACID atomicity and rollback cover the multi-table transition; deterministic lock ordering reduces deadlock risk; row-level locking and database guards protect concurrent room/assignment state.
- Remaining handoff: Members 2 and 4 must confirm the proposed order and retry/error contract before M3-S06 and M4-S09 proceed.

### 29 September 2026 — M3-S02

- Added `backend/migrations/m3_001_service_catalogue.sql` for the chain-wide `service` catalogue: UUIDv7 primary key, nonblank name/category, active state, UTC `timestamptz` timestamps and non-negative finite LKR `numeric(12,2)` current price. Added a unique service-name constraint from SRS FR-043.
- Added `backend/tests/m3ServiceCatalogue.test.cjs` and the `test:m3-service-catalogue` script. The isolated test verifies metadata, generated UUIDv7, two-decimal rounding, defaults, inactive rows, duplicate names, blank values, negative/NaN/overflow prices, invalid UUIDs and scratch-schema rollback.
- Verification: `npm run test:m3-service-catalogue --workspace backend` passed (1 test). Backend build and final diff validation remain to run. M3-S02 stays unchecked because TBD-08 owner review is still open.
- Lecture concepts applied: normalized chain-wide catalogue data avoids repeating service details in usage rows; exact numeric preserves historical monetary values; domain checks and unique-key integrity reject invalid catalogue states; transactional rollback keeps isolated verification side-effect free.

### 30 September 2026 — M3-S03

- Added `backend/migrations/m3_002_room_status_history.sql` for immutable physical room-condition history using the target `READY`, `CLEANING` and `OUT_OF_SERVICE` domain. Rows use UUIDv7 IDs, UTC `timestamptz`, restricted FKs to `room` and `user_account`, a no-op transition check and a room/time lookup index. UPDATE and DELETE are rejected by an append-only trigger.
- Added `backend/tests/m3RoomStatusHistory.test.cjs` and the `test:m3-room-status-history` script. The isolated test covers metadata, UUIDv7 generation, valid READY/CLEANING transitions, no-op rejection, invalid status and FK rejection, immutable update/delete behavior and scratch-schema rollback.
- Verification/build still need to run. M3-S03 remains unchecked because M2-S23 has not yet converted the legacy `room` condition column and the shared owner review remains open.
- Lecture concepts applied: normalized event history keeps condition transitions separate from the room master row; restricted foreign keys preserve referential integrity; append-only history and transaction rollback protect audit evidence and isolated test cleanup.

### 30 September 2026 — M3-S04

- Added `backend/migrations/m3_003_service_usage.sql` for service usage events with UUIDv7 IDs, UTC `timestamptz` usage/record/void timestamps, positive `numeric(10,2)` quantity, non-negative LKR `numeric(12,2)` unit-price snapshots, optional `booking_room_line_id`, void metadata and restricted booking/service/actor FKs. Added required booking/time/service indexes.
- Added a database trigger that requires a checked-in line from the same booking for room-specific usage, or any checked-in line for booking-wide usage. Added a void-consistency check so active rows have no void metadata and voided rows retain both void time and actor.
- Added `backend/tests/m3ServiceUsage.test.cjs` and the `test:m3-service-usage` script. The isolated test covers booking-wide and room-specific inserts, fractional quantity/price rounding, cross-booking and non-checked-in attribution rejection, invalid/overflow quantity and price, void consistency and scratch-schema rollback.
- Verification/build still need to run. M3-S04 remains unchecked because the TBD-08 precision review and Member 2's final line/checked-in guard contract remain open; price capture itself belongs to the later service-usage recording procedure/API.
- Lecture concepts applied: normalized service events avoid repeating catalogue details, exact numeric preserves charge snapshots, foreign keys protect referential integrity, and transactional rollback keeps focused schema tests side-effect free.

### 04 October 2026 — M3-S05

- Implemented the chain-wide service catalogue API in `backend/src/controllers/serviceController.ts` and `backend/src/routes/serviceRoutes.ts`, and mounted the router in `backend/src/index.ts` at `/api/services`.
- Enforced the role gate: only `CHAIN_MANAGER` can create or update the shared `service` catalogue; read access supports optional `active=true/false` filtering; field and price validation rejects invalid values; catalogue updates leave historical `service_usage.unit_price_snapshot` records unchanged.
- Added `backend/tests/m3ServiceCatalogueApi.test.cjs` and the `test:m3-service-catalogue-api` script. The isolated schema test verifies CHAIN_MANAGER create/update success, FRONT_DESK rejection, filtering and validation flow, and scratch-schema rollback.
- Verification: `npm run test:m3-service-catalogue-api` passed (1 test). `git diff --check` was also run and remained clean.
- Remaining handoff: the next task is per-line check-in and room-status transition orchestration, not catalogue editing itself.

### 04 October 2026 — M3-S06

- Implemented `backend/src/services/checkInService.ts` for target per-line check-in. The transaction locks the booking, selected line, open line assignment and assigned room in deterministic order, validates the BOOKED state, stay date, single open assignment and READY physical condition, then sets only that line to CHECKED_IN and records its `occupied_from` instant.
- The service writes exactly one `booking_room_line_status_history` row and one `audit_log` row, leaves the room condition unchanged, and rolls back all writes on any later failure.
- Validated with `npm run test:m3-check-in`: 3 tests passed covering partial check-in with another line still BOOKED, non-READY rejection without mutation, and forced audit failure rollback. `npm run build` remains blocked by the existing `pg` declaration/implicit-any errors in `src/db.ts` and `src/migrations/migrate.ts`.
- M3-S06 remains a production handoff item until Member 2's M2-S25/M2-S26 corrective migrations provide `booking_room_assignment.line_id`, actual occupancy columns and the target line-history contract; the focused tests use an isolated fixture for that agreed target schema.
- Lecture concepts applied: ACID atomicity and rollback for the multi-table transition, row-level locking with deterministic lock order, and normalized line/assignment occupancy instead of a stored room booking pointer.

### 04 October 2026 — M3-S07

- Added `backend/src/controllers/checkInController.ts` and `backend/src/routes/checkInRoutes.ts`, exposing `POST /api/bookings/:bookingRef/lines/:lineId/checkin`.
- The controller validates the booking reference and line UUID, resolves the assigned room branch, authorizes active staff from `officer`/`role`/`user_account`, enforces own-branch access for `FRONT_DESK` and `BRANCH_MANAGER`, permits chain-wide manager/administrator roles, and invokes M3-S06 through one pooled transaction client.
- Added safe JSON error mapping for unauthenticated, invalid identifier, missing booking/line, forbidden role/branch, repeated invalid state and room/assignment conflict responses. Resolved the pre-existing `backend/src/index.ts` merge conflict while preserving the existing service, reporting, invoice, payment, checkout and availability route registrations.
- Added `backend/tests/m3CheckInApi.test.cjs` and the `test:m3-check-in-api` script. Verification: `npm run test:m3-check-in-api` passed 2 tests; the M3-S06 regression `npm run test:m3-check-in` passed 3 tests; touched TypeScript diagnostics are clean.
- Lecture concepts applied: least-privilege role/branch authorization, parameterized relational joins for booking-line ownership, and transaction client pinning so all check-in writes share one PostgreSQL transaction.

### 05 October 2026 — M3-S08

- Added `backend/src/controllers/activeStayController.ts` and `backend/src/routes/activeStayRoutes.ts`, exposing `GET /api/stays/:bookingRef`.
- The API resolves booking references or UUIDs, reuses `verifyBookingAccess` for guest/staff branch authorization, and returns only CHECKED_IN lines joined to open assignments with active occupancy (`occupied_from IS NOT NULL` and `occupied_to IS NULL`). Each current room is returned distinctly with line, room, branch and occupancy fields; future BOOKED lines are excluded.
- Added `backend/tests/m3ActiveStayApi.test.cjs` and the `test:m3-active-stay` script. Verification: 2 focused tests passed for two distinct active rooms/future-line exclusion and cross-branch denial; `npm run build` passed; `git diff --check` passed.
- Lecture concepts applied: normalized line-assignment joins for derived occupancy, parameterized SQL for safe read access, and least-privilege branch authorization for staff tenancy.

### 05 October 2026 — M3-S09

- Added `backend/src/services/serviceUsageService.ts` with transactional service-usage recording. The service locks the booking, invoice, service catalogue row and optional room line; requires at least one CHECKED_IN line; validates same-booking attribution; snapshots the active service's current price server-side; ignores client-supplied price fields; inserts the usage event; invokes Member 4's `fn_refresh_draft_invoice` hook; and rolls back on failure.
- FINAL invoices are rejected before insertion. Booking-wide usage remains unallocated to a room line while still requiring a checked-in line; room-specific usage requires a CHECKED_IN line from the same booking.
- Added `backend/tests/m3ServiceUsageRecording.test.cjs` and the `test:m3-service-usage-recording` script. Verification: 2 focused tests passed for price snapshot/draft refresh and cross-booking/FINAL rejection; `npm run build` passed; M3-S06 and M3-S08 regressions passed; `git diff --check` passed.
- Lecture concepts applied: ACID atomicity and rollback for usage plus billing refresh, row locking for catalogue/invoice consistency, exact fixed-point numeric snapshots, and normalized optional line attribution.

### 05 October 2026 — M3-S10

- Added `backend/src/controllers/serviceUsageController.ts` and `backend/src/routes/serviceUsageRoutes.ts`, exposing `POST /api/bookings/:bookingRef/service-usage` and `GET /api/bookings/:bookingRef/service-usage`.
- The API uses only verified `req.user` identity, authorizes active own-branch `FRONT_DESK` and `SERVICE_STAFF`, validates service/line UUIDs, positive finite quantities and usage timestamps, rejects cross-branch access, and delegates writes to `recordServiceUsage` so server-side catalogue snapshots and draft-invoice refresh remain transactional.
- Added `backend/tests/m3ServiceUsageApi.test.cjs` and the `test:m3-service-usage-api` script. Verification: 2 API tests passed for own-branch recording/listing with server price capture and cross-branch/invalid-quantity rejection; M3-S09 recording tests passed; `npm run build` passed.
- Lecture concepts applied: least-privilege role/branch authorization, parameterized SQL joins, normalized optional room-line attribution, and transaction atomicity across usage and draft-bill refresh.

## Member 4 — Chamikara

### 30 September 2026 — M4-S02 (Invoice and Invoice_Line Schema)
- Created PostgreSQL migrations for `invoice` and `invoice_line` tables in `backend/migrations/m4_001_invoice_and_lines.sql`.
- Added constraints to enforce exactly one invoice per booking (`invoice_booking_id_unique`).
- Implemented `DRAFT`/`FINAL` transition rules: unassigned `invoice_number` and `issued_at` during DRAFT, requiring them at FINAL.
- Implemented constraints for line signs (negative DISCOUNT, signed adj, non-negative standard charges) and exact LKR `numeric(14,2)` bounds.
- Added triggers `trg_check_cross_booking_line` to block cross-booking line attribution, and `trg_reject_final_invoice_edits` to prevent modification of lines linked to FINAL invoices.
- Created `m1_004_billing_policy_mock.sql` to support foreign key dependencies for tests.
- Provided PL/pgSQL validation script `backend/tests/m4_s02_schema_test.sql` covering invalid line configurations, cross-booking updates, missing FKs, duplicate rows, and FINAL immutability.

### 01 October 2026 — M4-S03 (Payment and Refund Schema)
- Created PostgreSQL migration for `payment` in `backend/migrations/m4_002_payment.sql`:
  - Created enums `payment_kind_enum` ('PAYMENT', 'REFUND'), `payment_status_enum` ('SUCCESSFUL', 'FAILED', 'REVERSED'), and `payment_method_enum` ('CASH', 'BANK_TRANSFER') per SRS Table 40, §4.7.3, and §6.1.4.
  - Created `payment` table with UUIDv7 PK (`uuid_extract_version = 7`), `booking_id` FK to `booking(booking_id)` ON UPDATE/DELETE RESTRICT, `recorded_by` FK to `user_account(user_id)` ON UPDATE/DELETE RESTRICT.
  - Added positive LKR `numeric(14,2)` amount check (`amount > 0 AND amount <> 'NaN'::numeric`), non-blank trimmed reference check (`btrim(reference) <> ''`), and unique constraint on `reference`.
  - Created B-tree indexes `idx_payment_booking_id` and `idx_payment_recorded_by`.
  - Added trigger `trg_enforce_payment_immutability`: strictly prohibits DELETE operations on payment records, blocks mutation of critical payment attributes (`payment_id`, `booking_id`, `amount`, `kind`, `method`, `reference`, `paid_at`, `recorded_at`), and allows status transitions only from `SUCCESSFUL` to `REVERSED`.
  - Added trigger `trg_audit_payment`: automatically captures `CREATE` and `REVERSE` events in `audit_log` with entity details and timestamps when `audit_log` exists.
- Added TypeScript model `backend/src/models/payment.ts` exposing `PaymentKind`, `PaymentStatus`, `PaymentMethod`, and `Payment` interface.
- Added automated test suite `backend/tests/m4Payment.test.cjs` and registered `"test:m4-payment"` in `backend/package.json`. Tests cover column inventory, UUIDv7 generation/rejection (v4 and nil), valid CASH PAYMENT, valid BANK_TRANSFER REFUND, valid FAILED payment, invalid kinds/amounts/statuses/methods, missing/empty/whitespace references, duplicate references, FK violations, parent deletion restriction, status transition immutability, attribute mutation rejection, DELETE rejection, and audit log generation.
- Added PL/pgSQL validation script `backend/tests/m4_s03_schema_test.sql`.
- Verification:
  - `npm run test:m4-payment --workspace backend` passed (1 test with 14 comprehensive test blocks).
  - Regression suite passed: `test:m1-identity`, `test:m1-guests`, `test:m2-booking`, `test:m2-rooms`, `test:m2-catalogue`, `test:migrations`.
  - Full 10-migration ordered chain apply verified against an isolated temporary PostgreSQL schema with idempotency verification on re-run.
  - `npm run build:backend` and `npm run build:frontend` compiled with 0 errors.
- Lecture concepts applied:
  - Entity integrity via UUIDv7 primary keys and version verification checks (`01_Introduction_to_SQL.md`).
  - Domain integrity and value domains with custom PostgreSQL enums and domain CHECK constraints for positive amounts and trimmed non-blank references (`02_Intermediate_SQL.md`).
  - Referential integrity via type-matched foreign keys to `booking` and `user_account` with `ON UPDATE RESTRICT ON DELETE RESTRICT` (`02_Intermediate_SQL.md`).
  - B-tree indexing on foreign key columns and unique candidate keys for efficient queries and join operations (`05_Storage_Indexing_Query_Processing_Transactions.md`).
  - Immutability and financial audit preservation using BEFORE/AFTER triggers to reject deletions/arbitrary mutations and write immutable audit trail records (`03_Advanced_SQL.md`).

### 01 October 2026 — M4-S04 (Deterministic Room Charges, Calculation Order, and Rounding Engine)
- Created mock migration `backend/migrations/m3_001_service_usage_mock.sql` satisfying the M3-S04 schema dependency (`service` and `service_usage` per Table 40 and §6.1.4).
- Created PostgreSQL migration `backend/migrations/m4_003_billing_calculation.sql`:
  - `fn_billable_nights(stay_start_date, stay_end_date)`: returns reserved nights (`stay_end_date - stay_start_date`), enforcing `stay_end_date > stay_start_date`. Early departure retains reserved nights.
  - `fn_room_charge(booking_id)`: returns exact sum of rounded room night charges for `BOOKED`, `CHECKED_IN`, and `CHECKED_OUT` lines; excludes `CANCELLED` and `NO_SHOW` room nights.
  - `fn_service_total(booking_id)`: returns exact sum of rounded non-void `service_usage` charges.
  - `fn_calculate_booking_invoice_lines(booking_id, approved_discount)`: generates deterministic invoice lines in §4.7.4 order using ONLY the invoice's linked billing policy version.
- Implemented TypeScript calculation service `backend/src/services/billingCalculator.ts`:
  - `roundCurrency(val)`: commercial rounding (ties away from zero) to 2 decimals matching PostgreSQL `numeric(14,2)`.
  - `calculateBillableNights(startDate, endDate)`: calculates reserved nights.
  - `computeInvoiceBreakdown(policy, roomLines, serviceUsages, options)`: pure deterministic calculation implementing full SRS §4.7.4 calculation order:
    1. Room lines (BOOKED provisional, CHECKED_IN/OUT standard, CANCELLED/NO_SHOW room charge excluded).
    2. Non-void service usages (each usage charge rounded to two decimals).
    3. Gross subtotal `G = sum(ROOM) + sum(SERVICE)`.
    4. Discount `D` capped at `policy.max_discount_percent` of `G`, never > `G`, represented as negative invoice line.
    5. Percentage service charge on `(G - D)`.
    6. Tax on `(G - D + service_charge)`.
    7. Flat fees (cancellation fee, no-show fee, approved late checkout fee) and price adjustments added after tax.
    8. Total amount from exact sum of signed lines.
  - `calculateBookingInvoiceFromDb(client, bookingId, options)`: queries booking, invoice-linked billing policy, room lines, and non-void service usages directly from PostgreSQL and returns structured breakdown.
- Added automated test suite `backend/tests/m4BillingCalculation.test.cjs` and registered `"test:m4-billing"` in `backend/package.json`. Tests cover:
  1. Mixed-type two-rate booking (Single + Deluxe rates reconcile separately and aggregate accurately).
  2. Same-type equal-base-rate booking (two Single rooms snapshot identical base rates).
  3. Changed pre-arrival dates (date revision updates reserved nights and recalculates charges).
  4. Partial cancellation & no-show (room nights excluded, linked policy flat fees added).
  5. Early checkout (retains original reserved nights charge) and late checkout (adds flat late checkout fee).
  6. Non-void service usages (counted once, voided usages excluded).
  7. Policy-version change & policy isolation (proves that later published policy changes do not affect existing bookings bound to an earlier policy version).
  8. Exact commercial rounding ties away from zero and discount cap enforcement.
  9. Database function `fn_calculate_booking_invoice_lines`.
- Verification:
  - `npm run test:m4-billing --workspace backend` passed (1 test with 9 comprehensive verification blocks).
  - Full regression suite passed: `test:m4-payment`, `test:m1-identity`, `test:m1-guests`, `test:m2-booking`, `test:m2-rooms`, `test:m2-catalogue`, `test:migrations`.
  - Full 12-migration ordered chain apply verified against an isolated temporary PostgreSQL schema with idempotency verification on re-run.
  - `npm run build:backend` and `npm run build:frontend` compiled with 0 errors.
- Lecture concepts applied:
  - Exact fixed-point numeric arithmetic (`numeric(14,2)`) avoiding floating-point rounding drift (`01_Introduction_to_SQL.md`).
  - Set aggregation and conditional expressions (`COALESCE`, `SUM`, `LEAST`, `ROUND`) in SQL functions (`01_Introduction_to_SQL.md`).
  - Referential integrity and joins across normalized multi-room booking, invoice, billing policy, and service usage relations (`02_Intermediate_SQL.md`).
  - Transactional isolation and deterministic calculation avoiding update anomalies (`04_Normalization_Lab_5.md`, `05_Storage_Indexing_Query_Processing_Transactions.md`).

### 01 October 2026 — M4-S05 (Audited DRAFT Invoice Lifecycle, Balance Calculation, and Single FINAL Issuance)
- Created PostgreSQL migration `backend/migrations/m4_004_invoice_lifecycle.sql`:
  - Partial unique index `idx_invoice_number_unique` on `invoice (invoice_number) WHERE invoice_number IS NOT NULL` ensuring distinct invoice numbers for FINAL invoices while permitting NULL for DRAFTs.
  - Sequence `invoice_number_seq` and generator function `fn_generate_invoice_number()` producing sequential, structured invoice numbers (`INV-YYYYMMDD-XXXXX`).
  - Immutability trigger `trg_enforce_invoice_immutability` on `invoice`: prevents UPDATE or DELETE mutations once an invoice reaches `FINAL` status.
  - Audit trigger `trg_audit_invoice` on `invoice`: logs `CREATE` and `STATUS_CHANGE` (from DRAFT to FINAL) events with timestamps and actor user ID to `audit_log`.
  - Booking-confirmation hook for Member 2 `fn_create_booking_draft_invoice(booking_id, user_id)`: selects effective billing policy version by descending `(effective_from, created_at, billing_policy_id)` where `effective_from <= CURRENT_DATE`, creates DRAFT invoice in the same transaction, and populates initial invoice lines. Implements idempotent retry behavior returning existing DRAFT invoice ID on repeat calls, and triggers transactional rollback if no policy is applicable.
  - Function `fn_refresh_draft_invoice_lines(invoice_id, approved_discount)`: refreshes and recalculates lines for a DRAFT invoice while preserving manual `PRICE_ADJUSTMENT` lines.
  - Shared balance calculation `fn_booking_balance(booking_id)`: computes invoice total amount minus net successful payments (successful payments minus successful refunds, ignoring failed and reversed payments) per SRS §4.7.4, §4.8.3, and M4-S07.
  - Single FINAL issuance function `fn_issue_final_invoice(booking_id, user_id)`: locks invoice row, enforces that all room lines are terminal (`CHECKED_OUT`, `CANCELLED`, `NO_SHOW`; keeping DRAFT if any line remains active for partial checkout), refreshes charges, verifies balance is exactly zero (blocking underpaid debt or unrefunded credit), assigns sequential invoice number and issuance timestamp, and transitions status to `FINAL`.
- Added TypeScript model `backend/src/models/invoice.ts` and service `backend/src/services/invoiceService.ts` exposing `createBookingDraftInvoice`, `refreshDraftInvoice`, `getBookingBalance`, `issueFinalInvoice`, and `getBookingInvoiceDetails`.
- Added automated test suite `backend/tests/m4InvoiceLifecycle.test.cjs` and registered `"test:m4-invoice"` in `backend/package.json`. Tests cover:
  1. Missing-policy rollback during booking confirmation hook.
  2. Audited DRAFT invoice creation with line generation and effective policy linking.
  3. Idempotent retry behavior.
  4. Direct duplicate invoice creation prevention (unique constraint).
  5. Later draft charges updating draft total upon refresh.
  6. Partial checkout retaining DRAFT invoice when active lines remain.
  7. Unpaid positive balance blocking FINAL issuance.
  8. Unrefunded credit balance blocking FINAL issuance until refunded.
  9. Single FINAL issuance generating sequential invoice number, issuance timestamp, and audit record.
  10. Immutable FINAL lines and invoice (blocking INSERT, UPDATE, DELETE on lines and invoice, and blocking re-finalization/refresh).
  11. Unique consecutive invoice numbering across multiple finalized bookings.
- Verification:
  - `npm run test:m4-invoice --workspace backend` passed (1 test with 11 subtest scenarios).
  - Regression suite passed: `test:m4-payment`, `test:m4-billing`, `test:migrations`.
  - Full 13-migration ordered chain apply verified against an isolated temporary PostgreSQL schema with idempotency verification on re-run.
  - `npm run build:backend` and `npm run build:frontend` compiled with 0 errors.
- Lecture concepts applied:
  - Partial indexing (`CREATE UNIQUE INDEX ... WHERE invoice_number IS NOT NULL`) for space-efficient and semantically precise conditional uniqueness (`05_Storage_Indexing_Query_Processing_Transactions.md`).
  - Sequence generation and deterministic identifier generation (`03_Advanced_SQL.md`).
  - Multi-condition constraint validation, state-machine transitions, and immutability enforcement via PL/pgSQL triggers (`03_Advanced_SQL.md`).
  - Row-level locking (`SELECT ... FOR UPDATE`) in pessimistic concurrency control to avoid race conditions during balance settlement and invoice finalization (`05_Storage_Indexing_Query_Processing_Transactions.md`).
  - Transaction atomicity and rollback semantics (`05_Storage_Indexing_Query_Processing_Transactions.md`).

### 03 October 2026 — M4-S06 (Invoice Detail & Payment History Read API with Scoped Access)
- Created PostgreSQL migration `backend/migrations/m4_005_invoice_query_indexes.sql`:
  - Created B-tree index `idx_invoice_line_invoice_id` on `invoice_line(invoice_id)` to optimize joins and line retrieval by invoice.
  - Created composite B-tree index `idx_payment_booking_kind_status` on `payment(booking_id, kind, status)` to accelerate payment history and net-balance aggregation queries per lecture 5 indexing recommendations.
- Extended TypeScript models in `backend/src/models/invoice.ts`:
  - `InvoiceSummary`: computes signed line totals, successful payments, refunds, net payments, net balance, and explicit credit flags (`is_credit: boolean`, `credit_amount: number`).
  - `InvoiceDetailResponse`: returns invoice header, provisional flag (`is_provisional: boolean` for DRAFT status), linked billing policy, room lines with room-type details and billable nights, itemized signed invoice lines, and structured financial summary.
  - `PaymentHistoryResponse`: itemizes payments and refunds with status, method, reference, and timestamps, alongside total payments, total refunds, net payments, and credit status.
- Extended `backend/src/services/invoiceService.ts`:
  - `verifyBookingAccess(db, bookingId, actor)`: resolves booking guest ID and branch ID (via assigned room or booking creator officer) and authorizes:
    1. Online guests: permitted if `actor.guestId === booking.guest_id`. Cross-guest access rejected (403 Forbidden).
    2. Staff officers: permitted if `actor.branchId === booking.branch_id` or if actor holds chain-wide role (`CHAIN_MANAGER`, `SYSTEM_ADMINISTRATOR`, `AUDITOR`). Cross-branch staff rejected (403 Forbidden).
    3. Unauthenticated/unrecognized actors rejected (401 Unauthorized / 403 Forbidden).
  - `getBookingInvoiceDetail(db, bookingId)`: fetches draft/final invoice, room lines, signed lines, and calculates financial summary with provisional and credit flags.
  - `getBookingPaymentHistory(db, bookingId)`: aggregates payment and refund transactions, computing net payments and distinct credit labeling.
- Implemented controllers and routes:
  - `backend/src/controllers/invoiceController.ts`: `getBookingInvoiceHandler`, `getBookingPaymentsHandler`, `getInvoiceByIdHandler`, resolving actor context from request headers/auth.
  - `backend/src/routes/invoiceRoutes.ts`: mounted endpoints `GET /bookings/:bookingId/invoice`, `GET /bookings/:bookingId/payments`, `GET /invoices/:invoiceId` with pluggable middleware support.
  - Mounted router in `backend/src/index.ts` under `/api`.
- Added automated test suite `backend/tests/m4InvoiceApi.test.cjs` and registered `"test:m4-api"` in `backend/package.json`:
  1. Unauthenticated request rejection (401 Unauthorized).
  2. Online guest reading own booking invoice (200 OK, `is_provisional: true` for DRAFT, signed lines match total).
  3. Online guest cross-booking read rejection (403 Forbidden).
  4. Own-branch staff reading booking invoice (200 OK).
  5. Cross-branch staff read rejection (403 Forbidden).
  6. Chain-wide staff cross-branch reading booking invoice (200 OK).
  7. Payment and refund history retrieval with distinct credit labeling (200 OK).
  8. Direct invoice lookup by `invoice_id` with access verification (200 OK, 403 Forbidden for cross-branch, 404 for non-existent).
- Verification:
  - `npm run test:m4-api --workspace backend` passed (1 test with 8 subtests).
  - Regression suites passed: `test:m4-payment`, `test:m4-billing`, `test:m4-invoice`, `test:migrations`.
  - Full 14-migration ordered chain apply verified against an isolated temporary PostgreSQL schema.
  - `npm run build:backend` and `npm run build:frontend` compiled with 0 errors.
- Lecture concepts applied:
  - B-tree indexing on foreign key join targets and multi-attribute filter predicates (`idx_invoice_line_invoice_id`, `idx_payment_booking_kind_status`) for query optimization (`05_Storage_Indexing_Query_Processing_Transactions.md`).
  - Efficient multi-table relational join processing with parameterized SQL avoiding SQL injection (`01_Introduction_to_SQL.md`, `02_Intermediate_SQL.md`).
  - Least privilege access control and ownership-based authorization enforcing branch and guest tenancy boundaries (`03_Advanced_SQL.md`, `05_Storage_Indexing_Query_Processing_Transactions.md`).

### 03 October 2026 — M4-S07 (Locked Payment and Refund Posting Engine)
- Created PostgreSQL migration `backend/migrations/m4_006_payment_posting.sql`:
  - `fn_outstanding_balance(p_booking_id)`: returns signed invoice-line total minus net payments (`successful_payments - successful_refunds`), supporting both `uuid` and `text` signatures per SRS Table 45.
  - `fn_record_payment`: acquires row-level locks in deterministic hierarchy (`booking` followed by `invoice`) to eliminate deadlocks and race conditions, re-evaluates authoritative balance under lock, enforces that PAYMENTs cannot exceed positive balance, and REFUNDs cannot exceed existing credit (`v_current_balance < 0`). Rejects payments/refunds against FINAL invoices, logs audit records, and returns itemized payment record with previous/new balance and explicit credit flags.
  - `sp_record_payment`: implements stored procedure per SRS Table 45 with INOUT `p_payment_id`.
  - `fn_reverse_payment`: performs locked transition of a SUCCESSFUL payment to REVERSED, preventing reversal on FINAL invoices and re-opening the balance.
- Implemented TypeScript models and service:
  - Extended `backend/src/models/payment.ts` with `PostPaymentParams`, `PaymentPostingResult`, and `ReversePaymentResult`.
  - Added `backend/src/services/paymentService.ts` exposing `recordPayment`, `reversePayment`, and `getOutstandingBalance`.
- Added automated integration test suite `backend/tests/m4PaymentPosting.test.cjs` and registered `"test:m4-posting"` in `backend/package.json`:
  1. Three partial payments (4000.00, 5000.00, 3000.00) reconciling to exact 0.00 balance; subsequent payment rejected.
  2. Overpayment rejection (attempting payment above positive balance throws `check_violation`).
  3. Charge reduction creating credit (-3000.00 PRICE_ADJUSTMENT), payment rejection on credit, refund exceeding credit rejected, followed by partial (1000.00) and remaining (2000.00) manual staff refunds reconciling to exact zero.
  4. Refund rejection on positive balance (no credit to refund).
  5. Failed payment records stored with `FAILED` status without altering net balance.
  6. Payment reversal (`fn_reverse_payment`) excluding payment from net paid and accurately re-opening the outstanding balance.
  7. Duplicate reference rejection (exact and trimmed whitespace).
  8. Stored procedure `sp_record_payment` execution and INOUT payment ID retrieval.
  9. Posting prohibition on FINAL invoices (`object_not_in_prerequisite_state`).
  10. Two-session concurrent payment posting (two simultaneous 4000.00 payments on 6000.00 balance) showing that pessimistic locking serializes the balance recheck and exactly one transaction succeeds while the other is rejected for overpayment.
- Verification:
  - `npm run test:m4-posting --workspace backend` passed (1 test with 10 subtests).
  - Migration suite `test:migrations` passed (15 migrations applied cleanly in isolated schema).
  - Regression suites passed: `test:m4-payment`, `test:m4-billing`, `test:m4-invoice`, `test:m4-api`.
  - `npm run build:backend` and `npm run build:frontend` compiled with 0 errors.
  - `git diff --check` passed with 0 errors.
- Lecture concepts applied:
  - Pessimistic concurrency control and row-level locking (`SELECT ... FOR UPDATE`) to prevent lost updates, race conditions, and overpayments on financial balances (`05_Storage_Indexing_Query_Processing_Transactions.md`).
  - Strict lock acquisition ordering (`booking` then `invoice`) across transactions to guarantee deadlock-free execution (`05_Storage_Indexing_Query_Processing_Transactions.md`).
  - Transaction atomicity, consistency, and state-machine transitions in PL/pgSQL procedures and functions (`03_Advanced_SQL.md`, `05_Storage_Indexing_Query_Processing_Transactions.md`).
  - Domain constraints and exact fixed-point `numeric(14,2)` arithmetic for monetary balance reconciliation (`01_Introduction_to_SQL.md`, `02_Intermediate_SQL.md`).

### 03 October 2026 — M4-S08 (Payment and Refund REST API with Validation, Authorization, and Safe Error Mapping)
- Exposed payment, refund, and payment reversal REST endpoints under `/api`:
  - `POST /api/bookings/:bookingId/payments`: records a payment or refund against a booking with staff authorization, positive balance validation, and safe error mapping.
  - `POST /api/bookings/:bookingId/refunds`: convenience endpoint for staff-approved manual refunds against credit balances.
  - `POST /api/payments/:paymentId/reverse`: reverses a previously successful payment and reopens the outstanding balance.
- Implemented staff authorization and guest isolation in `backend/src/services/paymentService.ts`:
  - `verifyStaffPaymentAccess`: verifies the actor is a staff officer (`user_account` + `officer`). Strictly denies online guests (`guest_account`) with 403 Forbidden (`Access denied: online guests are not authorized to record staff payments or refunds`), enforcing SRS §4.7.2 FR-057 that all payments and refunds are manual staff recordings with no automated payment gateway.
  - Restricts staff to their own branch bookings (`officer.branch_id === room.branch_id`), allowing cross-branch recording only for chain-wide roles (`CHAIN_MANAGER`, `SYSTEM_ADMINISTRATOR`, `AUDITOR`).
  - Added `PaymentReceipt` interface and `generatePaymentReference(kind)` producing stable, sequential, formatted references (`PAY-YYYYMMDD-XXXXXX` / `REF-YYYYMMDD-XXXXXX`).
- Implemented controllers and error mapping in `backend/src/controllers/paymentController.ts`:
  - Strict validation: requires positive finite amount with maximum 2 decimal places (`INVALID_AMOUNT`, `INVALID_AMOUNT_PRECISION`), valid payment method (`CASH` | `BANK_TRANSFER`), valid payment kind (`PAYMENT` | `REFUND`), and valid status (`SUCCESSFUL` | `FAILED`).
  - PostgreSQL error code mapping: maps check violations `23514` to 400 Bad Request with specific error codes (`OVERPAYMENT_NOT_ALLOWED`, `NO_OUTSTANDING_BALANCE`, `OVER_REFUND_NOT_ALLOWED`, `NO_CREDIT_TO_REFUND`), unique constraint violations `23505` to 409 Conflict (`DUPLICATE_REFERENCE`), and invalid state `55000` to 409 Conflict (`INVOICE_FINAL`) without exposing internal database stack traces.
  - Returns comprehensive receipt payload with `is_settled` boolean flag and previous/new balances.
- Implemented routes in `backend/src/routes/paymentRoutes.ts` and mounted under `/api` in `backend/src/index.ts`.
- Added automated integration test suite `backend/tests/m4PaymentApi.test.cjs` and registered `"test:m4-payment-api"` in `backend/package.json`:
  1. Unauthenticated request without actor headers rejected with 401 Unauthorized (`AUTHENTICATION_REQUIRED`).
  2. Online guest attempt to record staff payment rejected with 403 Forbidden.
  3. Cross-branch staff attempt rejected with 403 Forbidden.
  4. Input validation: missing, zero, negative, excess precision (>2 decimals), invalid method (`CREDIT_CARD`), invalid kind (`CHARGE`), and invalid status (`REVERSED`) fail with 400 Bad Request.
  5. Own-branch staff records valid partial payment (15,000.00 LKR) with auto-generated reference (201 Created).
  6. Chain manager records partial payment (10,000.00 LKR) with explicit reference (201 Created).
  7. Duplicate reference rejected with 409 Conflict (`DUPLICATE_REFERENCE`).
  8. Overpayment above outstanding balance rejected with 400 Bad Request (`OVERPAYMENT_NOT_ALLOWED`).
  9. Exact payment (15,425.00 LKR) settles balance to 0.00 (`receipt.is_settled: true`).
  10. Payment on settled zero balance fails with 400 Bad Request (`NO_OUTSTANDING_BALANCE`).
  11. Refund on zero balance fails with 400 Bad Request (`NO_CREDIT_TO_REFUND`).
  12. Over-refund rejected (400 `OVER_REFUND_NOT_ALLOWED`), partial refund (3,000.00) against -6,900.00 credit succeeds, and final refund (3,900.00) settles credit to 0.00 with `REF-` references.
  13. Payment reversal reopens outstanding balance (200 OK) with reversal receipt.
  14. Payment reversal restrictions: already reversed (400 `INVALID_PAYMENT_STATE`), cross-branch staff (403), online guest (403).
  15. Posting payment or refund against a FINAL invoice fails with 409 Conflict (`INVOICE_FINAL`).
- Verification:
  - `npm run test:m4-payment-api --workspace backend` passed (1 test with 15 subtests).
  - Full regression suite passed: `test:m4-posting`, `test:m4-api`, `test:m4-invoice`, `test:m4-billing`, `test:m4-payment`, `test:migrations`.
  - `npm run build:backend` and `npm run build:frontend` compiled with 0 errors.
  - `git diff --check` passed with 0 errors.
- Lecture concepts applied:
  - Role-based and branch-scoped authorization enforcing principle of least privilege (`03_Advanced_SQL.md`, `05_Storage_Indexing_Query_Processing_Transactions.md`).
  - Safe error handling and database state translation preventing internal implementation leakage while providing actionable client feedback (`01_Introduction_to_SQL.md`, `03_Advanced_SQL.md`).
  - Data integrity and scale validation (`numeric(14,2)`) before and during database transactional execution (`02_Intermediate_SQL.md`).

### 03 October 2026 — M4-S09 (One-Line Checkout Transaction Engine)
- Created mock migration `backend/migrations/m3_002_room_status_history_mock.sql` satisfying external dependency Member 3 M3-S18:
  - Table `room_status_history` per SRS Table 40 (`room_history_id`, `room_id`, `old_status`, `new_status`, `changed_at`, `changed_by`, `reason`) with UUIDv7 PK, immutability trigger `trg_enforce_room_status_history_immutability`, and B-tree index `idx_room_status_history_room_id`.
  - Stored function `fn_set_room_condition(p_room_id, p_new_condition, p_changed_by, p_reason)` updating room operational status and appending history only on actual condition changes, with guard rejecting `OUT_OF_SERVICE` transitions when active `BOOKED` or `CHECKED_IN` lines exist (DBR-037).
- Created PostgreSQL migration `backend/migrations/m4_007_checkout_transaction.sql`:
  - `fn_checkout_room_line(p_booking_id, p_line_id, p_actor_id, p_reason)`: implements the core one-line checkout transaction adhering to SRS §4.8, Table 24/25 (FR-059–FR-061), Table 44 (DBR-015, DBR-018), and Table 45:
    1. Locks rows in strict deterministic order: `booking` → `invoice` → `booking_room_line` → `booking_room_assignment` → `room` to guarantee deadlock-free execution.
    2. Validates line belongs to booking and is currently in `CHECKED_IN` status; throws `23514` if line is already `CHECKED_OUT`, `BOOKED`, or terminal.
    3. Blocks checkout if the booking invoice is already in `FINAL` state (`55000`).
    4. Consolidated Zero-Balance Gate: checks `fn_outstanding_balance(p_booking_id)`. If balance > 0, raises `23514` with unsettled balance amount; if balance < 0, raises `23514` with unrefunded credit amount.
    5. Ends actual occupancy segment: updates `booking_room_assignment` setting `occupied_to = v_checkout_time` and `unassigned_at = v_checkout_time`.
    6. Transitions line status to `CHECKED_OUT` with `updated_at = v_checkout_time`.
    7. Appends immutable status history row to `booking_room_line_status_history` (`CHECKED_IN` → `CHECKED_OUT`) maintaining continuous history chain.
    8. Transitions room physical condition to `CLEANING` via Member 3's internal condition operation `fn_set_room_condition`, recording `room_status_history`.
    9. Audits checkout event to `audit_log` if available.
    10. Evaluates remaining active lines (`status IN ('BOOKED', 'CHECKED_IN')`):
        - If active lines remain (`remaining_active_lines > 0`): retains invoice in `DRAFT` status and returns provisional statement reference `PROV-YYYYMMDD-XXXXXXXX`.
        - If all lines are terminal (`remaining_active_lines = 0`): executes `fn_issue_final_invoice` assigning unique number `INV-YYYYMMDD-XXXXX` and `issued_at`.
    11. Returns checkout execution record table.
  - Stored procedure `sp_checkout_booking(p_booking_id, p_line_id, p_actor_id, p_reason)` implementing Table 45 procedure.
- Implemented TypeScript model and service:
  - `backend/src/models/checkout.ts`: defines `CheckoutLineParams`, `CheckoutResult`, and `CheckoutReceipt`.
  - `backend/src/services/checkoutService.ts`: exposes `checkoutRoomLine(db, params)` returning structured checkout receipt with room condition and invoice/provisional details.
- Added automated integration test suite `backend/tests/m4CheckoutTransaction.test.cjs` and registered `"test:m4-checkout"` in `backend/package.json`:
  1. Scenario 1: Positive balance due blocks checkout (`23514` with outstanding balance message).
  2. Scenario 2: Negative unrefunded credit blocks checkout (`23514`), and checkout succeeds once refunded.
  3. Scenario 3 & 4: Multi-room booking: partial checkout of Line A leaves invoice in `DRAFT` with provisional statement reference; subsequent checkout of Line B finalizes invoice with sequential number (`INV-`).
  4. Scenario 5: Injected transaction failure rolls back all checkout changes (line remains `CHECKED_IN`, room remains `READY`, assignment remains open).
  5. Scenario 6: Repeated checkout on already `CHECKED_OUT` line fails (`23514`).
  6. Scenario 7: Checkout on `BOOKED` line fails (`23514`).
  7. Scenario 8: Cross-booking line mismatch fails (`23514`).
  8. Scenario 9: Stored procedure `sp_checkout_booking` executes cleanly.
  9. Scenario 10: TypeScript `checkoutRoomLine` service returns formatted receipt.
- Verification:
  - `npm run test:m4-checkout --workspace backend` passed (1 test with 10 subtests, 100% pass rate).
  - Migration runner test `test:migrations` passed (all 20 migrations apply cleanly in isolated schema).
  - Full regression suite passed: `test:m4-payment-api`, `test:m4-posting`, `test:m4-api`, `test:m4-invoice`, `test:m4-billing`, `test:m4-payment`.
  - TypeScript builds compiled with 0 errors (`npm run build --workspace backend`, `npm run build --workspace frontend`).
  - `git diff --check` passed with 0 errors.
- Lecture concepts applied:
  - Pessimistic locking hierarchy (`booking` → `invoice` → `line` → `assignment` → `room`) preventing deadlocks and race conditions during multi-entity updates (`05_Storage_Indexing_Query_Processing_Transactions.md`).
  - Transaction atomicity & rollback guaranteeing consistent database state during failures (`05_Storage_Indexing_Query_Processing_Transactions.md`).
  - Integrity constraints and domain state-machine enforcement (`CHECKED_IN` → `CHECKED_OUT`, `READY` → `CLEANING`) across deferred triggers (`02_Intermediate_SQL.md`, `03_Advanced_SQL.md`).
  - Exact financial balance gate preventing early departure without settlement (`01_Introduction_to_SQL.md`, `02_Intermediate_SQL.md`).

### 04 October 2026 — M4-S10 (Line-Specific Checkout REST API with Branch & Role Guards)
- Implemented line-specific checkout REST API endpoints in `backend/src/controllers/checkoutController.ts`, `backend/src/routes/checkoutRoutes.ts`, and mounted them in `backend/src/index.ts`:
  - `POST /api/bookings/:bookingId/lines/:lineId/checkout`: executes atomic one-line checkout for the target room line.
  - `POST /api/bookings/:bookingId/checkout`: supports line checkout with `lineId` / `bookingRoomLineId` provided in the request body.
  - `GET /api/bookings/:bookingId/lines/:lineId/checkout`: inspects existing checkout receipt and statement details for a checked-out line.
- Implemented robust staff authorization and branch isolation guard (`verifyStaffCheckoutAccess` in `backend/src/services/checkoutService.ts`):
  - Unauthenticated requests reject with `401 Unauthorized` (`AUTHENTICATION_REQUIRED`).
  - Online guests (`guest_account`) reject with `403 Forbidden` (`FORBIDDEN`), upholding SRS §4.8 operational staff boundary.
  - Non-checkout staff roles (`SERVICE_STAFF`, `AUDITOR`) reject with `403 Forbidden` (`FORBIDDEN`).
  - Front desk (`FRONT_DESK`) and branch managers (`BRANCH_MANAGER`) are strictly restricted to bookings in their own branch (`403 Forbidden` if cross-branch).
  - Chain-wide management roles (`CHAIN_MANAGER`, `SYSTEM_ADMINISTRATOR`) possess universal operational authority across all branches.
  - Safe identifier parsing: checks regex `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` to distinguish UUIDs from human-readable booking references (`booking_ref`), preventing PostgreSQL `22P02` invalid uuid input syntax exceptions.
- Implemented explicit repeated-request behavior:
  - Default repeated checkout on already `CHECKED_OUT` line returns `409 Conflict` (`LINE_ALREADY_CHECKED_OUT`) along with existing checkout details.
  - Idempotent repeated request (`?idempotent=true` query flag or `idempotency-key` header) returns `200 OK` with existing checkout receipt and `{ repeated: true }`.
- Comprehensive error translation preventing internal schema/exception leakage:
  - Maps database and business validation errors to clean HTTP error codes: `400` (`OUTSTANDING_BALANCE_DUE`, `UNREFUNDED_CREDIT_REMAINING`, `INVALID_LINE_STATUS`, `LINE_BOOKING_MISMATCH`, `NO_OPEN_ASSIGNMENT`, `INVALID_LINE_ID`, `MISSING_LINE_ID`), `404` (`BOOKING_NOT_FOUND`, `ROOM_LINE_NOT_FOUND`), and `409` (`LINE_ALREADY_CHECKED_OUT`, `INVOICE_ALREADY_FINAL`).
- Updated `backend/migrations/m4_004_invoice_lifecycle.sql`:
  - Added `AND NOT is_demo` to `sp_create_draft_invoice` query selecting effective billing policy, guaranteeing that demonstration policies (`is_demo=true`) are excluded from production bookings per Member 1 billing policy contract.
- Created automated integration test suite `backend/tests/m4CheckoutApi.test.cjs` and registered script `"test:m4-checkout-api"` in `backend/package.json`:
  1. Subtest 1: Unauthenticated request without actor headers fails with 401 (`AUTHENTICATION_REQUIRED`).
  2. Subtest 2: Online guest cannot perform staff checkout (403 `FORBIDDEN`).
  3. Subtest 3: Service staff cannot perform checkout (403 `FORBIDDEN`).
  4. Subtest 4: Auditor cannot perform checkout (403 `FORBIDDEN`).
  5. Subtest 5: Cross-branch Front Desk cannot checkout other branch stay (403 `FORBIDDEN`).
  6. Subtest 6: Non-existent booking ID fails with 404 (`BOOKING_NOT_FOUND`).
  7. Subtest 7: Malformed room line ID fails with 400 (`INVALID_LINE_ID`).
  8. Subtest 8: Non-existent line UUID fails with 404 (`ROOM_LINE_NOT_FOUND`).
  9. Subtest 9: Line belonging to another booking fails with 400 (`LINE_BOOKING_MISMATCH`).
  10. Subtest 10: Line in `BOOKED` status fails with 400 (`INVALID_LINE_STATUS`).
  11. Subtest 11: Positive balance due blocks checkout with 400 (`OUTSTANDING_BALANCE_DUE`).
  12. Subtest 12: Negative unrefunded credit blocks checkout with 400 (`UNREFUNDED_CREDIT_REMAINING`).
  13. Subtest 13: Partial checkout of Line A succeeds, keeps invoice `DRAFT` with provisional ref (`PROV-`).
  14. Subtest 14: Final checkout of Line B finalizes invoice and assigns sequential invoice number (`INV-`).
  15. Subtest 15: Repeated checkout on already `CHECKED_OUT` line fails with 409 Conflict (`LINE_ALREADY_CHECKED_OUT`).
  16. Subtest 16: Idempotent repeat request (`?idempotent=true`) returns 200 OK with existing receipt and `repeated: true`.
  17. Subtest 17: Booking reference in URL resolves cleanly and executes checkout.
  18. Subtest 18: `GET /bookings/:bookingId/lines/:lineId/checkout` reads existing checkout receipt.
- Verification:
  - `npm run test:m4-checkout-api --workspace backend` passed (18/18 subtests, 100% pass rate).
  - All regression test suites passed cleanly:
    - `npm run test:m4-checkout --workspace backend` (10/10 scenarios passed)
    - `npm run test:m4-payment-api --workspace backend` (15/15 subtests passed)
    - `npm run test:m4-posting --workspace backend` (10/10 scenarios passed)
    - `npm run test:m4-api --workspace backend` (8/8 scenarios passed)
    - `npm run test:m4-invoice --workspace backend` (11/11 scenarios passed)
    - `npm run test:m4-billing --workspace backend` (1/1 passed)
    - `npm run test:m4-payment --workspace backend` (1/1 passed)
    - `npm run test:migrations --workspace backend` (3/3 passed)
  - TypeScript builds compiled with 0 errors:
    - `npm run build --workspace backend`
    - `npm run build --workspace frontend`
  - `git diff --check` passed with 0 errors.
### 04 October 2026 — M4-S11 (Per-Line & Whole-Booking Cancellation Engine and REST API)
- Implemented PostgreSQL migration `backend/migrations/m4_008_cancellation_transaction.sql`:
  - `fn_cancel_room_line(p_booking_id, p_line_id, p_actor_id, p_reason, p_cancel_time)`:
    - Row-level pessimistic locking in hierarchy (`booking` → `invoice` → `booking_room_line` → `booking_room_assignment`).
    - Validates invoice is in `DRAFT` status (rejects `FINAL` with `object_not_in_prerequisite_state`).
    - Enforces line status is `BOOKED` (rejects `CHECKED_IN`, `CHECKED_OUT`, `NO_SHOW`, and already `CANCELLED` lines).
    - Enforces linked billing policy's no-show cutoff deadline: `(l.stay_start_date + bp.no_show_grace_days) 00:00:00 Asia/Colombo`. Rejects any cancellation attempt at or after cutoff with `23514` (`CANCELLATION_DEADLINE_PASSED`).
    - Closes open assignment (`unassigned_at = cancel_time`) releasing physical room inventory without deleting assignment history.
    - Transitions line status to `CANCELLED` and appends immutable status event to `booking_room_line_status_history` (`BOOKED` → `CANCELLED`).
    - Audits event to `audit_log`.
    - Automatically refreshes `DRAFT` invoice lines via `fn_refresh_draft_invoice_lines`: removes provisional room-night charges and adds the policy version's flat `CANCELLATION_FEE`, ensuring later policy updates do not affect existing cancellation charges (later-policy fee stability).
    - Re-evaluates outstanding balance: when prepayments exceed the cancellation fee, identifies credit balance (`is_credit = true`, `credit_amount > 0`) for staff refund processing.
    - Returns execution receipt table.
  - `fn_cancel_whole_booking(p_booking_id, p_actor_id, p_reason, p_cancel_time)`:
    - Atomically verifies eligibility of all booking room lines in deterministic UUID order: requires every line to be in `BOOKED` status and before cutoff. If any line is ineligible (e.g. `CHECKED_IN`), raises `23514` and rolls back all changes atomically (whole-booking rollback guarantee).
    - Upon verification, atomically cancels all `BOOKED` lines, closes open assignments, appends history rows, refreshes the draft invoice once, and returns batch cancellation receipt.
  - Procedures `sp_cancel_room_line` and `sp_cancel_booking`: Table 45 compatibility wrappers.
- Implemented TypeScript models, service, controller, and routes:
  - `backend/src/models/cancellation.ts`: defined `CancelLineParams`, `CancelLineReceipt`, `CancelWholeBookingParams`, `CancelWholeBookingReceipt`, and `CancellationQuote`.
  - `backend/src/services/cancellationService.ts`:
    - `verifyCancellationAccess`: enforces strict access boundaries: 401 for unauthenticated; 403 for guest mismatch (`guest_account.guest_id === booking.guest_id` required per FR-084); 403 for `SERVICE_STAFF` and `AUDITOR`; 403 for cross-branch front desk / branch managers; universal chain-wide access for `CHAIN_MANAGER` and `SYSTEM_ADMINISTRATOR`. Supports both UUID and human-readable `booking_ref`.
    - `cancelRoomLine`, `cancelWholeBooking`, and `getCancellationQuote`.
  - `backend/src/controllers/cancellationController.ts`:
    - Handles line and whole booking cancellation and cancellation quotes.
    - Implemented explicit repeated-request behavior: default repeated cancellation on already `CANCELLED` line returns 409 Conflict (`LINE_ALREADY_CANCELLED`); idempotent repeat requests (`?idempotent=true` query param or `idempotency-key` header) return 200 OK with `repeated: true`.
    - Maps database exceptions to HTTP error codes: `400` (`CANCELLATION_DEADLINE_PASSED`, `CANNOT_CANCEL_CHECKED_IN`, `INVALID_LINE_STATUS`, `NOT_ALL_LINES_ELIGIBLE`, `NO_ACTIVE_BOOKED_LINES`, `LINE_BOOKING_MISMATCH`, `INVALID_LINE_ID`), `404` (`BOOKING_NOT_FOUND`, `ROOM_LINE_NOT_FOUND`), and `409` (`LINE_ALREADY_CANCELLED`, `INVOICE_ALREADY_FINAL`).
  - `backend/src/routes/cancellationRoutes.ts`: mounted routes `POST /bookings/:bookingId/lines/:lineId/cancel`, `POST /bookings/:bookingId/cancel`, `POST /bookings/:bookingId/cancel-all`, `GET /bookings/:bookingId/lines/:lineId/cancellation-quote`, `GET /bookings/:bookingId/cancellation-quote`. Mounted in `backend/src/index.ts` under `/api`.
- Added automated integration test suite `backend/tests/m4Cancellation.test.cjs` (registered `"test:m4-cancellation"` in `backend/package.json`):
  1. Unauthenticated request fails with 401 Unauthorized (`AUTHENTICATION_REQUIRED`).
  2. Online guest cannot cancel another guest reservation (403 `FORBIDDEN`).
  3. Online guest can cancel their own BOOKED line (200 OK).
  4. Service staff and auditors cannot cancel reservations (403 `FORBIDDEN`).
  5. Cross-branch staff cannot cancel other branch reservation (403 `FORBIDDEN`).
  6. Partial cancellation: cancel Line A, Line B remains `BOOKED` and active with open assignment; invoice lines updated.
  7. Cutoff boundaries: before cutoff succeeds; at or after cutoff fails (400 `CANCELLATION_DEADLINE_PASSED`).
  8. Checked-in room line cannot be cancelled (400 `CANNOT_CANCEL_CHECKED_IN`).
  9. Later-policy fee stability: new policy publication does not change existing booking cancellation fee.
  10. Prior-payment credit: cancellation removes room nights, creates credit balance, verified with staff manual refund settling to 0.00.
  11. Whole-booking cancellation atomically cancels all eligible lines.
  12. Whole-booking rollback: fails and rolls back completely when one room is `CHECKED_IN` (400 `NOT_ALL_LINES_ELIGIBLE`).
  13. Repeated cancellation: default 409 Conflict; `?idempotent=true` returns 200 OK with `repeated: true`.
  14. Cancellation quote inspection returns fee and eligibility.
  15. Stored procedures `sp_cancel_room_line` and `sp_cancel_booking` execute cleanly.
- Verification:
  - `npm run test:m4-cancellation --workspace backend` passed (15/15 subtests, 100% pass rate).
  - All regression test suites passed cleanly:
    - `npm run test:m4-checkout-api --workspace backend` (18/18 subtests passed)
    - `npm run test:m4-checkout --workspace backend` (10/10 scenarios passed)
    - `npm run test:m4-payment-api --workspace backend` (15/15 subtests passed)
    - `npm run test:m4-posting --workspace backend` (10/10 scenarios passed)
    - `npm run test:m4-api --workspace backend` (8/8 scenarios passed)
    - `npm run test:m4-invoice --workspace backend` (11/11 scenarios passed)
    - `npm run test:m4-billing --workspace backend` (1/1 passed)
    - `npm run test:m4-payment --workspace backend` (1/1 passed)
    - `npm run test:migrations --workspace backend` (3/3 passed)
  - TypeScript builds compiled with 0 errors:
    - `npm run build --workspace backend`
    - `npm run build --workspace frontend`
  - `git diff --check` passed with 0 errors.
- Lecture concepts applied:
  - Multi-entity pessimistic locking order (`booking` → `invoice` → `line` → `assignment`) avoiding deadlocks (`05_Storage_Indexing_Query_Processing_Transactions.md`).
  - Transaction atomicity & all-or-nothing rollback semantics in whole-booking cancellation (`05_Storage_Indexing_Query_Processing_Transactions.md`).
  - Temporal boundary constraints and timezone-aware cutoff evaluation in SQL (`02_Intermediate_SQL.md`, `03_Advanced_SQL.md`).
  - Authorization and tenant isolation preserving online guest self-service ownership vs. internal staff boundaries (`03_Advanced_SQL.md`).

### 05 October 2026 — M4-S12 (Per-Line No-Show Transition with Cutoff, History, and Linked Policy Fee)
- Created PostgreSQL migration `backend/migrations/m4_009_no_show_transaction.sql`:
  - `fn_mark_no_show_room_line(p_booking_id, p_line_id, p_actor_id, p_reason, p_mark_time)`:
    - Pessimistic locking hierarchy: acquires `FOR UPDATE` row locks in consistent order (`booking` → `invoice` → `booking_room_line` → `booking_room_assignment`) to guarantee deadlock freedom and strict serializability.
    - Validates prerequisite state: invoice must not be `FINAL` (`55000`); line must exist and belong to booking; line status must be `BOOKED` (`CANNOT_NO_SHOW_CHECKED_IN`, `CANNOT_NO_SHOW_CANCELLED`, `CANNOT_NO_SHOW_CHECKED_OUT`, `LINE_ALREADY_NO_SHOW`).
    - Enforces temporal cutoff boundary: evaluates cutoff timestamp strictly at local `00:00:00 Asia/Colombo` on current `stay_start_date + invoice-linked no_show_grace_days` (`((v_line.stay_start_date + v_grace_days)::text || ' 00:00:00+05:30')::timestamptz`). Any attempt to declare a no-show before this cutoff deadline fails with `23514` (`EARLY_NO_SHOW_NOT_ALLOWED`).
    - Closes open assignment (`unassigned_at = v_effective_mark_time`) without deleting assignment history, thereby releasing room physical inventory. Per M2-S01 reservation contract and FR-063, physical room condition is NOT modified (room remains `READY` because the guest never occupied or checked into the room; no cleaning cycle is triggered).
    - Transitions room line status to `NO_SHOW` and records an immutable entry in `booking_room_line_status_history` (`BOOKED` → `NO_SHOW`) with actor ID, timestamp, and audit trail record in `audit_log`.
    - Refreshes draft invoice via `fn_refresh_draft_invoice_lines`: eliminates provisional room-night charges for the no-show line and applies the linked policy version's flat `NO_SHOW_FEE` line. Prepayments exceeding the fee surface as an unrefunded credit (`is_credit = true`) for manual staff refund.
    - Returns execution receipt record.
  - `fn_mark_no_show_booking(p_booking_id, p_actor_id, p_reason, p_mark_time)`:
    - Atomically transitions all eligible `BOOKED` lines past cutoff in a booking to `NO_SHOW`, closes their assignments, writes line status histories, logs audits, refreshes the draft invoice once, and returns batch receipt.
  - Stored procedures `sp_no_show_room_line` and `sp_no_show_booking`: Table 45 compatibility wrappers with optional `p_mark_time` (default `CURRENT_TIMESTAMP`).
- Implemented TypeScript models, service, controller, and routes:
  - `backend/src/models/noShow.ts`: defined `MarkNoShowParams`, `MarkNoShowResult`, `NoShowReceipt`, `MarkNoShowBookingParams`, `MarkNoShowBookingResult`, `MarkNoShowBookingReceipt`, and `NoShowQuote`.
  - `backend/src/services/noShowService.ts`:
    - `verifyStaffNoShowAccess`: strictly enforces staff-only authority per FR-064 (online guests using `guest_account` cannot declare reservations as no-show, returning 403 Forbidden); 401 for unauthenticated; 403 for `SERVICE_STAFF` and `AUDITOR`; 403 for cross-branch front desk / branch managers; universal chain-wide access for `CHAIN_MANAGER` and `SYSTEM_ADMINISTRATOR`. Resolves either UUID or human-readable `booking_ref`.
    - `markRoomLineNoShow`, `markBookingNoShow`, and `getNoShowQuote`.
  - `backend/src/controllers/noShowController.ts`:
    - Implemented `postMarkLineNoShowHandler`, `postMarkBookingNoShowHandler`, and `getNoShowQuoteHandler`.
    - Implemented explicit repeated-request behavior: default repeated no-show on an already `NO_SHOW` line returns `409 Conflict` (`LINE_ALREADY_NO_SHOW`); idempotent retry requests (`?idempotent=true` query param or `idempotency-key` header) return `200 OK` with existing receipt.
    - Safe error mapping for `EARLY_NO_SHOW_NOT_ALLOWED` (400), `CANNOT_NO_SHOW_CHECKED_IN` (400), `CANNOT_NO_SHOW_CANCELLED` (400), `CANNOT_NO_SHOW_CHECKED_OUT` (400), `NOT_ALL_LINES_ELIGIBLE` (400), `NO_ACTIVE_BOOKED_LINES` (400), `BOOKING_NOT_FOUND` (404), `ROOM_LINE_NOT_FOUND` (404), `LINE_ALREADY_NO_SHOW` (409), `INVOICE_ALREADY_FINAL` (409).
  - `backend/src/routes/noShowRoutes.ts`: mounted routes `POST /bookings/:bookingId/lines/:lineId/no-show`, `POST /bookings/:bookingId/no-show`, `GET /bookings/:bookingId/lines/:lineId/no-show-quote`, `GET /bookings/:bookingId/no-show-quote`. Mounted in `backend/src/index.ts` under `/api`.
  - Added explicit type casts in `backend/src/services/paymentService.ts` for `fn_record_payment` query parameters to prevent ambiguous function resolution when multiple schemas define `payment_kind_enum`.
  - Added `IF NOT EXISTS` to indexes in `backend/migrations/m2_005_reservation_integrity_guards.sql` for idempotency across isolated test schemas.
- Added automated integration test suite `backend/tests/m4NoShow.test.cjs` (registered `"test:m4-no-show"` in `backend/package.json`):
  1. Unauthenticated request fails with 401 Unauthorized (`AUTHENTICATION_REQUIRED`).
  2. Online guest cannot mark no-show (403 `FORBIDDEN` per FR-064).
  3. Service staff and auditors cannot mark reservations as no-show (403 `FORBIDDEN`).
  4. Cross-branch staff cannot mark other branch reservation as no-show (403 `FORBIDDEN`).
  5. Early no-show before cutoff deadline fails with 400 (`EARLY_NO_SHOW_NOT_ALLOWED`).
  6. Exactly at cutoff deadline (00:00:00 Asia/Colombo), no-show succeeds (200 OK).
  7. After cutoff deadline, no-show transition succeeds (200 OK).
  8. Partial no-show: Line A marked `NO_SHOW`, Line B remains `BOOKED` and active with open assignment; invoice updated.
  9. Pre-check-in date revision moves derived cutoff deadline.
  10. Demo billing policy boundary: `is_demo = true`, `grace_days = 1`, and zero fee (`no_show_fee = 0.00`).
  11. Later-policy changes do not alter existing booking no-show fee or grace days (later-policy stability).
  12. Prior-payment credit: no-show removes room nights, creates credit for staff refund, verified with manual staff refund settling balance to 0.00.
  13. Checked-in room line cannot be marked as NO_SHOW (400 `CANNOT_NO_SHOW_CHECKED_IN`).
  14. Cancelled room line cannot be marked as NO_SHOW (400 `CANNOT_NO_SHOW_CANCELLED`).
  15. Repeated NO_SHOW: default 409 Conflict; `?idempotent=true` returns 200 OK with existing receipt.
  16. No-show quote inspection returns eligibility and cutoff deadline.
  17. Stored procedures `sp_no_show_room_line` and `sp_no_show_booking` execute cleanly.
- Verification:
  - `npm run test:m4-no-show --workspace backend` passed (17/17 subtests, 18/18 tests passed, 100% pass rate).
  - All regression test suites passed cleanly:
    - `npm run test:migrations --workspace backend` (3/3 passed)
    - `npm run test:m4-cancellation --workspace backend` (16/16 tests passed)
    - `npm run test:m4-checkout-api --workspace backend` (19/19 tests passed)
    - `npm run test:m4-checkout --workspace backend` (10/10 tests passed)
    - `npm run test:m4-payment-api --workspace backend` (16/16 tests passed)
    - `npm run test:m4-api --workspace backend` (9/9 tests passed)
    - `npm run test:m4-invoice --workspace backend` (12/12 tests passed)
    - `npm run test:m4-billing --workspace backend` (1/1 passed)
    - `npm run test:m4-payment --workspace backend` (1/1 passed)
  - TypeScript builds compiled with 0 errors:
    - `npm run build --workspace backend`
    - `npm run build --workspace frontend`
  - `git diff --check` passed with 0 errors.
- Lecture concepts applied:
  - Multi-entity pessimistic locking hierarchy (`booking` → `invoice` → `line` → `assignment`) avoiding deadlocks and race conditions (`05_Storage_Indexing_Query_Processing_Transactions.md`).
  - Temporal boundary constraints and timezone-aware midnight cutoff calculation in SQL (`02_Intermediate_SQL.md`, `03_Advanced_SQL.md`).
  - Strict role-based access control and principle of least privilege preventing unauthorized guest and staff transitions (`03_Advanced_SQL.md`).
  - Exact fixed-point numeric arithmetic (`numeric(14,2)`) and balance reconciliation under concurrency (`01_Introduction_to_SQL.md`, `05_Storage_Indexing_Query_Processing_Transactions.md`).

### 2026-10-06 — M4-S13: Invoice detail UI with room segregation, adjustment ordering, provisional/final states, and consolidated totals

- Scope:
  - Build invoice-detail UI using shadcn primitives and DM Sans typography per `DESIGN.md` and `LAYOUT.md`, showing separately priced room lines, adjustment order, DRAFT/provisional versus FINAL/issued state, booking-wide charges, and exact consolidated totals.
- Changes:
  - Created `frontend/src/lib/invoiceViewModel.ts` providing typed shapes (`InvoiceStatus`, `InvoiceLineType`, `InvoiceLineView`, `InvoiceDetailView`), line ordering per SRS §4.7.4 hierarchy (ROOM_NIGHT → SERVICE → DISCOUNT → SERVICE_CHARGE → TAX → CANCELLATION_FEE → NO_SHOW_FEE → LATE_CHECKOUT_FEE → ADJUSTMENT), per-room segregation with room subtotal calculation, booking-wide line grouping, exact commercial rounding (`formatLkr`/`toMoneyString`), API fetch abstraction, and role-scope error mapping (401 unauthenticated, 403 cross-branch / unauthorized guest, 404 missing invoice).
  - Created `frontend/src/components/billing/InvoiceDetailPanel.tsx` leveraging shadcn primitives (`Card`, `CardHeader`, `CardTitle`, `CardContent`, `Badge`) and lucide-react icons (`FileText`, `CheckCircle`, `BedDouble`, `ReceiptText`, `CreditCard`, `AlertTriangle`, `PlusCircle`, `MinusCircle`) following the Mono palette design tokens:
    - `InvoiceStatusBadge`: renders `PROVISIONAL` badge for DRAFT invoices and `INV-YYYYMMDD-XXXXX` for FINAL invoices.
    - `RoomLinesSection`: renders individual room cards with per-room line breakdowns and subtotal rows.
    - `BookingWideLinesSection`: displays discounts, fees, and taxes not attached to a single room.
    - `InvoiceSummaryCard`: shows consolidated totals including invoice total, net payments, and explicit unrefunded credit (`isCredit: true` with destructive styling) or settled / outstanding balance.
  - Created `frontend/src/routes/InvoiceDetailPage.tsx` within `AppShell`, `PageContainer`, and `BoundedContainer` providing booking UUID lookup with Enter key support, responsive layout, loading states, error presentation, and contextual note on backend branch tenancy enforcement.
  - Registered `/billing/invoice` route in `frontend/src/router.ts`.
  - Added unit test suite `frontend/tests/m4InvoiceUi.test.ts` covering two-room segregation with partial checkout subtotals, SRS §4.7.4 line ordering, DRAFT provisional vs FINAL issued state transitions, credit presentation with deduction styling, and role-scope error mapping.
  - Added script `"test:m4-invoice-ui"` to `frontend/package.json`.
- Verification:
  - Unit tests passed cleanly:
    - `npm.cmd run test:m4-invoice-ui --workspace=frontend` (5/5 tests passed)
    - `npm.cmd run test:m3-check-in-ui --workspace=frontend` (6/6 tests passed)
  - TypeScript and Vite production builds compiled with 0 errors:
    - `npm.cmd run build --workspace=frontend` (`tsc && vite build`: 1977 modules transformed, built in 2.94s)
    - `npm.cmd run build --workspace=backend` (`tsc`: 0 errors)
  - `git diff --check` passed with 0 errors.
- Hand-off notes:
  - Downstream tasks: M4-S14 (payment UI) can consume `InvoiceDetailPanel` or share `invoiceViewModel.ts` balance formatting helpers.

### M4-S14: Build payment UI

**Date:** 2026-10-06
**Status:** ✅ Completed

**Implementation Details:**
- **ViewModel (`paymentViewModel.ts`)**: Built a robust view model extending the API definitions. Included `buildPaymentHistoryView` with full balance summary logic (net payments, unrefunded credits, outstanding balance, exact LKR formatting using `money.ts`), `validatePaymentDraft`, and `applyPaymentReceipt` for optimistic UI updates.
- **PaymentPanel (`PaymentPanel.tsx`)**: Created the main UI component using Shadcn primitives (Cards, Badges, Buttons). Split into three functional blocks: `BalanceSummaryCard` (showing exact totals and credit states), `PaymentEntryForm` (with toggles for Payment/Refund modes and "Record Failed Attempt"), and `PaymentHistoryPanel` (showing a ledger of payments with per-row reversal controls).
- **PaymentPage (`PaymentPage.tsx`)**: Integrated the payment panel with a booking lookup field. Mapped the page to the TanStack router at `/billing/payments`.
- **Testing**: Added `m4PaymentUi.test.ts` covering row transformations, exact precision arithmetic for balances, credit states, optimistic update application, and form validation. 9/9 tests pass.
- **Build Checks**: Rebuilt the frontend successfully with no TypeScript errors. Full stack build passes.

**Acceptance Verification:**
- Partial-payment entry: ✅ Implemented with validation guarding against overpayments.
- Signed balance/credit display: ✅ Displayed natively in the `BalanceSummaryCard`.
- Staff-only manual refund/failure states: ✅ Implemented Refund mode and FAILED state toggle for attempts.
- Exact displayed totals: ✅ Frontend uses `money.ts` to strictly handle `numeric(12,2)` amounts without floating-point drift.
- Frontend build passes: ✅ Tested via `npm run build:frontend`.

**Git Handoff Text:**
```text
feat(billing): M4-S14 implement staff payment UI with balance summary

Builds the PaymentPage route for staff to view and modify booking payment ledgers. 
Includes:
- Exact LKR exact precision balance summary formatting
- Payment/Refund entry forms with validation against credit/outstanding limits
- Failed attempt recording and successful payment reversals
- Optimistic updates for seamless frontend UX without full history refetches

Related: M4-S08, M4-S13
```

### M4-S15: Build staff per-line checkout UI

**Date:** 2026-10-06
**Status:** ✅ Completed

**Implementation Details:**
- **ViewModel (`checkoutViewModel.ts`)**: Created the checkout view model wrapping the `POST` checkout API response. Added rigorous error code parsing to surface clear messages for balance gate failures, invalid line states, and authorization blocks.
- **CheckoutPanel (`CheckoutPanel.tsx`)**: Built the primary checkout component.
  - Implemented the exact-zero balance guard by leveraging `invoice.summary.isSettled` and `invoice.status`.
  - Disables checkout and shows clear alert blocks if the booking has an outstanding balance or unrefunded credit.
  - Renders a list of eligible (`CHECKED_IN`) room lines using the active stay data.
  - Provides a single-click "Check out room" button with loading state feedback.
- **CheckoutPage (`CheckoutPage.tsx`)**: Created the `/checkout` route. Lookups the booking by UUID, fetches both the invoice and active stay lines concurrently, merges them, and passes them to the panel. Refetches data seamlessly upon successful line checkout to trigger state re-evaluations.
- **Testing (`m4CheckoutUi.test.ts`)**: Tested error translation mapping for the view model logic.
- **Build Checks**: Rebuilt the frontend and backend successfully.

**Acceptance Verification:**
- Consolidated exact-zero balance guard: ✅ Verified. Checks `invoice.summary.isSettled` to prevent checkout.
- DRAFT provisional statement/FINAL state: ✅ UI indicates `DRAFT` or `FINAL` statement status in the UI block.
- Remaining-room, positive-balance, credit display safely: ✅ Yes, using shared view models from `activeStayViewModel` and `invoiceViewModel`.
- Frontend build passes: ✅ Tested via `npm run build:frontend`.

**Git Handoff Text:**
```text
feat(checkout): M4-S15 implement staff per-line checkout UI

Builds the CheckoutPage route that strictly enforces the zero-balance
gate prior to allowing staff to check out individual room lines. Includes:
- Integration with InvoiceDetail and ActiveStay API endpoints
- Exact zero-balance gate using 'isSettled' and 'isCredit' checks
- Display of DRAFT vs FINAL statement lifecycle status
- Elegant per-line checkout handling with inline error rendering

Related: M4-S10, M4-S13
```

## Member 5 — Thusath

No entries yet.


