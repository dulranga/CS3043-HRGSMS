# Member 3 — Kulunu: check-in, active stay and services

Planning checklist, not evidence of implementation. Each `M3-Sxx` is one independently reviewable human-commit unit. Member 3 owns `service`, `service_usage` and `room_status_history` (SRS Table 40), not Member 2's booking/room tables or Member 4's checkout orchestration.

## Workflow for each subtask

1. Follow the shared `skynest-member-task-workflow` skill. Read `AGENTS.md`, `README.md`, `memory.md`, `member_work_log.md`, this file, `member_summary_table.md`, and SRS §4.5–§4.6/§6.1. Reinspect the current schema/code and Member 1's actor/auth, Member 2's assignment/status and Member 4's checkout contracts before each item.
2. Review the SRS §6.1.4 working UUIDv7, exact service price/quantity, actor-FK and timestamp mappings with affected owners (Appendix C); do not treat proposed domains as approved until handoff. Agree on who writes booking and room histories in each transition; do not duplicate another member's migration or quietly invent an enum label.
3. Implement only the listed slice and focused tests. Apply migrations to a clean temporary PostgreSQL database; test failed transactions and invalid states. Run `npm run build:backend` for API/SQL integration and `npm run build:frontend` for UI, both when needed. Add a focused test command if absent.
4. Recheck the SRS and affected code; record evidence under Member 3 in `member_work_log.md`, update `memory.md` only for durable decisions, mark the checkbox only when done, and provide a human-ready commit message and PR description. Agents do not branch, commit, push or create PRs.

## Ordered commit-sized subtasks

| Status | ID | Deliverable and completion check |
|---|---|---|
| [ ] | M3-S01 | Publish the multi-room check-in/physical-condition/service handoff: per-line transitions, READY/CLEANING/OUT_OF_SERVICE, actor IDs, actual occupancy segments and who writes each history row. Done when Members 2/4 agree on lock/transaction boundaries and no pointer or stored OCCUPIED state is assumed. |
| [ ] | M3-S02 | Create `service` catalogue per Table 40 with reviewed non-negative LKR `numeric(12,2)` price and active state. Done when invalid/negative/overflow prices and duplicate-name policy are tested. Depends on TBD-08 owner review. |
| [ ] | M3-S03 | Create `room_status_history` for physical-condition changes only, with room and actor FKs and restricted history mutation. Done when READY/CLEANING/OUT_OF_SERVICE transitions are logged once, check-in without condition change adds no room-history row, and unauthorized edits/deletes fail. Depends on Member 2's M2-S23 condition contract and Member 1 actor keys. |
| [x] | M3-S04 | Create `service_usage` per Table 40 plus the approved optional `booking_room_line_id` attribution FK, including void and price-snapshot fields. Review the working positive `numeric(10,2)` quantity and non-negative LKR `numeric(12,2)` unit-price snapshot. Room-specific usage must name a CHECKED_IN line of the same booking; booking-wide usage stays explicitly unallocated. Done when cross-booking line FK, fractional/invalid/overflow quantity and price, and void consistency tests pass. Depends on M3-S02, TBD-08 review and Member 2 M2-S24/S06. |
| [x] | M3-S05 | Add chain-wide service catalogue read/write API; only CHAIN_MANAGER may create/edit prices and active state, while FRONT_DESK/SERVICE_STAFF may record usage but not edit the catalogue. Done when active filtering, validation, historical snapshot persistence and AT-24 forbidden writes are tested. Depends on M3-S02 and Member 1 auth. |
| [ ] | M3-S06 | Implement check-in for one selected room line: lock booking/line/assignment/room, require physical READY, set line CHECKED_IN, start its occupancy segment and write line history/audit. Done when another line stays BOOKED, rollback leaves no occupant and check-in adds no duplicate room-history event. Depends on M3-S01/S03 and Member 2 M2-S06. |
| [ ] | M3-S07 | Expose line-specific check-in API with branch/role validation and safe conflict responses. Done when repeated, wrong-line, wrong-branch and invalid-state requests fail. Depends on M3-S06. |
| [ ] | M3-S08 | Add active-stay read API resolving every CHECKED_IN line's current room from open assignments/occupancy view. Done when two rooms display distinctly, future lines do not appear occupied and cross-branch reads fail. Depends on M3-S07. |
| [ ] | M3-S09 | Implement service-usage recording with at least one CHECKED_IN line, same-booking line attribution for room-specific usage and immutable unit-price snapshot taken from the active service's current catalogue price in the same transaction; ignore/reject client-supplied prices. Call Member 4's DRAFT-bill refresh hook using rounded usage amount and reject ordinary writes after FINAL. Done when wrong-line, spoofed-price and later catalogue-price changes do not alter prior charges or silently duplicate invoice totals. Depends on M3-S04, Member 2 line state and Member 4 M4-S05's draft-bill hook; Member 4 M4-S04 may use M3-S04's schema/test fixtures before this feature exists. |
| [ ] | M3-S10 | Expose service-usage record/list API with staff branch scope and validation; allow own-branch FRONT_DESK and SERVICE_STAFF recording as specified in SRS §4.6. Done when inactive service, bad quantity, supplied-price override and wrong-role/branch requests fail. Depends on M3-S09. |
| [ ] | M3-S11 | Add controlled service-usage void operation, preserving the original row and actor/time; refresh Member 4's DRAFT bill after a valid void. Done when repeated voids and unauthorized reversals fail, billing excludes voided charges, any resulting credit is visible, and FINAL invoices reject ordinary later void changes. Depends on M3-S10 and Member 4 charge contract. |
| [ ] | M3-S12 | Build line-specific check-in UI using shadcn primitives. Done when one room can check in while another stays BOOKED, readiness/rejected states and frontend build pass. Depends on M3-S07. |
| [ ] | M3-S13 | Build active-stay detail UI grouped by booking but showing each line's room/status. Done when partial state, branch denial and responsive states pass. Depends on M3-S08. |
| [ ] | M3-S14 | Build chain-wide service catalogue UI. Done when create/edit/active-state controls are CHAIN_MANAGER-only, usage-recording roles cannot edit prices, AT-24 permission states and frontend build pass. Depends on M3-S05. |
| [ ] | M3-S15 | Build service-usage record/list UI with room-line or booking-wide attribution. Done when price snapshot, unallocated label and failed-write messages pass. Depends on M3-S10. |
| [ ] | M3-S16 | Add service-usage void UI with confirmation and retained original row. Done when repeat/forbidden void states pass. Depends on M3-S11/S15. |
| [ ] | M3-S17 | Add integration tests for partial two-room check-in, race/rollback, actual occupancy segments, no duplicate room-history event, cross-booking service attribution, price change and void/history preservation, including M3-S18's direct-condition and checkout transitions. Done when clean DB tests and relevant builds pass; this task must not hide missing earlier unit tests. Depends on M3-S18 for the condition scenarios. |
| [ ] | M3-S18 | Provide the audited physical room-condition change operation for Member 2's room API and Member 4's checkout; implement this appended task before those consumers. Direct changes require own-branch BRANCH_MANAGER or SERVICE_STAFF, while authorized FRONT_DESK checkout may invoke the internal CLEANING transition inside its larger transaction. Reject OUT_OF_SERVICE while current BOOKED/CHECKED_IN assignments remain and write `room_status_history` only for an actual condition change. Done when READY/CLEANING/OUT_OF_SERVICE transitions, no-op/history behavior, wrong role/branch, active-assignment conflict and checkout rollback tests pass. Depends on M3-S03 and Member 2 M2-S06. |

