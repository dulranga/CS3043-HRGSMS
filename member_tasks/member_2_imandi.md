# Member 2 — Imandi: rooms, availability and reservations

Planning checklist, not a claim that earlier M2 work was applied. The `M2-Sxx` IDs are new commit-sized planning IDs; reconcile any previous M2-02 discussion against the actual repository before beginning. Member 2 owns `room_type`, `amenity`, `room_type_amenity`, `booking`, `booking_status_history`, `room`, `room_block` and the separately approved `booking_room_assignment` extension. Use SRS Table 40 for ER attributes/types and §6.1.4 for the extension. Never add `booking.room_id`; nullable `room.booking_id` is only the current checked-in pointer.

## Workflow for each subtask

1. Follow the shared `skynest-member-task-workflow` skill. Read `AGENTS.md`, `README.md`, `memory.md`, `member_work_log.md`, this file, `member_summary_table.md`, and the relevant SRS §4.2/§4.4/§6.1 requirements. Reinspect current code/migrations and Members 1, 3 and 4's latest contracts before starting each item.
2. Resolve prerequisites before dependent SQL: Member 1's UUIDv7/actor/guest/branch contract, approved enum labels (TBD-07), decimal policy (TBD-08), timestamp policy (TBD-10), and API prefix (TBD-12). Do not silently choose these. Implement approved SQL in migration files with focused verification, and explain the relevant database concepts in the handoff.
3. Keep each item to its listed slice plus focused tests/docs. Verify migrations on a clean temporary PostgreSQL database; run negative and two-session tests for overlap/transactions. Run `npm run build:backend` for API changes and `npm run build:frontend` for UI changes; both for shared changes. Add focused tests if the repo has no test command.
4. Recheck the affected SRS section and implementation; update Member 2's section in `member_work_log.md` and any durable `memory.md` decision. Mark the checkbox only with evidence and supply a copy-ready human commit message/PR description. Agents must not branch, commit, push or create a PR.

## Ordered commit-sized subtasks

| Status | ID | Deliverable and completion check |
|---|---|---|
| [x] | M2-S01 | Record the reservation contract with Members 1, 3 and 4: enum/status transitions, exact rate type, actor FK, route prefix and assignment/pointer transaction responsibilities. Done when dependencies and ownership are documented; no invented labels or scale. |
| [x] | M2-S02 | Create `room_type`, `amenity` and composite-key `room_type_amenity` per Table 40. Done when keys, FK, capacity/rate checks and duplicate-link tests pass. Depends on migration tooling and type decisions. |
| [x] | M2-S03 | Create `booking` and `booking_status_history` using Member 1's guest/actor keys and approved enums. Done when invalid dates/statuses, guest FK and history FKs are tested; no booking writes until room assignment exists. |
| [ ] | M2-S04 | Create `room` and `room_block` with branch/type/booking FKs, nullable current-stay pointer, branch-scoped room number uniqueness and valid block intervals. Done when invalid FK, duplicate and date tests pass. Depends on M2-S02/S03 and Member 1's branch. |
| [ ] | M2-S05 | Add the approved `booking_room_assignment` migration: UUIDv7 PK, booking/room FKs, assignment timestamps and at most one open assignment per booking. Done when sequential history and duplicate-open tests pass. Depends on M2-S03/S04. |
| [ ] | M2-S06 | Add database-side same-room/date overlap protection and pointer consistency guards with Members 3/4's transition contract. Done when direct invalid writes and two simultaneous overlapping bookings fail, while adjacent stays pass. Depends on M2-S05. |
| [ ] | M2-S07 | Add room-type/amenity catalogue API with validation and staff authorization. Done when CRUD/search responses and forbidden writes are tested. Depends on M2-S02 and Member 1 auth. |
| [ ] | M2-S08 | Add room and room-block API with branch scope. Done when room-number uniqueness, block-date and cross-branch requests are tested. Depends on M2-S04 and Member 1 auth. |
| [ ] | M2-S09 | Add availability SQL/API using open assignments, booking intervals and room blocks—not `room.booking_id` for future reservations. Done when capacity, inactive room, block, adjacent and overlapping-date cases pass. Depends on M2-S06. |
| [ ] | M2-S10 | Add staff booking-create transaction/API with rate snapshot, one open assignment and initial status history. Done when rollback and concurrent same-room conflict tests pass. Depends on M2-S06/S09. |
| [ ] | M2-S11 | Add staff booking list/detail API with branch filtering and assignment-based room lookup. Done when cross-branch reads fail and historical room links survive later reservations. Depends on M2-S10. |
| [ ] | M2-S12 | Add staff booking date/room modification transaction/API. Done when old assignment remains queryable, new one is open, overlap is rechecked and failed changes roll back. Depends on M2-S10. |
| [ ] | M2-S13 | Add online guest booking-create API using the authenticated `guest_account` link, not a submitted `guest_id`. Done when own booking succeeds and spoofed guest IDs fail. Depends on M2-S10 and Member 1 guest auth. |
| [ ] | M2-S14 | Add online guest own-booking list/detail API. Done when guessed booking IDs and other guests' records are denied. Depends on M2-S11/S13. |
| [ ] | M2-S15 | Build room-type/amenity/room/block administration UI with shadcn primitives. Done when branch scope, validation, responsive layout and frontend build pass. Depends on M2-S07/S08. |
| [ ] | M2-S16 | Build availability search UI for staff and online guests. Done when dates/capacity filters and conflict/empty states are tested. Depends on M2-S09. |
| [ ] | M2-S17 | Build staff booking-create UI; keep cancellation/checkout with Member 4. Done when validation, displayed rate and backend conflict handling pass. Depends on M2-S10. |
| [ ] | M2-S18 | Build staff booking list/detail UI with assignment-based room information. Done when branch denial and historical assignment display pass. Depends on M2-S11. |
| [ ] | M2-S19 | Build staff booking date/room modification UI. Done when conflict and rollback responses are clear; frontend build passes. Depends on M2-S12. |
| [ ] | M2-S20 | Build online guest direct-booking UI with no-payment-gateway messaging. Done when it uses account ownership, handles conflict and passes frontend build. Depends on M2-S13. |
| [ ] | M2-S21 | Build online My Bookings list/detail UI with only own-record actions. Done when guessed IDs are denied and frontend build passes. Depends on M2-S14. |

