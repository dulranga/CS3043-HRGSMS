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

### 20 September 2026 — M2-S05

- Added `backend/migrations/m2_004_booking_room_assignment.sql` for the approved ER extension. It creates UUIDv7 assignment IDs, required restricted FKs to `booking` and `room`, UTC `timestamptz` assignment events, a close-after-open check and a partial unique index on `booking_id` where `unassigned_at IS NULL`.
- Added `backend/tests/m2Assignments.test.cjs` and `test:m2-assignments`. The isolated chain applies M2-S02 through M2-S05 with minimal Member 1 fixtures, verifies metadata/index shape, retains the first closed row after reassignment, allows a second open row only after the first closes, and rejects duplicate-open, invalid timestamp, missing/null FK and non-v7 ID cases. Restricted booking/room deletion is also checked.
- The focused concurrency case uses two transactions: the second open assignment waits on the first transaction's partial-unique-index entry, then receives SQLSTATE `23505` after the first commits. The test confirmed exactly one open row. Transaction-local search paths are used because the configured endpoint performs transaction pooling; the committed scratch schema required for two-session visibility is removed in `finally`.
- Verification: `npm run test:m2-assignments --workspace backend` passed (2 tests), and the M2-S02 catalogue, M2-S03 booking and M2-S04 room regression commands each passed (1 test). `npm run build:backend`, `node --check backend/tests/m2Assignments.test.cjs` and `git diff --check` passed. No migration was applied to the application schema.
- Remaining handoffs: Member 1's real parent migrations and ordered runner are still required. M2-S06 must enforce active-booking/exactly-one lifecycle behavior, same-room stay-date conflicts and `room.booking_id` synchronization with Members 3/4; M2-S05 intentionally does not add a one-open-row-per-room rule.
- Lecture concepts applied: normalized temporal history, a partial unique B-tree index as an integrity constraint, referential integrity with restricted deletion, and ACID isolation demonstrated through two concurrent transactions.

### 19 September 2026 — M2-S04

- Added `backend/migrations/m2_003_room_inventory.sql` with the approved five-value room-status enum, Table 40's `room` and `room_block` attributes, UUIDv7 checks, active/AVAILABLE defaults, a nullable current-stay `booking_id`, nonblank room numbers, `(branch_id, room_number)` uniqueness, required nonblank block reasons and half-open block intervals enforced by `end_date > start_date`.
- Added restricted room FKs to Member 1's `branch`, M2-S02 `room_type` and M2-S03 `booking`, plus restricted room-block FKs to `room` and Member 1's actor `user_account`. No assignment table, overlap rule, current-pointer trigger, API or UI work was included.
- Added `backend/tests/m2Rooms.test.cjs` and `test:m2-rooms`. The rolled-back test schema creates minimal Member 1 parents, applies M2-S02 through M2-S04 in order, checks column and enum metadata, accepts a null and valid booking pointer, permits the same room number in different branches, and rejects same-branch duplicates, blank values, invalid room states, non-v7 IDs, missing branch/type/booking/room/actor FKs, invalid block intervals and deletion of a room with a block.
- Verification: `npm run test:m2-rooms --workspace backend`, `npm run test:m2-booking --workspace backend` and `npm run test:m2-catalogue --workspace backend` each passed (1 test each). `npm run build:backend`, `node --check backend/tests/m2Rooms.test.cjs` and `git diff --check` passed. The scratch schema rolled back, so the application schema was not modified.
- Remaining handoffs recorded at that time: Member 1 still had to supply matching `branch` and `user_account` migrations in the ordered chain. M2-S05 was pending durable assignments, and M2-S06 still owned assignment overlaps and current-pointer enforcement.
- Lecture concepts applied: candidate/composite uniqueness for branch-scoped room numbers, typed referential integrity with restricted parent deletion, normalized master/event tables, domain checks for valid intervals, and ACID rollback for isolated migration verification.

### 19 September 2026 — M2-S03

