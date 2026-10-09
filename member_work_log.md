# SkyNest shared member work log

Record actual project-task work here for all five members, including partial or blocked outcomes. Under the relevant member section, include the date and task ID, changes made, tests/build commands and results, decisions/handoffs, and remaining work. Do not claim a checklist item complete without acceptance evidence. Do not record secrets or real guest data. Keep durable confirmations in the current SRS/handoffs and this log; `memory.md` was removed and its archived snapshot is historical context only.

## Member 1 — Dulranga

### 10 October 2026 — M1-S14 sidebar assigned-branch display

- At Imandi's request during manual Member 2 testing, extended the existing sidebar `SessionPanel` to show the assigned branch name beside the staff role. Resolves only the verified session's `branchId` through existing protected `GET /api/branches/:branchId` with same-origin credentials and checks the returned ID before displaying its name. Long names wrap and the full role/branch label remains available through the title attribute. Loading, absent assignment and failed metadata reads have explicit labels; guest identity has no staff-branch lookup.
- Keyed branch state by user/branch and aborts superseded requests so account changes do not display the previous identity's branch. Existing shadcn/sidebar/sign-out controls, authorization, session payload and schema contracts remain unchanged. No database or SQL work; no lecture concepts applied.
- Verification: `node --import tsx --test frontend/tests/featureSessions.test.ts frontend/tests/staffNavigation.test.ts` passed 3/3; `npm run build:frontend` passed outside the filesystem sandbox after Vite's sandboxed realpath was denied. Temporary in-memory browser checks confirmed `Chain manager · Colombo`, another account with a long Kandy name wrapping within the footer, loading/failure/no-assignment labels and correct identity after a delayed request/account switch. Preview files removed; screenshot evidence under ignored `.scratch/sidebar-branch-preview-2026-10-10.jpg`. Real signed-in display can be checked by refreshing the user's current application. No Git publication actions or additional checklist completion claims.
- Proposed commit: `feat(auth): show assigned branch beside sidebar role`.
- Proposed PR title: `Show the assigned staff branch in the sidebar`. Description: `Display the branch name next to the authenticated staff role using the existing protected branch metadata endpoint. Preserve identity isolation during account changes, wrap long labels, and handle missing/unavailable metadata. Verified with 3 session/navigation regressions, the frontend production build and in-memory browser checks.`

### 8 October 2026 — verified session and administration integration audit

- Mounted existing APIs with verified staff/guest cookies and session-derived actor/branch context in the production application factory. Removed null frontend identity adapters and development role selectors; relative API requests carry the cookie. Staff pages give sign-in guidance; guest account invoice/payment reads remain separate.
- Member 5 branch/account compatibility actions now call Member 1's audited transactions, synchronize officer/account flags, reject self-disable and exclude guest/non-login accounts. Registered unset operational settings are visible for first initialization; actor and immediate activation are server-controlled, with financial/unknown keys rejected.
- Verification: full suite 437/437 passed; real production cookie/role/branch/admin integration and configuration initialization follow-up passed; both builds passed. Retained the earlier delayed-connection registration fix and verified the previously requested active Colombo administrator. The current development server uses a process-local session secret; durable deployment configuration remains required.
- No additional owner checklist rows were checked. Details and proposed human Git handoff: [QA audit](docs/qa/2026-10-08-bug-fix-audit.md).

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

### 4 October 2026 — M1-S08 (staff/guest login, logout, session expiry)

- Decisions (Dulranga, 4 October 2026): HMAC-signed stateless session cookie (no session table), `bcryptjs` cost 12, idle timeout read from the new `session_idle_timeout_minutes` system_config key (default 30 until an administrator sets it), and audit-based failed-login throttling.
- Added `backend/migrations/m1_007_register_session_idle_timeout.sql`: registers `session_idle_timeout_minutes` (1–999) in `system_config_key_registry()` (no seed value, because only a SYSTEM_ADMINISTRATOR may write it) and adds the partial index `idx_audit_log_login_attempts (entity_name, entity_id, changed_at DESC) WHERE action = 'LOGIN'`.
- Added `backend/src/auth.ts`: `hashPassword` (rejects < 8 chars or > 72 bytes), `createAuth`/`createAuthFromEnv` and the `authenticate`, `login`, `logout` and `currentSession` handlers. The cookie `skynest_session` is HttpOnly, Secure, SameSite=Strict and Path=/. It holds only the account ID, issue/last-seen times and a keyed password-hash fingerprint, so changing a password invalidates existing sessions. Every request re-reads role, branch, guest link and active flags, so disabling an account or officer ends its session on the next request. A staff principal comes only from `officer` and a guest principal only from `guest_account` (FR-081). The idle window slides with activity, with a 12-hour absolute cap (`SESSION_ABSOLUTE_HOURS`). `SESSION_SECRET` (≥ 32 chars) is required to start. `SESSION_COOKIE_SECURE=false` is allowed only outside production.
- Login runs in one transaction under a per-account advisory lock (or per username when the account is unknown):
  - After 5 bad-password failures in 15 minutes since the last success, further attempts return 429 with Retry-After.
  - Unknown users are checked against a dummy bcrypt hash so response time does not reveal which usernames exist.
  - Wrong passwords, unknown users, the system principal and accounts with no profile all get the same generic 401.
  - A disabled account gets 403 `ACCOUNT_DISABLED` only after the correct password.
  - Every success and failure is audited (`LOGIN` with outcome/reason; failures use the system principal as actor). `LOGOUT` is audited for a valid session.
  - The cookie is issued only after COMMIT. Errors return no internal details.
- Mounted `/api/auth/login`, `/api/auth/logout` and `/api/auth/session` (`backend/src/routes/authRoutes.ts`, `backend/src/index.ts`). `req.user` = `{ userId, username, kind, role?, branchId?, guestId? }`, which matches the shape `invoiceController.resolveActor` already reads. Updated `backend/.env.example` and `README.md`. Added the dependency `bcryptjs`. `package-lock.json` also lost some `"dev": true` flags because of the npm version.
- Added `backend/tests/m1Auth.test.ts` and `test:m1-auth`:
  - Unit tests for validation, hashing and config.
  - A database-failure test: 500, no cookie, no internal details.
  - A clean-schema integration test covering: cookie flags; staff and guest scope; generic failures; system/no-profile denial; all three disabled cases; disabling mid-session; invalidation after a password change; forged and tampered cookies; sliding idle expiry and absolute expiry; logout audit; throttle, reset and unknown-user cases; an 8-way concurrent race (exactly 5 BAD_CREDENTIALS + 3 THROTTLED); the configured 5-minute idle period; and an invalid config value.
- Incident: a first test version set `search_path` per session through the Neon `-pooler` endpoint. The transaction-mode pooler moved later transactions onto other server connections, so 10 synthetic LOGIN audit rows went into the shared `public.audit_log` (entity `login_attempt`/`race.user`, actor system principal, 4 October 2026 13:41–13:43 UTC). No other table or schema was touched. These rows cannot be deleted because `audit_log` is append-only, and they were not removed. The test now uses the direct endpoint with `search_path` pinned at startup and asserts `current_schema()` before running.
- Verification: `test:m1-auth` 3/3, `test:m1-identity` 1, `test:m1-guests` 1, `test:m1-audit` 2, `test:m1-system-config` 3, `test:m1-billing-policy` 4 and `test:migrations` 3 pass. `npm run build:backend` passes. The runner applied the full 24-file chain to a scratch schema (re-run: 0 applied, 24 skipped), and that schema was then dropped. `npm run migrate` itself still fails on teammate file `backend/migrations/audit_and_config.sql`, which uses a non-convention name; this was already broken before this task.
- Remaining handoffs:
  1. Stateless logout cannot revoke a copied cookie before it expires (accepted trade-off).
  2. Existing routers still trust `x-user-id`/`x-role` headers or test adapters. Wiring `auth.authenticate` and role/branch checks into them is M1-S09.
  3. Every developer must add `SESSION_SECRET` to `backend/.env`, or the server will not start.
  4. CSRF (NFR-013) currently relies on SameSite=Strict. A token check belongs to M1-S09 if the team wants one.
- Lecture concepts applied:
  - A partial B-tree index matching the throttle query's predicate and sort order.
  - Transaction-scoped advisory locks serializing concurrent attempts (two-session race test).
  - Atomic commit of the audit evidence before the session is issued.

### 4 October 2026 — M1-S14 (staff/guest login UI) — implemented and browser-verified

- Added the shadcn `Alert` primitive (`frontend/src/components/ui/alert.tsx`, styled per `DESIGN.md`).
- Added `frontend/src/lib/auth.ts`: API client, role labels, a redirect sanitizer that blocks open redirects, and the landing page per user type (staff `/dashboard`, guest `/`).
- Added `frontend/src/components/auth/AuthProvider.tsx`: session context with `signIn`, `signOut` and `refresh`.
- Added `frontend/src/routes/LoginPage.tsx` at `/login` (`?redirect=`, `?reason=expired`):
  - Split brand panel and form card on large screens; a single card on mobile.
  - Required-field checks inline, with `aria-invalid`/`aria-describedby` and focus moved to the field with the error.
  - Show/hide password toggle and a busy state that blocks double submission.
  - Separate messages for wrong credentials, disabled account, throttling (with retry minutes), connection failure and expired session. The password field is cleared after a failure.
- Removed the sidebar wrapping every page. `RootLayout.tsx` is a bare `<Outlet />` again, as before commit 28e094d. That commit also left the dashboard/admin pages with two sidebars, because each page already uses `AppShell`. The staff navigation (Dashboard, Reports & CSV, Branches & Users, System Config, Audit Log) is now in `AppShell`'s sidebar, using the shadcn sidebar menu primitives; `SidebarMenuButton` gained `asChild` so menu items can be links. The new `SessionPanel` in the sidebar footer shows the signed-in user/role with Sign out (or a Sign in link). Public pages (`/`, `/rooms`, `/ui`, `/login`) render without a sidebar. `vite.config.ts` proxies `/api` to `localhost:4000` so the cookie is sent same-origin.
- Verification: `npm run build:frontend` passes. The repo has no frontend test runner, and the page has not been exercised in a browser against a running backend. Route guards and redirect-on-expiry for other pages are left to M1-S09 and the page owners.
- Verification (6 October 2026, M1-S14 check-off): `npm run build:frontend` passes. `npm run test:m1-auth --workspace backend` 3/3 confirms the login contract the page maps — `INVALID_CREDENTIALS`, `ACCOUNT_DISABLED` (disabled account, officer and guest), throttling and session expiry, with no session cookie issued on failure. The page was then exercised end-to-end in real headless Chrome via the Chrome DevTools Protocol (throwaway script against the Vite dev server proxying the running backend), 9/9 checks: the sign-in form renders with the shadcn primitives; an empty submit shows the required-field validation and marks the username `aria-invalid` without calling the API; the real backend `INVALID_CREDENTIALS` response shows the incorrect-credentials alert; a fulfilled `ACCOUNT_DISABLED` response shows the disabled-account alert and clears the password field; and no uncaught JavaScript errors occur. Route guards and redirect-on-expiry for other pages remain with M1-S09 and the page owners.

### 4 October 2026 — M1-S09 (staff role/branch authorization middleware)

