# SkyNest shared member work log

Record actual project-task work here for all five members, including partial or blocked outcomes. Under the relevant member section, include the date and task ID, changes made, tests/build commands and results, decisions/handoffs, and remaining work. Do not claim a checklist item complete without acceptance evidence. Do not record secrets or real guest data. Keep durable project decisions in `memory.md` as well.

## Member 1 — Dulranga

No entries yet.

## Member 2 — Imandi

### 26 September 2026 — M2-S24 forward correction for M2-S03

- Preserved the completed `m2_002_booking.sql` migration as historical evidence, as required by SRS §6.6. Added `backend/migrations/m2_006_booking_room_line.sql` to create the normalized per-room booking line with UUIDv7 keys, restricted booking FK, half-open date ordering, positive guest count, exact non-negative LKR `numeric(12,2)` snapshot, five line statuses, timestamps and a booking/status/date lookup index.
- The migration backfills exactly one line from every valid legacy booking, preserving dates, guest count, rate, status and audit timestamps. It deliberately allows multiple lines per booking. Legacy header fields and `booking_status_history` remain until M2-S25/S26/S27 can preserve histories, rekey assignments and safely remove duplication.
- Added `backend/tests/m2RoomLines.test.cjs` and `test:m2-room-lines`. One test applies the complete existing Member 2 migration chain plus M2-S24 in a clean scratch schema; the other upgrades five populated legacy states, verifies one preserved line per booking, adds a second line and rejects invalid date/count/rate/FK/UUID cases.
- Verification: `npm run test:m2-room-lines --workspace backend` passed (2 tests), `npm run build:backend`, `node --check backend/tests/m2RoomLines.test.cjs` and `git diff --check` passed. Tests rolled back their scratch schemas; no application database was changed.
- Remaining handoffs: M2-S25 must add immutable line status/revision history, M2-S26 must rekey assignments and actual occupancy, and M2-S27 must retire duplicated header fields only after consumers migrate. Member 1's real parent migrations and ordered runner remain integration prerequisites.
- Lecture concepts applied: normalization moves repeating room facts to a child relation; PK/FK and CHECK constraints protect entity, referential and domain integrity; exact `numeric` preserves money; the upgrade and tests use transaction rollback so schema/data changes are atomic and leave no scratch state.

### 25 September 2026 — M2-S01 amended handoff confirmation

- Imandi confirmed that Members 1, 3, 4 and 5 agree to the amended multi-room reservation handoff. Updated the M2-S01 contract, Member 2 and Member 1 handoffs, shared ownership summary, SRS §6.1.8/Appendix C and project memory to record that confirmation without claiming implementation or completion of another member's task.
- Verification: read the current SRS, M2-S01 contract, member checklists and legacy migrations; checked the documentation diff and whitespace. No SQL, application code or database state changed, so runtime tests/builds were not run for this documentation-only update.
- Remaining handoffs: Members 2–4 still need a precise lock order, transaction and retry contract before M2-S06; owner-specific Appendix C checks, formal ER/evaluator review and the corrective migrations remain open.

### 20 September 2026 — M2-S06

- Added `backend/migrations/m2_005_assignment_guards.sql`. A non-unique partial `(room_id, booking_id)` index supports open-room checks; assignment writes and booking date/status changes acquire transaction advisory locks derived from room UUIDs. `m2_lock_room_ids(uuid[])` sorts distinct IDs for multi-room operations, and the overlap guard compares active BOOKED/CHECKED_IN stays as half-open PostgreSQL `daterange` values so adjacent stays remain valid.
- Added deferred constraint triggers over `booking`, `booking_room_assignment` and `room`. They validate the final transaction state: every active booking has exactly one open assignment, terminal bookings have none, a CHECKED_IN booking owns its assigned OCCUPIED room pointer, and other bookings own no pointer. Deferral permits coordinated check-in, checkout, cancellation and reassignment writes inside one transaction while rejecting invalid commits.
- Added `backend/tests/m2Guards.test.cjs` and `test:m2-guards`. Direct-write cases reject overlaps, overlapping date edits, invalid pointer/status combinations, missing active assignments and terminal open assignments; adjacent stays and coordinated valid transitions pass. A committed scratch schema and two sessions verify that the second simultaneous overlapping room assignment blocks on the room lock and then receives SQLSTATE `23P01` after the first commits.
- Verification: `npm run test:m2-guards --workspace backend` passed (2 tests). The M2-S02 catalogue, M2-S03 booking, M2-S04 room and M2-S05 assignment suites all passed (5 regression tests total across those commands). `npm run build:backend`, `node --check backend/tests/m2Guards.test.cjs` and `git diff --check` passed. Scratch schemas were rolled back or removed; no migration was applied to the application schema.
- Remaining handoffs: Member 1's real parent migrations and ordered runner are still required. M2-S09/M2-S10 own availability and booking APIs, including capacity/block checks and safe conflict/retry responses. Members 3/4 still own atomic transition procedures, status histories, authorization/audit integration and their separate business gates.
- Lecture concepts applied: half-open interval predicates, supporting partial indexes, deferred integrity checks for atomic multi-table state, transaction-scoped locks, deterministic lock ordering and two-session ACID concurrency verification.

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