- Added `backend/migrations/m2_002_booking.sql` with named booking-channel and booking-status enums, Table 40's `booking` and `booking_status_history` attributes, UUIDv7 PK checks, unique nonblank booking references, valid stay and actual-time ordering, positive guest counts, non-negative finite LKR `numeric(12,2)` snapshots, approved status-transition rows, and restricted FKs to Member 1's guest/user keys and booking history parent.
- Added `backend/tests/m2Booking.test.cjs` and the `test:m2-booking` script. The isolated transaction creates minimal `guest` and `user_account` parent fixtures, verifies schema types and exact enum labels, accepts a valid booking/initial history row, and rejects bad date order, counts, rates, references, UUID versions, enum labels, transitions, guest/actor IDs and history FKs. The first database run exposed SQL `NULL`/`UNKNOWN` behavior in the transition check; requiring the full predicate to be `IS TRUE` fixed it.
- Verification: `npm run test:m2-booking --workspace backend` passed (1 test), `npm run test:m2-catalogue --workspace backend` passed (1 regression test), `npm run build:backend`, `node --check backend/tests/m2Booking.test.cjs` and `git diff --check` passed. Both database tests used scratch schemas and rolled back, so no migration was applied to the application schema.
- Remaining handoffs recorded at that time: the real ordered migration chain still needed Member 1's `guest` and `user_account` tables with matching UUID keys. Booking APIs and operational inserts were deferred until assignment and transaction safeguards were available.
- Lecture concepts applied: typed primary/foreign keys and referential integrity, user-defined enumerated domains, exact fixed-point rate snapshots, check constraints including SQL three-valued logic, normalized status-history events and transaction rollback for isolated verification.

### 18 September 2026 — M2-S01 and M2-S02

- Imandi reported that Members 1, 3 and 4 agree to use Member 2's reservation handoff, delegated the shared value choices, and removed the manual-SQL restriction. Added `member_tasks/m2_s01_reservation_contract.md`; cross-referenced exact status/channel sets and transitions, LKR `numeric(12,2)`, PostgreSQL 18 `uuidv7()`, UTC `timestamptz`, `user_account.user_id` actor FKs, `/api/*` routing and transaction ownership in Member 1/3/4 plans, `member_summary_table.md`, SRS §6.1.4/§6.1.8/Appendix C and `memory.md`. Removed the manual-SQL wording from Member 2's plan and the shared member workflow skill. Other members' own task checkboxes were not changed.
- Created `backend/migrations/m2_001_room_catalogue.sql` for Table 40's `room_type`, `amenity` and composite-key `room_type_amenity`. It enforces UUIDv7 IDs, nonblank names, positive capacity, non-negative finite two-decimal rates, FK integrity and restricted parent deletion. Added a focused Node/PostgreSQL test and `test:m2-catalogue` script.
- Verification: the configured development database reported PostgreSQL 18.6. `npm run test:m2-catalogue --workspace backend` passed (1 test) in a newly created scratch schema inside a transaction; type/length inventory, generated/rejected UUID versions including the nil UUID, rounding, invalid capacity/rates, missing FKs, duplicate/null link and restricted deletion were checked. Test rollback also confirmed its schema did not persist. `npm run build:backend`, `node --check backend/tests/m2Catalogue.test.cjs` and `git diff --check` passed. Rechecked SRS Table 40/§6.1.4/Appendix C against the migration and contract. No catalogue migration was applied to the application schema.
- Remaining handoffs recorded at that time: Member 1's M1-S02 ordered migration runner had to integrate this file; Member 1 still needed to implement the shared identity/system actor contract. Members 3/4 still owned service quantity and billing/payment enum/policy details, and the team needed evaluator review of the physical mapping. M2-S03 and later rows were open when this entry was written.
- Lecture concepts applied: typed PK/FK referential integrity, normalized many-to-many `room_type_amenity`, exact `numeric` rates, and ACID rollback in isolated migration tests. Reservation transaction isolation remains for later M2-S06/M2-S10 work.

## Member 3 — Kulunu

No entries yet.

## Member 4 — Chamikara

No entries yet.

## Member 5 — Thusath

No entries yet.