- Decisions (Dulranga, 4 October 2026): implemented the SRS §6.1.4 working role mapping as the version-controlled matrix, pending TBD-15 sign-off. Payments and checkout are FRONT_DESK-only (own branch), stricter than Member 4's service checks, which still run after the gate. Audit reads go to SYSTEM_ADMINISTRATOR and AUDITOR. Branch-list reads are open to all staff. Account and config reads go to SYSTEM_ADMINISTRATOR and AUDITOR.
- Added `backend/src/authorization.ts`:
  - `STAFF_ROLES` and the `PERMISSIONS` matrix. Each permission has its roles and a BRANCH or CHAIN scope: catalogue, room, room-condition, service-usage, booking, checkout, payment, invoice, discount, report, audit, billing-policy, branch, account and config.
  - `authorizeStaff` decision helper. Guests never get a staff permission. Unknown roles are denied. A BRANCH grant must match the target branch, and a CHAIN grant takes precedence.
  - Middleware: `requireStaff`, `requirePrincipal` and `requireGuestOrStaff` (guest ownership is still checked by the owning feature).
  - `routePolicy`, a default-deny method/path policy for routers that take no injected middleware. It has an optional `scopeQueryBranch` that rejects another branch and forces the officer's own branch.
  - `ADMIN_ROUTE_POLICY` and `REPORT_ROUTE_POLICY`. BRANCH_MANAGER gets only the occupancy, revenue and revenue-export reports, which filter by `branch_id`. The other reports aggregate across branches and stay chain-reader only.
  - `createAuthorization(auth.authenticate)`, plus `sessionBranchId`/`sessionUserId` as the request context.
- `backend/src/index.ts` now puts every protected `/api` router behind the session cookie:
  - `/api/admin` and `/api/reports` go through the route policies.
  - Invoice routes: guest or invoice reader.
  - Payment and checkout routes: `payment.record` and `checkout.perform`.
  - Catalogue: any signed-in user reads; writes need `catalogue.write`.
  - Room inventory: `room.read`/`room.write`, with the branch and actor taken from the session.
  - The catalogue and room-inventory routers are mounted for the first time. `/api/availability` stays public.
  - As a result, `x-user-id`/`x-role` headers no longer reach `resolveActor` on mounted routes.
- Frontend: changed the `http://localhost:4000` calls in Member 5's `AdminConfigPage`, `AdminOperationsPage`, `AuditLogPage` and `ReportsPage` to relative `/api/...` URLs (with the user's approval). The Vite proxy then sends them same-origin with the cookie. Updated `README.md`.
- Added `backend/tests/m1Authorization.test.ts` and `test:m1-authorization`:
  - A per-role matrix unit test.
  - A clean-schema HTTP integration test using real login cookies and Member 2's real catalogue and room routers. It covers:
    - AT-24: every non-Chain-Manager role and guests are denied room-type and amenity writes, and the rates stay unchanged.
    - Branch scope: Branch Manager cross-branch room, block and block-delete attempts all fail. A client-supplied branch is rejected, and room reads are own-branch only.
    - Every role on every admin, report, payment, checkout and invoice gate. Unmapped admin routes are denied by default.
    - Spoofed identity headers: 401 without a cookie, 403 with a lower-role cookie.
    - Report branch pinning, including a blank filter and a repeated parameter.
    - Mid-session role and branch changes.
- Test isolation fix: `m1Auth.test.ts` failed once because its setup client used the Neon `-pooler` endpoint with a session-level `search_path`. Its read went to the wrong server connection. Both M1 HTTP tests now connect the setup client to the direct endpoint and assert `current_schema()` first. Checked afterwards: no test rows reached `public`, and no scratch schemas were left behind.
- Verification:
  - `test:m1-authorization` 2/2, `test:m1-auth` 3/3, `test:m1-identity` 1, `test:m1-guests` 1, `test:m1-audit` 2, `test:migrations` 3 and `test:m2-room-api` 1 pass.
  - `test:m2-catalogue-api` failed once, possibly a connection blip. It passed on re-run, and this change does not touch its code path.
  - `npm run build:backend` and `npm run build:frontend` pass.
  - A real server start showed spoofed-header requests to admin, reports, rooms, room-types and payments get 401, while availability stays public.
- Remaining handoffs:
  1. TBD-15: Members 1/5 and the API owners must sign off on the matrix.
  2. Member 4: the services still allow CHAIN_MANAGER/SYSTEM_ADMINISTRATOR checkout and any staff role to post payments. The route gate is now stricter, so their services should be aligned.
  3. Member 5: `updateConfig` takes `updated_by` from the request body. It should use `req.user.userId`.
  4. Member 5: reports other than occupancy and revenue need a `branch_id` filter before Branch Managers can use them.
  5. Member 3: the service catalogue (part of AT-24) and the M3-S18 condition route should use `catalogue.write`/`room.condition.write`.
  6. Member 2: catalogue and room routers are now mounted, but their audit integration (M2-S07/S08) is still open.
  7. Frontend pages do not yet redirect to `/login` on a 401.
- Lecture concepts: none. No schema or SQL change. The authorization reads the role and branch that `authenticate` re-reads with the existing parameterized join.

### 5 October 2026 — M1-S10 (online guest registration and verified guest_account linking)

- Decisions (Dulranga, 5 October 2026):
  - Proof of identity for an existing guest is a staff-issued link code: FRONT_DESK checks identity in person or by phone, then issues the code. There is no email/SMS provider in the stack.
  - A new sign-up whose email, phone or NIC matches an existing guest profile is refused with a message to ask the front desk for a link code. No duplicate profile is created.
  - Only FRONT_DESK may issue codes (new permission `guest.link.issue`, chain-wide because `guest` has no branch FK).