Handoff: expose a tested room-state/history operation for Member 4's checkout, and a stable service-usage/voided-charge contract for Member 4's invoice and Member 5's reports. Member 4 coordinates checkout; Member 3 must not independently implement a second checkout path.

### Member 2 reservation handoff (M2-S01)

Use [Imandi's amended reservation contract](m2_s01_reservation_contract.md): Member 3 owns per-line check-in orchestration and `room_status_history` for physical-condition changes, consumes Member 2's open line-assignment/occupancy lookup and never writes a room booking pointer. Check-in changes only the selected line status/history and starts its actual occupancy segment; physical room condition remains READY unless separately changed. Member 3 supplies the condition/history operation for Member 4's per-line checkout and coordinates checked-in room moves with Member 2. The actor target and UTC `timestamptz` mapping remain. Member 2 corrective migrations/guards and Member 3 implementation/tests remain prerequisites. This handoff does not check off M3-S01.

## Completion notes

When checking a row, add a brief evidence note here and the detailed entry under Member 3 in `member_work_log.md`. No subtasks are marked complete by this plan.

### M3-S01 evidence note - 29 September 2026

Published the target lock order and transaction boundaries in [M2-S01](m2_s01_reservation_contract.md): booking, affected lines, assignments, rooms, then the DRAFT invoice; all multi-room lock sets are sorted by stable UUID keys. The handoff defines per-line check-in, actual occupancy instants, physical-condition history ownership, checkout delegation and rollback behavior, and explicitly excludes the current legacy booking pointer/status guards. M2/M4 confirmation of the proposed ordering remains required, so M3-S01 stays unchecked.

### M3-S02 evidence note - 29 September 2026

Added `m3_001_service_catalogue.sql` and a focused isolated-schema test. The migration creates the chain-wide `service` catalogue with UUIDv7 IDs, nonblank name/category, non-negative finite LKR `numeric(12,2)` price, active state and UTC timestamps; service names are unique per FR-043. The test covers rounding, negative/NaN/overflow prices, invalid UUIDs, blank values, duplicate names, inactive rows and scratch-schema rollback. M3-S02 remains unchecked until the TBD-08 owner review is recorded.

### M3-S03 evidence note - 30 September 2026

Added `m3_002_room_status_history.sql` and a focused isolated-schema test. The migration defines the target `READY`/`CLEANING`/`OUT_OF_SERVICE` condition enum, creates UUIDv7 room-history rows with restricted `room` and `user_account` foreign keys, rejects no-op transitions, indexes room history by room/time, and blocks UPDATE/DELETE mutations through an append-only trigger. M3-S03 remains unchecked until Member 2's M2-S23 room-condition conversion and the shared owner review are complete.

### M3-S04 evidence note - 30 September 2026

Added `m3_003_service_usage.sql` and a focused isolated-schema test. The migration creates service-usage events with UUIDv7 IDs, exact positive `numeric(10,2)` quantities, non-negative LKR `numeric(12,2)` price snapshots, optional room-line attribution, booking/service/actor FKs, booking/time/service indexes, and consistent void metadata. A trigger requires a checked-in line from the same booking for room-specific usage and at least one checked-in line for booking-wide usage. M3-S04 remains unchecked until the TBD-08 owner review and Member 2's final line/checked-in guard contract are recorded.
