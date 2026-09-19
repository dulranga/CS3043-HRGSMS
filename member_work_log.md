# SkyNest shared member work log

Record actual project-task work here for all five members, including partial or blocked outcomes. Under the relevant member section, include the date and task ID, changes made, tests/build commands and results, decisions/handoffs, and remaining work. Do not claim a checklist item complete without acceptance evidence. Do not record secrets or real guest data. Keep durable project decisions in `memory.md` as well.

## Member 1 — Dulranga

No entries yet.

## Member 2 — Imandi

### 19 September 2026 — M2-S04

- Added `backend/migrations/m2_003_room_inventory.sql` with the approved five-value room-status enum, Table 40's `room` and `room_block` attributes, UUIDv7 checks, active/AVAILABLE defaults, a nullable current-stay `booking_id`, nonblank room numbers, `(branch_id, room_number)` uniqueness, required nonblank block reasons and half-open block intervals enforced by `end_date > start_date`.
- Added restricted room FKs to Member 1's `branch`, M2-S02 `room_type` and M2-S03 `booking`, plus restricted room-block FKs to `room` and Member 1's actor `user_account`. No assignment table, overlap rule, current-pointer trigger, API or UI work was included.
- Added `backend/tests/m2Rooms.test.cjs` and `test:m2-rooms`. The rolled-back test schema creates minimal Member 1 parents, applies M2-S02 through M2-S04 in order, checks column and enum metadata, accepts a null and valid booking pointer, permits the same room number in different branches, and rejects same-branch duplicates, blank values, invalid room states, non-v7 IDs, missing branch/type/booking/room/actor FKs, invalid block intervals and deletion of a room with a block.
- Verification: `npm run test:m2-rooms --workspace backend`, `npm run test:m2-booking --workspace backend` and `npm run test:m2-catalogue --workspace backend` each passed (1 test each). `npm run build:backend`, `node --check backend/tests/m2Rooms.test.cjs` and `git diff --check` passed. The scratch schema rolled back, so the application schema was not modified.
- Remaining handoffs: Member 1 must supply matching `branch` and `user_account` migrations in the ordered chain. M2-S05 adds durable assignments; M2-S06 enforces assignment overlaps and ensures the nullable room pointer represents only the current checked-in booking.
- Lecture concepts applied: candidate/composite uniqueness for branch-scoped room numbers, typed referential integrity with restricted parent deletion, normalized master/event tables, domain checks for valid intervals, and ACID rollback for isolated migration verification.

### 19 September 2026 — M2-S03

- Added `backend/migrations/m2_002_booking.sql` with named booking-channel and booking-status enums, Table 40's `booking` and `booking_status_history` attributes, UUIDv7 PK checks, unique nonblank booking references, valid stay and actual-time ordering, positive guest counts, non-negative finite LKR `numeric(12,2)` snapshots, approved status-transition rows, and restricted FKs to Member 1's guest/user keys and booking history parent.
- Added `backend/tests/m2Booking.test.cjs` and the `test:m2-booking` script. The isolated transaction creates minimal `guest` and `user_account` parent fixtures, verifies schema types and exact enum labels, accepts a valid booking/initial history row, and rejects bad date order, counts, rates, references, UUID versions, enum labels, transitions, guest/actor IDs and history FKs. The first database run exposed SQL `NULL`/`UNKNOWN` behavior in the transition check; requiring the full predicate to be `IS TRUE` fixed it.
- Verification: `npm run test:m2-booking --workspace backend` passed (1 test), `npm run test:m2-catalogue --workspace backend` passed (1 regression test), `npm run build:backend`, `node --check backend/tests/m2Booking.test.cjs` and `git diff --check` passed. Both database tests used scratch schemas and rolled back, so no migration was applied to the application schema.
- Remaining handoffs: the real ordered migration chain needs Member 1's `guest` and `user_account` tables with matching UUID keys. Booking APIs and operational inserts remain deferred until M2-S05 provides `booking_room_assignment`; capacity, room overlap and exactly-one-open-assignment rules belong to the later assignment/transaction tasks.
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