Handoff: Member 3 consumes assignment lookup and current-stay pointer transitions; Member 4 consumes booking/status events and closes assignments on checkout/cancellation/no-show; Member 5 reports from assignment history. Publish tested contracts rather than letting consumers infer them from `room.booking_id`.

M2-S01 working handoff: [reservation contract](m2_s01_reservation_contract.md). Imandi reports that Members 1, 3 and 4 agree to follow Member 2's documented reservation ownership and delegated the shared value choices recorded there and in SRS §6.1.4/Appendix C. Their own M1-S01/M3-S01/M4-S01 checklist items retain separate acceptance checks. The ordered migration runner remains M1-S02 work; M2-S02 SQL can be verified in an isolated schema meanwhile.

## Completion notes

M2-S01 (18 September 2026): Imandi delegated the shared choices and reported agreement from Members 1, 3 and 4. [The reservation contract](m2_s01_reservation_contract.md), their task handoffs, SRS §6.1.4/§6.1.8/Appendix C, summary table and memory now state the selected labels/transitions, rate, UUIDv7, timestamp, actor, route and transaction ownership. Remaining owner-specific/evaluator decisions are identified rather than inferred from the ER.

M2-S02 (18 September 2026): [Catalogue migration](../backend/migrations/m2_001_room_catalogue.sql) creates Table 40's `room_type`, `amenity` and composite-key `room_type_amenity`. `npm run test:m2-catalogue --workspace backend` passed against an isolated PostgreSQL 18.6 schema with rollback; `npm run build:backend` passed. The shared ordered migration runner remains Member 1's M1-S02 integration work; this migration was not applied to the application schema.

M2-S03 (19 September 2026): [Booking migration](../backend/migrations/m2_002_booking.sql) creates the approved booking channel/status enums, `booking` and `booking_status_history`, including UUIDv7, reference/date/count/rate/time, transition and restricted guest/actor/history FK constraints. `npm run test:m2-booking --workspace backend` passed in a rolled-back PostgreSQL 18 scratch schema using minimal Member 1 parent fixtures; `npm run test:m2-catalogue --workspace backend` and `npm run build:backend` also passed. The real ordered chain still depends on Member 1's `guest`/`user_account` migrations, and no booking API/write path was added before M2-S05 assignment support.

When checking a later row, add a brief evidence note here and the detailed entry under Member 2 in `member_work_log.md`.
