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

## Member 2 — Imandi

### 29 September 2026 — direct normalized reset through M2-S04

- At Imandi's explicit direction, removed the temporary single-room compatibility implementation rather than retaining it as migration history. This reset was safe because all prior Member 2 database tests used rolled-back scratch schemas and no Member 2 migration had been applied to the application database.
- Rewrote `m2_002_booking.sql` so M2-S03 directly creates the guest/reference/channel-only booking header, multiple separately dated/priced `booking_room_line` rows, five line states and append-only line status/revision histories. It never creates booking-header stay dates, guest count, rate, status, actual occupancy, room pointer or `booking_status_history`.
- Rewrote `m2_003_room_inventory.sql` so M2-S04 directly creates branch-scoped rooms and dated blocks without `room.booking_id` and with only READY/CLEANING/OUT_OF_SERVICE physical conditions. Removed M2-S05/S06 and all corrective M2-S22–S27 migrations/tests/scripts so the active Member 2 chain stops at M2-S04 as requested; those later tasks are pending or retired in the checklist.
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

No entries yet.

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

## Member 5 — Thusath

No entries yet.