- Added `backend/src/guestRegistration.ts`:
  - Link codes: version + guest UUID + expiry + 6-byte nonce, with a 16-byte HMAC-SHA256 tag keyed by `SESSION_SECRET` under its own domain prefix; about 58 base64url characters. They are valid for 24 hours and stored nowhere. A code cannot be re-targeted to another guest or extended. It is effectively single-use because `guest_account.guest_id` is unique. Issuing a new code does not revoke earlier ones; they simply stop working once the profile is linked or they expire.
  - `POST /api/auth/register` (public). New-guest mode needs `fullName` and an email or phone (FR-017); email is lowercased, phone reduced to digits with an optional `+`, NIC trimmed/uppercased (format validation still awaits the FR-018 team decision). Link mode takes only `{ username, password, linkCode }`; submitted profile fields are ignored, so a claimant cannot overwrite the guest's details. Usernames are 3–64 characters and unique case-insensitively, so "Alice" cannot impersonate "alice" or a staff name.
  - Everything runs in one transaction. Advisory locks on the sorted email/phone/NIC keys serialize registrations sharing an identifier; the claimed guest row is locked `FOR UPDATE` and must be active and unlinked; a concurrent claim that still reaches the insert gets the unique violation mapped to `LINK_CODE_USED`.
  - Rejections (matching profile, invalid/expired/used code, inactive guest) roll back to a savepoint, so no account is left behind, and are audited as `guest_registration` failures by the system principal. More than 10 failures per client address in 15 minutes returns 429 with Retry-After.
  - Success audits `CREATE` rows for `user_account`, `guest` (new profiles only; NIC is masked) and `guest_account` (verification method and the code's nonce ID), with the new account as actor. Registration does not sign in; the client calls `/api/auth/login`, which keeps throttling and LOGIN audit in one place.
  - `POST /api/guests/:guestId/link-code` returns 404 for unknown IDs and 409 for inactive or already-linked guests. Issuance is audited with the officer as actor and the nonce ID, never the code.
- Added `backend/src/routes/guestRegistrationRoutes.ts` and mounted it in `backend/src/index.ts` before the other `/api` routers, with `authorization.staff('guest.link.issue')` on the issue route. Updated the M1-S09 matrix test for the new FRONT_DESK permission, `README.md`, and `package.json` (`test:m1-guest-registration`).
- Added `backend/tests/m1GuestRegistration.test.ts`:
  - Validation and link-code unit tests (signature, guest binding, expiry, wrong key, tampered guest/expiry, whitespace tolerance).
  - A clean-schema HTTP test: new registration with normalized fields, hashed password and audit without password/NIC; login gives a GUEST principal; that session gets 403 on staff routes and the link-code route, and the m1_003 trigger rejects making it an officer (FR-081). Case-insensitive and staff-name username collisions. Email/phone/NIC matches refused with nothing created. Every non-FRONT_DESK role and guests denied issuance; unknown/inactive/linked cases. Forged, re-targeted, expired and inactive-guest codes refused. Two concurrent claims of one code produce exactly one link, no orphan account and unchanged guest details; the link audit traces back to the issuing officer; reuse fails. Per-client throttling, and the short-password policy.
- Verification: `test:m1-guest-registration` 3/3, `test:m1-authorization` 2/2, `test:m1-auth` 3/3 and `test:m1-guests` 1/1 pass. `npm run build:backend`, `npm run build:frontend` and `git diff --check` pass. Checked afterwards: no test rows in `public.audit_log` and no scratch schemas left.
- Remaining handoffs:
  1. `req.ip` is the socket address. Behind a reverse proxy, the app needs a reviewed `trust proxy` setting, or all clients share one throttle bucket (in local dev through the Vite proxy they already do).
  2. M1-S11's staff guest create should take the same `guest-identity:*` advisory locks and duplicate rules, so staff and online creation cannot race into duplicates.
  3. A 58-character code is easy to paste but awkward to read out by phone. A shorter stored code would need a new table and owner review.
  4. Frontend registration/link screens are M1-S15; the staff "issue link code" button belongs with M1-S16.
  5. Members 2/3 can now mount their online-guest routers: real GUEST sessions with `guestId` exist.
- Lecture concepts applied: transaction atomicity with a savepoint (a rejected registration leaves no partial rows), row-level `FOR UPDATE` locking and transaction-scoped advisory locks to serialize concurrent claims and same-identifier registrations, and the existing unique constraints as the final concurrency guard.

### 5 October 2026 — M1-S11 (staff guest-profile search/create/update API)

- Decisions (Dulranga, 5 October 2026): FRONT_DESK only (new `guest.manage`, chain-wide because `guest` has no branch FK); NIC shown as `•••••` + last 4 characters (fixed prefix, so length is hidden); deactivate/reactivate included in this task.
- Added `backend/src/guestIdentity.ts`, shared with M1-S10: profile-field parsing/normalization (lowercase email, digits-only phone, uppercase NIC), `maskNic`, sorted `guest-identity:*` advisory locks and `findGuestIdentityMatches` (normalizes legacy stored values in SQL). `guestRegistration.ts` now uses it; behaviour unchanged and its tests still pass.
- Added `backend/src/guestProfiles.ts` and `backend/src/routes/guestProfileRoutes.ts`, mounted in `backend/src/index.ts` with `authorization.staff('guest.manage')`:
  - `POST /api/guests/search` — body `{ query?, nic?, includeInactive?, limit? }` (POST keeps NICs out of URLs/logs). `query` (2–100 chars) matches name, email or phone digits (4+ digits) as a substring with LIKE metacharacters escaped; `nic` matches exactly only, so partial NICs never match. Active-first, default 20/max 50, `meta.truncated`. Inactive excluded unless requested.
  - `GET /api/guests/:guestId` — detail with `maskedNic`, `hasNic`, `hasOnlineAccount`.
  - `POST /api/guests` — needs `fullName` and email or phone (FR-017). NIC match → 409 `GUEST_NIC_EXISTS` (never overridable). Email/phone match → 409 `POSSIBLE_DUPLICATE` with masked candidates (`matchedOn`) unless `confirmNotDuplicate: true` (e.g. family sharing a phone). Unknown fields → 400.
  - `PATCH /api/guests/:guestId` — partial; `null` clears email/phone/NIC but one contact must remain. Only changed identifiers are duplicate-checked (excluding self). Inactive profiles must be reactivated first. A no-op writes nothing. Audit `UPDATE` stores only changed fields. Bookings/invoices reference `guest_id`, so history is untouched (FR-021).
  - `POST /api/guests/:guestId/deactivate|reactivate` with optional `reason`. Deactivation is refused with `GUEST_HAS_OPEN_BOOKINGS` while any BOOKED/CHECKED_IN line exists. The guest row is locked `FOR UPDATE`, which conflicts with the `FOR KEY SHARE` taken by `m2_008` booking creation, so the two serialize. Deactivating disables a linked online login immediately (auth re-reads `guest.active`); the `guest_account` link stays.
  - All writes run in one transaction, respond only after COMMIT, and audit with the officer as actor; NIC is `[REDACTED]` by `appendAudit`.
- Tests: `backend/tests/m1GuestProfiles.test.ts` (`test:m1-guest-profiles`), M1 + M2-S02..S06 migrations in a scratch schema. Covers masking/validation units; 401 anonymous and 403 for every non-FRONT_DESK role and an online guest on all six routes with nothing changed; name/email/legacy-phone/exact-NIC search, partial-NIC probes, `%%`/`__`/SQL-injection strings as literal data (AT-10), raw NIC absent from every response; create normalization and audit; NIC duplicate not overridable; email/phone duplicate then confirm; concurrent same-email creates (one 201, one 409); update audit diff, no-op, NIC/email conflicts, contact rule, unknown field, NIC clear, booking ref unchanged; deactivation blocked by an assigned BOOKED line, online login 403 after deactivate and restored after reactivate, already-active/inactive and edit-inactive errors; limit/truncation.
- Verification: `test:m1-guest-profiles` 2/2, `test:m1-guest-registration` 3/3, `test:m1-authorization` 2/2 (matrix updated), `test:m1-auth` 3/3, `test:m1-guests` 1/1; backend and frontend builds and `git diff --check` pass; no scratch schemas or `public.audit_log` guest rows left.
- Remaining handoffs:
  1. Name/email substring search is a sequential scan. Fine at project scale; a `pg_trgm` GIN index would need a migration and team review if NFR-002 timing becomes a problem.
  2. Concurrent PATCHes are serialized by the row lock but last-write-wins; no `expectedUpdatedAt` check yet. The M1-S16 UI could send one if the team wants it.
  3. Deactivation only checks open booking lines; unpaid invoices are not checked (Member 4 contract).
  4. Booking/payment history in the profile view (FR-020) waits for Members 2/4 endpoints.
  5. UI is M1-S16 (search before create per FR-019, duplicate candidates, masked NIC).
- Lecture concepts applied: transaction atomicity (respond only after COMMIT), row-level `FOR UPDATE` vs `FOR KEY SHARE` lock compatibility to serialize deactivation with booking creation, advisory locks for duplicate detection under concurrency, parameterized queries with escaped LIKE patterns against SQL injection, and the partial unique index on NIC as the final guard.

### 5 October 2026 — M1-S12 (online guest own-profile API)

- Added `backend/src/guestAccount.ts` and `backend/src/routes/guestAccountRoutes.ts`, mounted in `backend/src/index.ts` at `/api/guest/profile` behind a new `requireGuest` guard added to `authorization.ts` (`createAuthorization(...).guest`): guest sessions only, every staff role is 403 (BR-013; staff guest maintenance stays in M1-S11).
  - `GET /api/guest/profile` — the linked guest profile with `maskedNic`/`hasNic`; the guest ID always comes from the session (`guest_account` → `guest`), never from a request parameter or body, so guessed IDs and cross-account reads are structurally impossible.
  - `PATCH /api/guest/profile` — partial edit of `fullName`/`email`/`phone`/`nic` (`null` clears the optional fields). Reuses the shared `guestIdentity.ts` normalization, advisory locks and duplicate matching from M1-S10/S11: a NIC match is refused, an email/phone match warns with masked candidates unless `confirmNotDuplicate: true`; the guest's own unchanged identifiers are excluded from the check. At least one contact method must remain (FR-017).
  - Only changed fields are audited (`UPDATE`); a no-op edit writes nothing. A deactivated guest is refused both by auth (session dies on the next request, because `guest.active` is re-read per request) and by the service.
- Tests: `backend/tests/m1GuestAccount.test.ts` (`test:m1-guest-account`) — validator units; anonymous 401, staff 403 and guest-session reads/edits; own-profile read with masked NIC and no raw NIC in any response; changed-fields audit; no-op; contact rule; NIC duplicate refusal; email duplicate warn-then-confirm; NIC clear; deactivation killing login and edit.
- Verification: `test:m1-guest-account` 2/2; M1 regressions (`m1-auth`, `m1-authorization`, `m1-guest-registration`, `m1-guest-profiles`) and both builds pass. No migration.
- Remaining handoffs: booking/payment history in the account summary is M1-S18 (needs Members 2/4 read endpoints); the UI is M1-S17 (no staff search/navigation, own-record states).
- Lecture concepts applied: ownership derived from the authenticated session rather than client input, transaction atomicity with rollback-on-error, per-request re-reading of account state for immediate revocation, and shared normalization/advisory-lock rules to keep duplicate detection consistent across all three guest write paths.

### 5 October 2026 — M1-S13 (staff-account administration API)

- Added `backend/src/staffAccounts.ts` and `backend/src/routes/staffAccountRoutes.ts`, mounted in `backend/src/index.ts` behind the existing matrix permissions — no matrix change: writes `account.write` (SYSTEM_ADMINISTRATOR only), reads `account.read` (SYSTEM_ADMINISTRATOR + AUDITOR), both chain-wide.
  - `POST /api/users/search` — `{ query?, nic?, includeInactive?, limit? }`, POST so NICs stay out of URLs. `query` (2–100 chars) matches officer name/email/phone digits as a literal substring (LIKE metacharacters escaped, AT-10); `nic` matches exactly only. Active first, default 20/max 50, `meta.truncated`. Deactivated officers are hidden unless `includeInactive`, so an admin can still find them to reactivate.
  - `GET /api/users/:userId` — detail with `maskedNic`/`hasNic`, `branchName`, `roleName`. The non-login system principal has no officer row and returns 404; every query joins `officer`, so it can never appear in results.
  - `POST /api/users` — `{ fullName, username, email?, phone?, nic?, branchId, roleId, password? }`. Username is lowercased and checked case-insensitively; NIC is uppercased. Without a `password`, a one-time `temporaryPassword` (`Skyn-…`, 20 chars) is returned in the response — never stored in plain text and never audited (the audit records only `tempCredentialIssued: true`; the key name deliberately avoids the word "password", which `appendAudit` redacts). Branch/role FKs are validated with EXISTS so the error names the bad field.
  - `PATCH /api/users/:userId` — partial contact/branch/role edits plus `password` reset. Username is not editable (rejected as an unknown field). Only changed fields are audited; a password reset records `after.password = '[REDACTED]'` and nothing raw. A reset changes the M1-S08 hash fingerprint, so the target officer's existing cookie dies on the next request — tested. A no-op writes nothing. Editing a disabled officer is refused (`OFFICER_INACTIVE`), mirroring M1-S11's inactive-guest rule.
  - `POST /api/users/:userId/disable|reactivate` — soft flags set on BOTH `officer.active` and `user_account.active` (auth checks both, so the session dies immediately; login returns 403). No row is ever deleted (FR-074); audit `DEACTIVATE`/`REACTIVATE`. An administrator cannot disable their own account (`SELF_DISABLE_FORBIDDEN`).
  - Concurrency: `pg_advisory_xact_lock` on `officer-username:*`/`officer-nic:*` keys serializes concurrent creates/updates; the unique index/`user_account_username_unique` and partial `officer_nic_unique` are the final guards and map to 409s. All writes run in one transaction and respond only after COMMIT (FR-080).
- Also repaired `backend/tests/m1SystemConfig.test.ts`: it still applied the deleted legacy `0000_create_audit_and_config.sql` (audit is `m1_004`, system_config is `m1_006` since the reorganization), so the member's own regression had been failing on a missing file. Removed the stale entry; the test passes unchanged otherwise.
- Tests: `backend/tests/m1StaffAccounts.test.ts` (`test:m1-staff-accounts`) — validator units (create/search/update, password policy, username-not-editable); anonymous 401 on all six routes; every non-admin staff role and an online guest 403 everywhere; AUDITOR can search/get but is 403 on all four writes; denied requests create nothing; search by name/legacy-phone/exact-NIC with partial-NIC probes returning nothing, `%%`/`__`/SQL-injection strings as literal data, masked NIC in every response, system principal 404; create normalization/audit/temporary-password-login, explicit-password login, case-insensitive username 409, NIC 409, unknown branch/role 400, concurrent same-username creates (one 201 one 409); update changed-fields-only audit, no-op, NIC conflict, role/branch reassignment audit, password reset killing the old cookie and accepting the new password; disable: self-disable 403 with no audit, both flags false in DB, session dead immediately, login 403, edit refused while inactive, hidden from default search but visible with `includeInactive`, double-disable 409, officer count unchanged (no deletion), reactivation restoring login and double-reactivate 409; limit/truncation.
- Verification: `test:m1-staff-accounts` 2/2; `test:m1-identity` 1/1, `test:m1-guests` 1/1, `test:m1-audit` 2/2, `test:m1-billing-policy` 4/4, `test:m1-system-config` 3/3 (after the filename repair), `test:migrations` 3/3, `test:m1-auth` 3/3, `test:m1-authorization` 2/2, `test:m1-guest-registration` 3/3, `test:m1-guest-profiles` 2/2, `test:m1-guest-account` 2/2; backend and frontend builds and `git diff --check` pass; no scratch schemas left in the shared database (also dropped two leaked by the interrupted runs and one pre-existing Member 3 `m3_check_in_*` leftover).
- Remaining handoffs:
  1. `test:admin` (Member 5, `tests/m5_admin.test.cjs`) fails on a pre-existing expectation: it requires a legacy financial `system_config` key (`cancellation_fee_rate`) that M1-S07 deliberately removed per FR-076 (financial policy lives in `billing_policy`). Needs Member 5/1 coordination; not touched here.
  2. Member 5's `/api/admin/users` (mock controller) overlaps conceptually with this real `/api/users` API; their admin UI should consume the real endpoints and retire the mock, at their pace.
  3. No "last active administrator" guard beyond self-disable: an admin can still disable every other admin. A count-based guard needs a team decision.
  4. Officer searches are sequential scans; fine at this scale, same `pg_trgm` note as M1-S11.
- Lecture concepts applied: transaction atomicity with commit-before-response and unique-violation mapping, transaction-scoped advisory locks to serialize identity claims under concurrency, row-level `FOR UPDATE` on the target officer, parameterized queries with escaped LIKE patterns, and referential-integrity pre-checks (EXISTS) ahead of FK enforcement so errors are user-attributable.

### 6 October 2026 — M1-S15 (online registration/link UI)

- Added `frontend/src/lib/registration.ts`: a typed client for the public `POST /api/auth/register` endpoint (`registerGuest`), a `RegistrationError` carrying the server `code`, `retryAfterSeconds` and `fields`, and client-side checks that mirror the server policy (`PASSWORD_MIN_LENGTH` 8 / `PASSWORD_MAX_BYTES` 72, username/email/phone patterns). It builds the exact M1-S10 request bodies (`{ username, password, fullName, email?, phone?, nic? }` for a new guest, `{ username, password, linkCode }` for linking) and omits blank optional fields.
- Added `frontend/src/routes/RegisterPage.tsx` at `/register` (public, registered in `router.ts` with a `validateSearch` for `redirect` and `mode`). One form, two paths behind a `New guest` / `I have a link code` toggle group:
  - New guest: full name, email-or-phone (FR-017), optional NIC (with a privacy note), username and password.
  - Link: link code, username and password.
  - Reuses the shadcn `Card`, `Input`, `Label`, `Button` and `Alert` primitives and the `LoginPage` split brand-panel layout (single card on mobile); no new handbuilt components.
  - Safe failure handling (the acceptance criterion): `PROFILE_EXISTS` renders as an informational alert that never says which detail matched and offers a button to switch to the link-code path; `INVALID_LINK_CODE`, `LINK_CODE_USED`, `USERNAME_TAKEN` (inline on the field) and `TOO_MANY_ATTEMPTS` (retry minutes from `Retry-After`) are shown without leaking data; `VALIDATION_ERROR.fields` maps to inline messages, with the server's combined `contact` rule surfaced on the email field, and focus moves to the first invalid field. `NETWORK_ERROR` and unexpected codes fall back to a generic message.
  - Everything is labelled, with `aria-invalid`/`aria-describedby`, and the password has a show/hide toggle. Success shows a created-vs-linked confirmation and a link to `/login`, carrying a sanitized `redirect`.
- Discoverability: the homepage `Sign up` and `Get Started` calls to action now link to `/register`, and the sign-in page gained a "New guest? Create an account" link that preserves `redirect`. Documented the route in `README.md`.
- Verification: `npm run build:frontend` (tsc + vite) and `npm run build:backend` pass; `git diff --check` is clean. Because there is no frontend test runner, I confirmed the server contract directly: started the built backend and `curl`ed `POST /api/auth/register` — an empty body returns `400 {"error":{"code":"VALIDATION_ERROR",...,"fields":{"contact":"an email address or phone number is required"}}}`, matching the client parser, and a bogus link code returns `400 {"error":{"code":"INVALID_LINK_CODE",...}}`; `npm run test:m1-guest-registration --workspace backend` passes 3/3. The page has not been exercised in a real browser.
- Remaining handoffs:
  1. No frontend test runner exists, so the page's error mapping is verified by code inspection plus the live server contract, not by an automated UI test. A minimal component-test setup (vitest + Testing Library) would need team agreement.
  2. The staff "issue link code" button and the FRONT_DESK link-code flow are M1-S16, not here.
  3. A link code is ~58 characters; the link field accepts whitespace and the client trims it, but a shorter human-readable code would need a new server design (M1-S10 handoff).
  4. The live smoke test's bogus-link-code probe wrote one `guest_registration` failure row to `public.audit_log` (the endpoint audits failures by design and the table is append-only, so it was left in place).
- Lecture concepts applied: none. This is a frontend-only change with no schema or SQL modification.

### 6 October 2026 — M1-S16 (staff guest-search/profile UI)

- Added two dependency-free shadcn primitives, exported from `frontend/src/components/ui/index.ts`: `table.tsx` (`Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell`/`TableFooter`/`TableCaption`, styled with the Mono border/motion tokens) and `badge.tsx` (`Badge` with `default`/`secondary`/`destructive`/`outline`/`muted` variants). No custom primitives were invented.
- Added `frontend/src/lib/guests.ts`, a typed client for the M1-S10/M1-S11 guest APIs over the session cookie: `searchGuests`, `getGuest`, `createGuest`, `updateGuest`, `setGuestActive`, `issueGuestLinkCode`, plus `GuestApiError` carrying the server `code`, `fields`, duplicate `candidates` and `openBookings`. Search is POST so full NICs never reach a URL or access log.
- Added `frontend/src/routes/GuestProfilesPage.tsx` at `/guests` (registered in `router.ts` and added to the `AppShell` "Management" sidebar):
  - **Search (FR-019):** name/email/phone literal-substring search and an exact-only full-NIC field, an "include deactivated" `aria-pressed` toggle, a results table with masked NIC (`•••••567V`), online-account and active state, and a row "View" action. Empty, no-result and truncated states are handled.
  - **Create:** full name plus at least one contact (FR-017), optional NIC; duplicate handling as below.
  - **Detail:** profile summary (clear email/phone, masked NIC only, created/updated) and actions. **Edit** uses dirty-field diffing and sends only changed keys, because the API never returns the raw NIC — a blank NIC field means "keep current", and the helper text says so. **Deactivate/Reactivate** with an optional reason; `GUEST_HAS_OPEN_BOOKINGS` is shown with the open-booking count. **Issue link code** (the action deferred from M1-S15) is offered only while the profile is active and unlinked; the returned code is shown once with a copy button and expiry.
  - **Duplicate handling:** `POSSIBLE_DUPLICATE` lists masked candidates with their matched fields and offers "This is a different person — continue" (re-submits with `confirmNotDuplicate: true`); `GUEST_NIC_EXISTS` lists candidates but offers no override (one profile per NIC); each candidate has a "Use this profile" action.
  - **Branch/role denial:** non-FRONT_DESK sessions — including BRANCH_MANAGER, who holds `room.write` but not `guest.manage` — render an "Access restricted" card, and a server `FORBIDDEN`/`AUTHENTICATION_REQUIRED` flips to the same state. `guest.manage`/`guest.link.issue` are FRONT_DESK-only and chain-wide.
  - **Accessibility:** every input has a `Label`/`htmlFor`; error states set `aria-invalid`/`aria-describedby` and focus the first invalid field; mode toggles use `aria-pressed`; the results region is `aria-live="polite"`; icon-only buttons carry `aria-label`.
- Verification: `npm run build:frontend` (tsc + vite) passes; `git diff --check` clean. Because there is no frontend test runner, I confirmed the server side directly: started the built backend and `curl`ed the mounted routes — `POST /api/guests/search`, `GET /api/guests/:id` and `POST /api/guests/:id/link-code` all return `401 {"error":{"code":"AUTHENTICATION_REQUIRED"}}` anonymously; `npm run test:m1-guest-profiles --workspace backend` passes 2/2 (masking/validation plus search/create/update/deactivate with privacy, permissions and duplicate rules). The page has not been exercised in a real browser.
- Remaining handoffs:
  1. No frontend test runner exists, so the page is verified by code inspection plus the live API contract, not an automated UI test. A component-test setup (vitest + Testing Library) would need team agreement.
  2. `GuestProfilesPage` and the other staff pages still do not redirect to `/login` on a 401 — the known M1-S09 frontend gap. The page shows the restricted/sign-in state instead.
  3. FR-018 still leaves NIC format validation and passport alternatives to a team decision; this UI treats NIC as an opaque, optional string and only enforces a 255-character cap.
  4. Booking/payment history on the profile is not shown here; it depends on Members 2/4 read endpoints (M1-S18).
- Lecture concepts applied: none. This is a frontend-only change (no schema or SQL modification).

### 6 October 2026 — M1-S17 (online guest own-profile UI)

- Added `frontend/src/lib/guestAccount.ts`, a typed client for the M1-S12 `/api/guest/profile` endpoints over the session cookie: `getOwnProfile()` and `updateOwnProfile(input)`, with a `GuestAccountError` carrying the server `code` and `fields`. The client never sends or accepts a guest ID — the server derives the guest from the session.
- Added `frontend/src/routes/AccountPage.tsx` at `/account` (registered in `router.ts`). It renders standalone with a guest-only top bar (SkyNest brand + sign out) and deliberately no staff sidebar, search or navigation:
  - Reads and edits the signed-in guest's own profile. It shows a masked NIC only and uses dirty-field diffing so a blank NIC field means "keep current" (the raw NIC is never returned by the API), and enforces the FR-017 one-contact rule.
  - **Own-record state:** the profile (name, email, phone, masked NIC, member since, last updated) is authoritative; there is no ID parameter, so cross-account access is structurally impossible.
  - **Forbidden-update states:** a staff session — or a server `FORBIDDEN` — shows a "this area is for guest accounts" card; a deactivated/invalid session (`GUEST_INACTIVE`, `AUTHENTICATION_REQUIRED`) shows a session-ended card; `POSSIBLE_DUPLICATE` offers a "these are my details — save" confirm (`confirmNotDuplicate`), while `GUEST_NIC_EXISTS` has no override.
  - Accessibility: labels/`htmlFor`, `aria-invalid`/`aria-describedby`, focus to the first invalid field, `role="status"` success, and `role="alert"` warnings.
- `frontend/src/routes/IndexPage.tsx` now shows a "My account" link for signed-in guests instead of Log in/Sign up, so the page is reachable without a staff sidebar.
- Verification: `npm run build:frontend` (tsc + vite) passes; `git diff --check` clean. As there is no frontend test runner, I confirmed the server side directly: started the built backend and `curl`ed `/api/guest/profile` — `GET` and `PATCH` both return `401 {"error":{"code":"AUTHENTICATION_REQUIRED"}}` anonymously; `npm run test:m1-guest-account --workspace backend` passes 2/2 (own-profile validation plus access control and duplicate rules). The page has not been exercised in a real browser.
- Remaining handoffs:
  1. No frontend test runner, so the page is verified by inspection plus the live API contract, not an automated UI test (same gap as M1-S14–S16).
  2. The M1-S12 `POSSIBLE_DUPLICATE` response carries no candidate list (unlike M1-S11), so the guest UI can only ask for confirmation, not show masked candidates. A candidate echo on the guest path would need a Member 1 API change.
  3. Booking/payment history is intentionally not on this page yet; M1-S18 will add it to the same `/account` summary once Members 2/4 read endpoints are mounted.
  4. FR-018 NIC format validation remains an open team decision; NIC is treated as an opaque optional string.
- Lecture concepts applied: none. This is a frontend-only change (no schema or SQL modification).

### 6 October 2026 — M1-S20 (audited branch-record administration API)

- Decisions (Dulranga, 6 October 2026): reads use `branch.read` (every staff role) and writes use `branch.write` (SYSTEM_ADMINISTRATOR), matching the M1-S09 matrix and FR-008. Deactivation/reactivation are explicit `POST .../deactivate|reactivate` endpoints rather than a generic `PATCH`, so the soft state change is always audited and cannot bypass Member 2's current-assignment guard. Deactivation is a soft flag on the existing `branch` row: nothing is deleted, so rooms, officers, bookings and audit evidence keep a valid branch FK (FR-008/FR-021). `active` is not editable through `PATCH`.
- Added `backend/src/branches.ts`:
  - `validateBranchCreateInput` / `validateBranchUpdateInput` (name/city required and trimmed, ≤255; `address` optional ≤65535 with `null` to clear; unknown keys rejected; PATCH needs at least one changed field), and `validateBranchSearchInput` (`active` true/false and a ≤100-character literal `search`).
  - A `{ list, get, create, update, deactivate, reactivate }` service. Writes run in one transaction and respond only after COMMIT (FR-080); `update` diffs only changed fields and writes no audit row for a no-op. `appendAudit` records `CREATE`/`UPDATE`/`DEACTIVATE`/`REACTIVATE` on `entity_name = 'branch'` with the acting officer as actor; the optional deactivation `reason` is stored in the `DEACTIVATE` after-evidence.
  - Deactivation maps Member 2's `m2_guard_branch_deactivation` SQLSTATE `23514` to `409 BRANCH_HAS_ACTIVE_ASSIGNMENTS`. The trigger and Member 2's `m2_validate_assignment_target` both lock the branch row, so a booking cannot slip past a concurrent deactivation. Search escapes LIKE metacharacters so `%`/`_` are literal data (AT-10).
- Added `backend/src/routes/branchRoutes.ts` (authorization-injected factory) and mounted it at `/api/branches` in `backend/src/index.ts` behind `authorization.staff('branch.read')` / `authorization.staff('branch.write')`.
- Added `backend/tests/m1Branches.test.ts` (`test:m1-branches`): a validation unit test plus a clean-schema HTTP integration test with real login cookies and the real M1+M2 migration chain. It covers anonymous 401s, guest and non-admin 403s with no rows created, strict validation, create/edit audit content and actor, no-op writes no audit, clean 404s for unknown/malformed IDs, literal `%` search, AT-25 rejection while a BOOKED assignment is open (with no `DEACTIVATE` audit and the row preserved), successful deactivation/reactivation after the line is validly closed, and a concurrency case where an open booking in a second session blocks deactivation.
- Verification: `test:m1-branches` 2/2; `test:migrations` 3/3, `test:m1-authorization` 2/2, `test:m1-staff-accounts` 2/2 and `test:m1-audit` 2/2 all pass; `npm run build:backend` passes. A live `tsx src/index.ts` start returned `401 AUTHENTICATION_REQUIRED` for anonymous `GET`/`POST /api/branches`, confirming the router mounts under the full app. `git diff --check` clean; no scratch schemas or `public` audit rows left.
- Remaining handoffs:
  1. The legacy unaudited `/api/admin/branches` handlers in `adminController.ts`/`adminRoutes.ts` (and their `ADMIN_ROUTE_POLICY` rules) are superseded but still present because Member 5's `/admin/branches` UI calls that path. Member 5 should migrate the admin UI to `/api/branches` so the legacy branch handlers and their policy rules can be removed; until then, branch writes through the legacy path are not audited (they are still SYSTEM_ADMINISTRATOR-only and still blocked by the M2-S06 guard).
  2. No frontend change here; `AdminOperationsPage.tsx` still reads the legacy bare-array response and posts to `/api/admin/branches`. The new API returns the `{ data }` envelope used by M1-S11/S13.
  3. Branch list reads have no pagination because the chain is small; revisit if branch count grows.
- Lecture concepts applied: transaction atomicity/consistency and the ACID contract for the create/edit/deactivate writes, and concurrency control through row locks (`FOR UPDATE` / the UPDATE row lock) so the deactivation and booking-validation transactions serialize; the branch row lock is the serialization point shared with Member 2's M2-S06 guard. Integrity is enforced by the existing database trigger/CHECK constraints rather than trusted to the application alone.

### 6 October 2026 — M1-S18 (online guest reservations summary)

- Decisions (Dulranga, 6 October 2026): Member 1 lands the integration seam by mounting Member 2's already-written M2-S14 read router at `/api/guest` behind Member 1's production `authorization.guest` session middleware with `sessionUserId` — the mount the M2 route file itself documents. The account summary links Member 2's booking reads and Member 4's invoice/payment reads rather than reimplementing them (M1-S18 "do not duplicate their APIs/screens"), and the guest id is never accepted from the client (FR-082). This resolves the M1-S18 blocker and unblocks Member 2's M2-S14 check-off once they re-verify.
- Changed `backend/src/index.ts`: imported `createOnlineGuestBookingReadRouter` and mounted it at `/api/guest` (so `GET /api/guest/bookings` and `GET /api/guest/bookings/:bookingId`), after the guest-profile mount so `/api/guest/profile` is unaffected. No schema or migration change.
- Added `frontend/src/lib/guestBookings.ts`: typed clients for the guest's own booking list/detail (`{ data }` envelope) and Member 4's invoice/payment history (bare responses), with a `GuestBookingError` carrying the server `code`.
- Added `frontend/src/components/account/GuestReservations.tsx` (composed from the shadcn `Card`/`Badge`/`Button`/`Alert` primitives; no new UI primitives) and rendered it in `frontend/src/routes/AccountPage.tsx` under "Your reservations". It lists the guest's own bookings with stay dates and per-status line counts; expanding one lazily fetches the detail plus invoice and payments and shows every room line (room type, assigned room, dates, guests, rate, status) under its single owned booking, with the invoice total/paid/balance and payment history shown once per booking (no per-line duplication). Empty, loading, error and provisional-invoice states are handled.
- Added `backend/tests/m1GuestBookingSummary.test.ts` (`test:m1-guest-booking-summary`): a clean-schema HTTP integration test with real login cookies and the current M1+M2+M3+M4 migration chain. It mounts the M2 read router with the real `authorization.guest` middleware and Member 4's invoice router, then verifies anonymous/staff denial, a two-room booking returned as one booking with both lines, a single payment surfaced once with the correct balance, another guest's own list/detail isolation, guessed/other-owner booking `BOOKING_NOT_FOUND`, Member 4 `FORBIDDEN` for another guest's booking, and rejection of a client-supplied `guestId` query parameter. The M2 read service resolves its schema from `PG_SCHEMA`, so the test sets it before dynamically importing the router (matching the M2 test harness); authentication and the Member 4 router use a search-path-scoped pool, and the invoice fixture sets `app.current_user_id` for Member 4's audit trigger.
- Verification: `test:m1-guest-booking-summary` 1/1; `test:m1-branches` 2/2 and `test:m1-authorization` 2/2 still pass; `npm run build:backend` and `npm run build:frontend` pass; a live `tsx src/index.ts` start returned `401 AUTHENTICATION_REQUIRED` for anonymous `GET /api/guest/bookings`, `GET /api/guest/profile` and `GET /api/bookings/:id/invoice`, confirming all three mounts coexist. `git diff --check` clean; no scratch schemas left. The UI was not exercised in a real browser.
- Remaining handoffs:
  1. 13 Member 2/Member 4 test files still list the deleted migration `0000_create_audit_and_config.sql` (deleted in `d0d3cf1`; the file is now `audit_and_config.sql`, whose contents the M1 chain supersedes), so those suites fail at load with `ENOENT`. Their owners should update the reference; it does not affect the mounted production reads or this task's test.
  2. Member 2 can now check off M2-S14 after re-running their harness (with the reference fixed) and confirming the production mount.
  3. Member 2 owns the dedicated My Bookings screen (M2-S21); this summary deliberately stays read-only and embedded in `/account`.
- Lecture concepts applied: none beyond the prior entry — this task is an application/frontend integration over already-validated tables and a read replica of existing reads; no new schema, query, index or transaction design was introduced.

### 8 October 2026 — M1-S10 / M1-S15 registration connection failure follow-up

- Investigated the reported generic registration failure. The running API's empty-input validation returned HTTP 400; registration's existing integration tests passed 3/3. Read-only schema inspection confirmed the current guest/account/audit columns. Successful new registration and invalid-link rejection were reproduced against the application schema with synthetic inputs inside transactions whose COMMIT was replaced with ROLLBACK; no accounts, profiles or audit evidence from these checks persisted.
- Confirmed repeated startup connection timeouts with `backend/src/db.ts`'s two-second PostgreSQL connection limit. Increased it to 15 seconds to allow hosted-database connection negotiation after idle periods. This addresses the observed connection failure; the screenshot alone cannot establish which internal error produced that particular response. Registration validation, identity ownership and transaction rules are unchanged.
- Added `backend/tests/dbConnection.test.ts` and `test:db-connection`: a local TCP proxy delays a real PostgreSQL connection by 2.5 seconds while retaining the original TLS hostname/verification. The former two-second pool rejects the read-only query; the current application pool succeeds. Documented the connection window and verification command in README.
- Verification: `npm run test:db-connection --workspace backend` 1/1; `npm run test:m1-guest-registration --workspace backend` 3/3; `npm run build:backend` and `npm run build:frontend` pass (frontend retains its existing bundle-size warning). The updated production pool's registration handler returned HTTP 201 in the rollback-only check. The development backend reloaded, connected successfully, and returned HTTP 200; the Vite registration proxy returned the expected HTTP 400 validation envelope. `git diff --check` passes.
- Remaining: the user's own successful form submission has not been observed; they can retry without recreating their details. The application migration history lacks `m1_007`; that session-config migration was not needed for these registration checks and was not applied. No SRS/enum/schema contract changed, and existing task checkboxes remain unchanged.
- Lecture concepts used: parameterized queries, transaction atomicity and rollback to keep diagnostic writes from persisting. No automatic write retry was introduced, preserving the existing registration/audit transaction boundary.

## Member 2 — Imandi

### 9 October 2026 — M2-S15 native browser transport correction

- Manual catalogue testing as Chain Manager exposed a persistent connection banner despite authenticated direct `GET /api/room-types?active=all` returning `{"data":[]}`. `RoomAdminApi` stored native `fetch` directly and called it with the API instance as receiver, causing browser failure before a request was sent. Wrapped the default transport to preserve native fetch invocation, matching the existing availability and booking clients; injected transports, cookies, role checks and API payloads remain intact.
- Added a regression for default catalogue reads and amenity saves with a receiver-sensitive fetch replacement. It failed before the fix with the same `NETWORK_ERROR`; all 13 room administration UI tests pass after the fix. `npm run build:frontend` passes. A temporary read-only browser probe reproduced `NETWORK_ERROR` on both native reads before the fix and received server `401 AUTHENTICATION_REQUIRED` afterwards in a separate unauthenticated browser, confirming dispatch and server authentication. Probe files were removed. No database writes or Git publication actions were performed.
- Authenticated create/edit and broader AT-23/AT-24/AT-27 acceptance remain the ongoing manual checks; M2-S15 stays unchecked. No SQL/lecture concepts or contract changes apply to this frontend correction.
- Proposed human commit: `fix(rooms): preserve native fetch receiver in room administration`.
- Proposed PR title: `Fix room administration requests in the browser`. Description: `Room administration failed before sending native browser requests, leaving a connection banner despite a working API. Wrap the default fetch transport and add a receiver-sensitive regression for catalogue reads and amenity saves. Verified with 13 passing UI tests, the frontend build, and before/after read-only browser dispatch checks; authenticated manual acceptance continues.`

### 8 October 2026 — verified reservation integration and complete migration testing

- Room administration and staff/guest reservation create/read/change pages now consume verified AuthProvider sessions. Mounted existing factories with approved Front Desk, own-branch room and guest-ownership middleware; availability remains public. Role-filtered navigation exposes applicable reservation tools.
- Removed deleted-migration references and public-schema fallback from isolated fixtures; retained normalized header/line/assignment and transaction/concurrency contracts. Applied pending operational migrations to the development database after clean-chain verification.
- Verification: all current suites passed within 437/437 tests; complete 37-file production migration chain and idempotent rerun passed; both builds passed. Live Colombo browser availability returned a valid empty result because no active room types/physical rooms are configured. No fictional inventory or prices were created.
- Full owner acceptance and the approved Branch Manager adjustment flow remain handoffs; no additional checklist rows were checked. Lecture concepts: normalized relationships, derived state, parameterized queries and isolated transactions. Details: [QA audit](docs/qa/2026-10-08-bug-fix-audit.md).

### 8 October 2026 — Imandi/dev rename-delete conflict correction

- Rechecked clean Imandi HEAD/remote `211399ebd27ccb2d33acbffdf9d38a68eda6a9ce` and dev/remote `15cdda58588420f09d6b8cd445258a41314f2dc6`. Full Git ORT preview exposed the remaining conflict: Git identifies the prior single memory archive as an 89% rename of `memory.md`, while dev deleted the original. The previous line/content-level conflict claim missed rename detection and is corrected in `conflict_resolution_handoff.md`.
- Replaced the single snapshot with an index at its existing link path and six smaller historical topic files for foundations, Member 2 UI, Member 3, Member 4, verification/database incidents and original context. Checked that every original nonblank note line remains represented in those files; no historical decision or incident was discarded. Active memory remains deleted, and application code/session contracts are unchanged.
- Full ORT candidate-tree preview against the same dev/common ancestor passes with exit 0 and no conflicts, including rename detection. Preview objects and index are isolated under ignored `.scratch/dev-conflict-resolution-2026-10-08/`; no actual Git index/object-store/HEAD/branch writes, staging, commit (including preview commits), merge, push or PR took place. Archive links and `git diff --check` pass. Builds/tests were not rerun for documentation-only changes; no database commands or migrations ran. These fixes remain ordinary working files for the human to publish.

### 7 October 2026 — Imandi/dev conflict preparation (working files only)

- Compared committed Imandi `3e18abf1e552076e198d53b0838b1990c043da24` with remote-verified dev `15cdda58588420f09d6b8cd445258a41314f2dc6`, using common ancestor `b2189c6d285d5ac7ee7b9a3ba079db59ef5ba80c`. The checkout was initially clean with no merge in progress. Read-only conflict inspection identified divergent `RootLayout.tsx` content and dev's `memory.md` deletion versus Imandi's additions. Other shared edits combine without markers.
- Made RootLayout match dev's bare Outlet and moved the existing guest navigation/header into page-owned `GuestBookingLayout`. Both guest booking pages use it; staff room/booking pages use the existing shadcn AppShell through `StaffBookingLayout`, preserving booking links without creating a second root sidebar. Navigation tests now import the guest primitive from its owning layout. Auth session adapters and booking APIs are unchanged; no new member subtask was implemented.
- Honored dev's active memory deletion while preserving the entire Imandi record in `docs/archive/imandi-memory-2026-10-07.md`, clearly labeled historical. Added a fallback note in AGENTS and updated README record links. Current requirements/handoffs/work logs remain active sources. The older database incident record remains preserved and no database commands or migrations are run for this reconciliation.
- Verification and current limitations are recorded in `conflict_resolution_handoff.md`. Changes are ordinary unstaged working files only: no branch/commit/push/PR/staging/merge operation. HEAD/index/refs remain unchanged. GitHub's conflict warning cannot change until the human publishes a resolution.
- Verification passed: zero conflicts across 60 dev-changed paths after LF normalization; combined dev/current frontend TypeScript check in an ignored snapshot; current frontend production build; guest create 20/20, guest read 18/18, staff create 18/18, staff read 16/16, modification 18/18 and room admin 12/12 (102 UI tests); no source markers and `git diff --check`. Existing large-bundle warning remains. No live auth or database behavior was exercised.

### 7 October 2026 — M2-S21 guest My Bookings UI core (partial; protected guest reads pending)

- Added `frontend/src/lib/guestBookingRead.ts`, `frontend/src/components/bookings/GuestBookingReadPanel.tsx` and `frontend/src/routes/GuestBookingRecordsPage.tsx`. Registered list/detail at `/guest/my-bookings` and `/guest/my-bookings/:bookingId`, extended the guest-only shell/navigation to both and connected My Bookings from direct guest navigation. The previous Member 4 cancellation simulator file is preserved, but the production My Bookings route no longer asks for guest identity/booking UUID form inputs or reads the staff API. General authenticated role navigation remains a Member 1 contract.
- Implemented M2-S14's GET-only list/detail contracts with same-origin credentials, a frontend verified-account-kind adapter and no submitted guest/user/branch identity or `x-user-id` header. List groups each booking once with derived line counts, includes own staff-assisted reservations and has bounded pagination. Detail shows all five active/terminal line states, individual dates/guest counts/agreed rates, previous/current room assignments, occupancy times, status history and old/new date/guest/rate values. It projects away guest/staff IDs, NIC/contact fields, branch/condition/internal catalogue metadata and free-text staff notes; needed booking/line/history identifiers remain internal rather than visible labels. Type names are current catalogue values, not historical snapshots, and room rates are not presented as a final bill/payment proof.
- Unknown/other-owner UUIDs use the same safe not-found result, with no private detail left on screen. Malformed/inconsistent responses are rejected. New detail/list reads clear prior display data, token/abort checks reject abandoned late results, and 401/403 clears all private list/detail state and blocks further requests until a new session model. Read/navigation actions include reload/back/previous/next/book-another-stay only. No staff modifications/cancellation/payment are written; Member 4's authenticated guest cancellation quote/confirmation integration remains its action handoff, and this screen provides contact-hotel/eligibility/manual-refund guidance.
- Added an in-memory preview and focused adapter/model/render tests. Verification: `npm run test:m2-guest-booking-read-ui --workspace frontend` **18/18**, `npm run test:m2-guest-booking-ui --workspace frontend` **20/20**, `npx tsc --noEmit -p frontend/tsconfig.json` **passed**, `npm run build:frontend` **passed** via approved Vite/esbuild sandbox escalation (existing >500 kB bundle warning remains), and `git diff --check` **passed**. An initial all-state fixture used an overlong test UUID and was corrected before the passing run. Browser checks passed mixed two-room history with separate dates/rates and 101→103 occupancy/move history; every terminal state; same safe missing/other-owner ID rejection; 20+1 pagination/previous recovery; denial removing records/action controls; 390×844 and 1280×900 no horizontal overflow; real production deep-link gate with no staff navigation. Saved list screenshot; sample makes no database requests or writes.
- Rechecked current SRS FR-027/028/030, FR-081/082/083, IR-UI-01 and §6.1.4 against current M2-S14/schema contracts. Production session remains null until Member 1 guest session/linking and protected M2-S14 mounting; M2-S14 prerequisites and authenticated live AT-15 ownership checks still prevent checking M2-S21 off. Updated README/checklist/memory. No backend/SQL/database/migration runner or database tests were used, no later subtask was implemented, and existing M2-S18–S20 changes were preserved. Proposed Git handoff text is for the human only.

### 7 October 2026 — M2-S20 direct guest booking UI core (partial; guest identity/API integration pending)

- Added `frontend/src/lib/guestBooking.ts`, `frontend/src/components/bookings/GuestBookingPanel.tsx` and `frontend/src/routes/GuestBookingCreatePage.tsx`, registered `/guest/bookings/new` and provided a route-specific guest navigation shell on shared shadcn primitives/design/layout tokens. Reused M2-S16's search/selection with no immediate-check-in toggle; each line retains its own dates, guest count and catalogue rate within one chosen branch. Native date input events update the shared model correctly; existing staff behavior remains covered by regression tests.
- Implemented M2-S13 quote/create payloads with same-origin credentials and Member 1-supplied mutation headers. Guest/actor IDs and channel are never form inputs or client authority; the backend derives account ownership and DIRECT_ONLINE. A frontend `accountKind` discriminator is only an adapter seam, not a new authentication provider/database enum. Response projection drops guest/actor/NIC/contact and unrelated metadata. Production identity remains null pending Member 1's real guest linking/session/CSRF integration and protected M2-S13 mounting.
- Quotes show per-line rates/nights/charges and an exact-decimal combined provisional subtotal/service charge/tax/total with published policy terms. Explicit acknowledgement is required, resets after selection edits/stale quote rejection, and must be repeated after a fresh changed-rate/policy quote. All-line conflict errors preserve the draft, refresh every selection and explain that no part was created. Confirmation requests are never replayed or aborted; network/server/malformed-success uncertainty blocks another submission and directs the guest to the hotel. Duplicate submits and abandoned late responses are suppressed. Session denial clears draft/quote/receipt data. Success shows one reference, every agreed line and the server's authoritative DRAFT total. No online payment is taken; cash or verified bank transfer is arranged with the hotel.
- Added in-memory fixture/preview and focused adapter/model/render tests. Verification: `npm run test:m2-guest-booking-ui --workspace frontend` **20/20**, `npm run test:m2-availability-ui --workspace frontend` **15/15**, `npm run test:m2-staff-booking-ui --workspace frontend` **18/18**, and `npm run build:frontend` **passed** using approved Vite/esbuild sandbox escalation (existing >500 kB bundle warning remains). Browser verification passed two separately dated rooms under one reference; a changed Single rate plus same-effective-date policy correction requires a new quote and acknowledgement before confirming the new exact total; one-room conflict rejects the entire booking and retains/marks the unavailable selection; production session gate has no staff navigation; receipt layouts at 390×844 and 1280×900 have no horizontal overflow. Saved screenshot evidence; sample makes no database/payment requests.
- Rechecked SRS FR-025–034, FR-081/082/083, IR-UI-01, §4.7.4 and §6.1.4 against the current implementation/contracts. M2-S20 remains unchecked until M2-S13 and Member 1 guest identity/CSRF/protected mounting allow authenticated live creation and ownership verification. General role-aware navigation remains Member 1's integration; guest history is M2-S21 and was not implemented. Updated README/checklist/memory. This slice changes no backend/SQL/database records and runs no migration runner or database tests. Commit/PR text is handoff text for the human only.

### 7 October 2026 — M2-S19 staff room-line modification UI core (partial; protected API/session integration pending)

- Added `frontend/src/lib/staffBookingModification.ts`, `frontend/src/components/bookings/StaffBookingModificationPanel.tsx` and `frontend/src/routes/StaffBookingModificationPage.tsx`. Registered `/bookings/:bookingId/edit` and connected M2-S18's verified detail to the editor. The null production session seam requires Member 1's real FRONT_DESK branch/CSRF adapter; no role/actor/branch authority is supplied by form fields or storage.
- Implemented separate add, BOOKED change and BOOKED/CHECKED_IN move flows with per-line dates/guests, fresh server catalogue/availability rates and explicit review/acknowledgement. A change reads its currently assigned type through M2-S07 rather than misusing public availability, which correctly excludes its own reserved room. Confirmation consumes M2-S12's existing POST/PATCH payloads exactly, and the server remains responsible for atomic inventory/state/rate rechecks and saved-policy DRAFT invoice refresh. A checked-in move uses READY targets and preserves dates, guest count and agreed rate; this Front Desk UI always sends a null adjustment because non-zero differences require Branch Manager authority. No manager-read or approval contract was invented.
- Reused M2-S18's full line/assignment/status/revision display to keep unaffected lines and old values queryable. Rejected changes preserve draft and original records and explain rollback; state/concurrency conflicts require reload/review. Mutation requests are never automatically replayed. Unknown network/server/malformed-response outcomes block further submissions until a fresh booking read and explicit booking/invoice reconciliation. Late read/search/rate responses and duplicate confirmation cannot replace or replay a pending operation; denied reads/writes clear booking/draft/result data. A committed response remains available when its subsequent history refresh fails. Invoice credits direct staff to Member 4's manual refund workflow, and cancellation navigates to `/cancellation` without writing a cancellation or deleting a line.
- Added a strictly in-memory dev preview (`frontend/tests/staff-booking-modification-preview.html`), fixtures, adapter/model tests and server-rendered panel tests. Verification: `npm run test:m2-booking-modification-ui --workspace frontend` **18/18**, `npm run test:m2-staff-booking-read-ui --workspace frontend` **16/16**, `npm run build:frontend` **passed** (Vite/esbuild required the approved sandbox escalation; existing >500 kB bundle warning remains). Browser checks passed for checked-in 103→105 moves with 101/103 preserved and unchanged second line; BOOKED date revisions; adding a third independently dated line; conflict/unknown/denied states; sample credit; production session gate; 390×844 and 1280×900 layouts without horizontal overflow. Native date input events are handled so reviewed dates match visible edits.
- Rechecked SRS FR-025/027/028/030/031/034 and §6.1.4 against the UI and M2-S12 contracts. M2-S19 remains unchecked because M2-S12 and Member 1's production session, CSRF and protected read/catalogue/modification mounting are pending; authenticated live changes and Branch Manager non-zero adjustment integration remain owner handoffs. Updated README/checklist/memory. This slice changed no backend/SQL or database records and executed no migration runner or database tests; later Member 2 tasks were not implemented. Git commit/PR text is proposed for the human only.

### 7 October 2026 — M2-S18 staff booking list/detail UI core (partial; authenticated API mounting pending)

- Added `StaffBookingRecordsPage` at `/bookings` and `/bookings/:bookingId`, the staff-records navigation link, `StaffBookingReadScreen`/`StaffBookingReadPanel`/`StaffBookingDetailPanel`, and `staffBookingRead.ts`. Reused the current shadcn Card/Button/Badge primitives, PageContainer/BoundedContainer, Mono semantic tokens and one/two/three-column responsive grids. Deep detail URLs and back/reload actions are supported; list entries aggregate each booking once and show per-line counts and clearly derived mixed progress, never a stored header status.
- Implemented only M2-S11's existing GET contracts: bounded `limit`/`offset` list and UUID detail reads with same-origin credentials and no actor, role or branch headers/query overrides. The verified-session seam returns null until Member 1 provides real FRONT_DESK branch identity. New session/client instances start with empty state; unmount/change cancellation and response tokens prevent old requests from restoring prior selections. Every detail assignment is defensively checked against the verified branch, while list authorization remains the server's responsibility. The browser DTO drops NIC/contact and unrelated server fields rather than displaying or retaining them; no backend DTO was changed.
- Rendered all current and terminal room lines with exact agreed rate strings, separately dated stays/guest counts, status, current assignment and derived checked-in occupancy. Full assignment history includes old/new rooms, assignment/release decisions and actual occupancy start/end. Status history shows actor/time/reason; value revisions show before/after dates, guest counts and agreed rates. Timestamps display in Asia/Colombo. Type/capacity/active/physical-condition values are explicitly current catalogue facts; historical assignments and rate snapshots are not reinterpreted against a later capacity reduction.
- Added loading, empty, bounded pagination, not-found/branch-denied, failed-read and reload states. Selecting/reloading a detail clears its previous content before requesting; 401/403 clears both list and detail, and unknown/out-of-branch IDs use the same safe 404 message. A deep-link change hides the previous detail while loading. No booking, room, guest, payment, cancellation or checkout write is provided by this screen.
- Verification passed: `npm run test:m2-staff-booking-read-ui --workspace frontend` 16/16; `npm run test:m2-staff-booking-ui --workspace frontend` 18/18; `npm run build:frontend` (2001 modules; existing large-bundle warning). Initial sandbox filesystem denial from Vite/esbuild was resolved by an approved rerun. Browser sample checks verified one multi-room header, distinct line dates/rates, room 101→103 assignment/occupancy history, old/new rate/date revision evidence, denial clearing records, 20+1 pagination, empty and missing-record recovery, and 390px/1280px layouts with no horizontal overflow. The real production detail URL resolves and shows its missing-session gate. `/tests/staff-booking-records-preview.html` uses only an in-memory read transport and is outside the production router/build.
- M2-S18 stays unchecked because M2-S11 is still formally incomplete and its protected router remains unmounted pending Member 1 M1-S08/S09 verified session/branch middleware. Authenticated live acceptance is still required after that handoff. No backend code, SQL migration or application/public database data changed, no database test/runner was executed, and no later subtask was implemented.

### 6 October 2026 — M2-S17 staff multi-room booking-create UI core (partial; production integration pending)

- Added `/bookings/new` and its shadcn navigation link, `StaffBookingCreatePage`, `StaffBookingScreen`/`StaffBookingPanel` and the separate `staffBooking.ts` API/model. Reused M2-S16 availability, selection snapshots and the existing layout/design primitives. Search choices are restricted to the verified Front Desk branch; all lines must share it and satisfy individual dates/capacity and half-open overlap validation. Removing an unconfirmed line edits only the local draft, not a persisted booking.
- Implemented the existing M2-S10 `POST /api/bookings/quote` and `POST /api/bookings` payload/response contracts. Requests use same-origin credentials and an opaque mutation-header callback supplied by Member 1's future session/CSRF adapter; no actor/role/branch override is submitted. The production verified-session seam returns null and performs no requests. Quotes contain only room criteria; confirmation sends the primary guest, staff channel, quoted policy ID and server-provided type/rate echoes. The primary guest currently comes from an existing record ID, with no invented Member 1 guest-search or guest-create endpoint.
- Displayed each quoted room's dates, occupants, capacity, nightly base rate and reserved-night amount; summed an exact decimal provisional room subtotal, then separately rounded percentage service charge and tax in SRS §4.7.4 order. Discount is zero at creation and subsequent service/flat fees are excluded. Policy version/effective/publication details and fee/grace terms are shown for review; persisted server invoice totals remain authoritative.
- Added explicit quote acknowledgement/confirmation, quote invalidation on selection changes, acknowledgement reset on guest/channel changes, stale-response rejection and refusal of inconsistent server DTOs, including differing rates for the same room type. Catalogue/policy changes retain the draft and require another quote and review. Inventory/concurrency conflicts recheck every original room line and refresh the current search without retrying creation. In-flight creation locks mutations and duplicate clicks; network/server/invalid-success uncertainty blocks blind retries and instructs staff to check booking records. Success shows one booking reference, all agreed BOOKED lines and one DRAFT invoice.
- Verification: `npm run test:m2-staff-booking-ui --workspace frontend` passes 18/18, covering mixed-type and same-type rooms, exact rounding boundaries, branch/capacity/date validation, actual payloads, quote freshness, review, failures, late responses and duplicate/unknown outcomes. `npm run test:m2-availability-ui --workspace frontend` passes 15/15 for the shared panel/model. `npm run build:frontend` passes; the first sandbox Vite filesystem denial was resolved by an approved rerun and the existing large-bundle warning remains. Browser checks used the development-only in-memory `/tests/staff-booking-preview.html`: independently dated Single+Double quote, changed policy/rates with renewed acknowledgement, successful two-room confirmation, inventory rejection with automatic refresh and retained flagged lines, 390px/1280px layouts with no horizontal overflow, and the real production page's missing-session gate. The sample is outside the production router/build and makes no database requests.
- M2-S17 remains unchecked because its M2-S10 prerequisite is still formally incomplete: Member 1 must implement verified session/role/branch context and CSRF integration and mount the protected booking route factory before authenticated live acceptance. No backend code, migration or application/public database data changed, and no later member task was advanced.

### 6 October 2026 — M2-S16 public availability search and multiple-room selection

- Replaced the `/rooms` placeholder with `AvailabilitySearchScreen`/`AvailabilityPanel`, using the existing PageContainer/BoundedContainer and shadcn Button/Card/Input/Label/Badge/FormField primitives, semantic design tokens and responsive one/two/three-column grids. Staff and direct online guests share public hotel-inventory search; this screen performs no identity, quote, booking, cancellation or payment write.
- Added a validated GET-only availability client and separate selection model. Criteria include active branch, individual arrival/departure dates, guests for that room, optional room type and READY-only immediate-check-in filtering. Results show room type, capacity, amenities, physical condition and exact LKR catalogue rates; future CLEANING inventory is explained separately from immediate check-in. Changing fields invalidates previous results and late/cancelled responses cannot overwrite newer searches.
- Running selection preserves every room's own criteria/rate independently, permits adjacent intervals for the same room, refuses duplicate/overlapping same-room lines and mixed branches, and exposes add/remove/clear and per-line recheck. Removal affects an unconfirmed local draft only. Rechecks preserve lines while marking unavailable inventory, changed type/capacity/rate or failed verification; selection counts show lines, guests across lines and room nights. No combined policy quote or booking confirmation was added.
- Added public `GET /api/availability/options` to the already mounted availability router: active branch IDs/names/cities and active type IDs/names only, read under one repeatable-read/read-only transaction. It exposes no staff/guest records or admin metadata, accepts no query overrides and leaves Member 1's branch tables/APIs unchanged. Extended the existing M2-S09 isolated database/API suite to verify active-only choices and exact projected fields. No migration or application/public database writes were performed.
- Extended the reused FormField's props to React.FormHTMLAttributes so the form can use noValidate and show its own accessible field-specific date/capacity messages. Fixed the new client's default native-fetch receiver after the live browser check exposed an invocation failure; added a regression test. Reused the running frontend on port 5173, stopped the extra development server on 5174, and started the backend on 4000 for read-only endpoint verification.
- Verification passed: `npm run test:m2-availability-ui --workspace frontend` 15/15; `npm run test:m2-availability --workspace backend` 1/1 with isolated temporary schema cleanup; `npm run test:m2-room-admin-ui --workspace frontend` 12/12; `npm run build:backend`; `npm run build:frontend`. The frontend build retains the existing bundle-size warning; its initial sandbox filesystem denial was resolved by an approved rerun. Browser checks covered form validation, two independently dated/capacity-limited rooms, retained selection, unavailable-room and changed-rate rechecks, immediate READY/capacity empty results, and 390px/1280px layouts without horizontal overflow. Real public options and Vite proxy were read successfully; the configured database currently has no active room types, so real room search uses its empty state and multi-room interactions use the development sample fixture.
- M2-S16 is checked because its M2-S09 prerequisite and search/selection acceptance checks pass; public availability itself has no authentication dependency. Production staff/guest authentication, quote/confirmation integration and draft handoff belong to later tasks and remain pending. Selection exists only while the page is open and is explicitly labelled unreserved. No subsequent member subtask was implemented.
- Lecture concepts applied: selection/projection of active public catalogue data, consistent read-only transactions across branch/type queries and exact numeric rate strings; reuse of parameterized availability and the normalized per-room line model. No extra index or stored availability flag was introduced.

### 6 October 2026 — M2-S15 room catalogue and branch inventory administration UI core (partial; production auth pending)

- Added `/admin/rooms`, `RoomAdministrationPanel` and `roomAdministration.ts` using the existing shadcn Button/Card/Input/Label/Badge/FormField primitives and documented containers, semantic tokens and responsive grids. The management navigation links to the page; the existing root shell now stacks on mobile and allows its content to shrink without horizontal overflow.
- Added create/edit/activate/deactivate for room types, amenities and rooms; amenity selection for types; room detail, dated block create/edit/remove with removal confirmation; and separate audited physical-condition changes through Member 3's M3-S18 endpoint. Only Chain Managers can edit shared catalogues, only own-branch Branch Managers can edit rooms/blocks, and only own-branch Branch Managers/Service Staff can change physical condition. Unknown actors cannot load records or write; branch changes discard drafts/selected details, and foreign-branch inventory is filtered from the display.
- The API adapter sends same-origin requests with credentials, never role/branch/actor overrides, preserves decimal rate strings and validates capacity, names, UUIDs, descriptions, reasons and real half-open date intervals. Server failures stay visible, rejected edits preserve drafts and successful writes refresh records. A failed post-save refresh is reported separately. M3 condition conflicts fetch current own-branch room details to explain affected reservations.
- Extended catalogue conflict responses with active assigned booking lines for capacity reduction/type deactivation, using a parameterized join after the existing type lock and before mutation; existing database triggers remain authoritative. The catalogue regression also checks unchanged rejected rows, successful safe capacity changes and preserved rate snapshots. No migration or application/public database update was performed.
- Verification: `npm run test:m2-room-admin-ui --workspace frontend` 12/12; `npm run test:m2-catalogue-api --workspace backend` 1/1; `npm run test:m2-room-api --workspace backend` 1/1; `npm run build:backend` and `npm run build:frontend` passed. Build retains the existing Vite bundle-size warning. Local browser checks used the committed development-only in-memory fixture and confirmed retained capacity/block conflict drafts, affected booking/line details, safe capacity/block refresh and condition-conflict presentation. Responsive checks covered 390px and 1280px viewports with no horizontal overflow. Initial Vite filesystem and database-network sandbox failures were resolved by approved reruns.
- M2-S15 stays unchecked because M2-S07/S08 still await Member 1's production staff session/role/branch/audit integration. The production page's session seam returns no identity and the catalogue/inventory/M3 condition route factories remain unmounted; Member 1 must provide the verified frontend session/CSRF contract and mount those routes before authenticated end-to-end AT-23/AT-24/AT-27 acceptance can pass. No other member's implementation task was advanced.
- Lecture concepts applied: parameterized SQL joins and projection to explain affected normalized room lines; transaction rollback for refused catalogue changes; existing locks and integrity triggers as the final concurrency protection. No extra index or duplicated booking/room data was introduced.

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

### 8 October 2026 — production mounting and migration-suite repairs

- Mounted existing check-in, active-stay, service catalogue and room-condition APIs with verified role/branch context. Catalogue/usage UI now uses the authenticated role and same-origin cookie. Unexpected catalogue errors return a generic message.
- Removed stale migration exclusions and expected failures from baseline/check-in/lifecycle fixtures. Complete ordered migrations run in isolated schemas; no published mock migration keys or operational contracts were replaced.
- Verification: current operational/negative/concurrency suites passed within 437/437 tests; production mounting/authorization checks and both builds passed. Earlier blockers are superseded only where the audit provides evidence; full owner acceptance remains unchanged.
- Lecture concepts: transactional line/occupancy/history consistency and schema isolation. Details and proposed human Git handoff: [QA audit](docs/qa/2026-10-08-bug-fix-audit.md).

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

### 8 October 2026 — billing client and isolated-suite fixes

- Billing, payment, checkout, cancellation and no-show clients use relative same-origin API URLs. Removed obsolete demo identity-header guidance; verified cookies supply production identity. Unexpected invoice failures no longer return database details.
- Repaired dependency ordering/deleted migration references, cancellation router database injection and environment precedence so explicit test URLs are honored. Removed public fallback; retained existing payment/refund, immutable invoice, cancellation and checkout contracts.
- Verification: current transaction/API/UI tests passed within 437/437 tests; both builds passed. Independent two-room report reconciliation proves invoice/payment/refund/FINAL revenue facts count once. Guest invoice/payment reads remain available through the account summary.
- Authenticated guest cancellation UI and full owner acceptance remain handoffs. Lecture concepts: independent financial aggregates, transaction/lock consistency and schema isolation. Details: [QA audit](docs/qa/2026-10-08-bug-fix-audit.md).

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

### M4-S16: Build staff per-line or whole-booking cancellation UI

**Date:** 2026-10-06
**Status:** ✅ Completed

**Implementation Details:**
- **ViewModel (`cancellationViewModel.ts`)**: Created view models for both `/cancellation-quote` and `/cancel` REST endpoints. Added user-friendly parsing for cancellation errors like `CANCELLATION_DEADLINE_PASSED` and `NOT_ALL_LINES_ELIGIBLE`.
- **CancellationPanel (`CancellationPanel.tsx`)**: Built the user interface to orchestrate the cancellation quotes.
  - Implemented dynamic inline quote expansion allowing staff to review flat fees and cutoff deadlines before confirming cancellation.
  - Supports whole-booking cancellations strictly when all lines are eligible (i.e. status is `BOOKED`).
  - Displays inline rejection reasons seamlessly if a specific line is past the cutoff deadline or already manipulated.
- **CancellationPage (`CancellationPage.tsx`)**: Created the `/cancellation` route. Coordinates lookup by booking UUID, lists active lines grouped appropriately, triggers view models, and shows success fee feedback upon confirmation.
- **Testing (`m4CancellationUi.test.ts`)**: Implemented view model error mapping unit tests with complete coverage.
- **Build Checks**: Rebuilt frontend components to assert no UI or TypeScript breaks.

**Acceptance Verification:**
- Policy eligibility, fee display and confirmation: ✅ Verified via the quote inspection logic rendered inside `CancellationQuoteBox`.
- Unaffected lines preserved: ✅ Verified. ActiveStay view models list only `BOOKED` for eligibility.
- Denied/cancelled states pass: ✅ Rejections handled visually with a specific red inline warning block showing the `rejection_reason`.
- Frontend build passes: ✅ Verified.

**Git Handoff Text:**
```text
feat(cancellation): M4-S16 implement staff cancellation UI

Builds the CancellationPage and CancellationPanel to orchestrate per-line
and whole-booking cancellation. Features include:
- Integration with quote endpoints to show pre-cancellation flat fees
- Inline confirmation dialogs to prevent accidental cancellations
- Dynamic evaluation of whole-booking cancellation eligibility
- Graceful error mapping for cutoff deadlines and unauthorized actions

Related: M4-S11
```

### M4-S17: Build staff per-line no-show UI

**Date:** 2026-10-06
**Status:** ✅ Completed

**Implementation Details:**
- **ViewModel (`noShowViewModel.ts`)**: Created view models mapping the `/no-show-quote` and `/no-show` REST endpoints. Integrated logic to translate backend error codes (e.g., `EARLY_NO_SHOW_NOT_ALLOWED`) into intuitive UI messages.
- **NoShowPanel (`NoShowPanel.tsx`)**: Built the primary no-show management UI.
  - Added a "Check Cutoff" mechanism for staff to view exact deadlines and flat fees dynamically via the quote endpoint before committing a no-show.
  - Implemented early transition feedback indicating when a no-show action is denied because the deadline has not passed.
  - Ensured only `BOOKED` lines are eligible for transition.
- **NoShowPage (`NoShowPage.tsx`)**: Created the `/no-show` route to lookup bookings, fetch statuses from active stay endpoints, orchestrate the no-show REST actions, and bubble up confirmation success feedback.
- **Testing (`m4NoShowUi.test.ts`)**: Automated tests verifying error code translation mechanisms for the UI layer.
- **Build Checks**: Rebuilt frontend components seamlessly.

**Acceptance Verification:**
- Cutoff feedback and confirmation: ✅ Verified. The quote inspection block displays `cutoff_deadline` clearly and blocks the action if it's too early, exposing `rejection_reason`.
- Surviving lines unaffected: ✅ Active stay merging preserves other statuses safely.
- Early/repeated transition states handled: ✅ The rejection handling (`quote.is_eligible === false`) displays early attempt feedback.
- Frontend build passes: ✅ Verified.

**Git Handoff Text:**
```text
feat(no-show): M4-S17 implement staff no-show UI

Builds the NoShowPage and NoShowPanel to orchestrate per-line
and whole-booking no-show transitions. Features include:
- Strict integration with quote endpoints to enforce cutoff deadlines
- Visual rejection blocks for early no-show attempts
- Inline confirmation flows highlighting the flat fee to be charged
- Graceful error mapping for unauthorized actions and line state mismatches

Related: M4-S12
```

### M4-S18: Add online own-booking per-line/whole cancellation controls

**Date:** 2026-10-06
**Status:** ✅ Completed

**Implementation Details:**
- **GuestBookingsPage (`GuestBookingsPage.tsx`)**: Built a simulated online guest "My Bookings" UI at `/guest/my-bookings` to provide a dedicated view for M4-S11's cancellation logic.
  - Provided a simulator form to explicitly pass a `x-user-id` (Guest Account UUID) to bypass the unbuilt M1-S08 identity system.
  - Implemented logic orchestrating `GET /api/bookings/:bookingId` directly using the `x-user-id` to verify cross-account blocking by the backend logic.
  - Designed the per-room and whole-booking cancellation blocks invoking the previously established `fetchLineCancellationQuote` and `fetchWholeBookingCancellationQuote` view models.
  - Displayed inline policy messages and denial boundaries using the existing view models.
- **Build Checks**: Rebuilt the frontend safely to confirm component integrity.

**Acceptance Verification:**
- Cross-account denial: ✅ Verified. Supplying an incorrect `x-user-id` results in a direct rejection mapped correctly to the UI.
- Policy messages: ✅ The UI dynamically handles and shows `cancellation_fee` and explicit `rejection_reason` details inside the inline feedback card.
- Frontend build passes: ✅ Verified.

**Git Handoff Text:**
```text
feat(guest-booking): M4-S18 implement online guest cancellation UI

Builds the GuestBookingsPage to fulfill the online guest cancellation
workflow requirements. Provides:
- Guest-scoped context simulation via x-user-id
- Inline verification of cancellation policy fees prior to execution
- Dynamic toggles for both single-line and whole-booking operations
- Robust UI rendering for cross-account denial cases

Related: M4-S11
```

## Member 5 — Thusath

### 8 October 2026 — administration/reporting bug-fix audit

- Repaired distinct current occupancy, normalized booking-branch lookup, signed FINAL billed revenue in Asia/Colombo issue months, independent guest payment aggregation and branch-filtered non-void service totals. Shared parameterized queries drive screens/CSV with matching filters, stable order and pagination. Invalid dates/status/IDs/ranges are rejected; export aliases preserve approved role/branch scope. CSV escapes formula text while retaining signed numeric cells.
- Archived competing audit/config DDL, replaced obsolete booking-header indexes, removed generic financial seeds and added compatible forward repair `m5_004`. Existing view column order/types are preserved. Administration delegates to audited owner operations; configuration initializes registered operational keys. Modified UI uses shadcn primitives/design tokens. Replaced fabricated dashboard room/guest rows with authorized tool links.
- Replaced public-schema M5 tests with isolated full-chain fixtures and actual-cookie production app checks. Verification: full 437/437 tests passed, both builds passed, all 37 migrations apply/rerun cleanly. Two-room/partial-state/price-change/void/payment/refund/DRAFT/FINAL reconciliation and final configuration initialization check passed. Development migrations applied; report views readable.
- Historical room-night occupancy (FR-066/067), detailed historical service attribution (FR-069), full AT-22 boundary fixture, report execution auditing, staff create/role UI and typed policy publication remain owner work. No additional checklist rows were checked solely from this audit.
- Lecture concepts: aggregate independent facts before joining, normalized/historical relationships, parameterized filters, schema-matching indexes and audited transactions. Details, browser evidence and proposed human Git handoff: [QA audit](docs/qa/2026-10-08-bug-fix-audit.md).
