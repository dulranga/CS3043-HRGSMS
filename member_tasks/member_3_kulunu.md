# Member 3 — Kulunu: check-in, active stay and services

Planning checklist, not evidence of implementation. Each `M3-Sxx` is one independently reviewable human-commit unit. Member 3 owns `service`, `service_usage` and `room_status_history` (SRS Table 40), not Member 2's booking/room tables or Member 4's checkout orchestration.

## Workflow for each subtask

1. Follow the shared `skynest-member-task-workflow` skill. Read `AGENTS.md`, `README.md`, `memory.md`, `member_work_log.md`, this file, `member_summary_table.md`, and SRS §4.5–§4.6/§6.1. Reinspect the current schema/code and Member 1's actor/auth, Member 2's assignment/status and Member 4's checkout contracts before each item.
2. Confirm approved UUIDv7, enum, decimal, actor-FK and timestamp mappings (SRS Appendix C). Agree on who writes booking and room histories in each transition; do not duplicate another member's migration or quietly invent an enum label.
3. Implement only the listed slice and focused tests. Apply migrations to a clean temporary PostgreSQL database; test failed transactions and invalid states. Run `npm run build:backend` for API/SQL integration and `npm run build:frontend` for UI, both when needed. Add a focused test command if absent.
4. Recheck the SRS and affected code; record evidence under Member 3 in `member_work_log.md`, update `memory.md` only for durable decisions, mark the checkbox only when done, and provide a human-ready commit message and PR description. Agents do not branch, commit, push or create PRs.

## Ordered commit-sized subtasks

| Status | ID | Deliverable and completion check |
|---|---|---|
| [ ] | M3-S01 | Publish the check-in/room-status/service handoff: approved state transitions, actor IDs, assignment lookup and who writes each history row. Done when Members 2/4 agree on transaction boundaries. |
| [ ] | M3-S02 | Create `service` catalogue per Table 40 with exact price type and active state. Done when invalid/negative prices and duplicate-name policy are tested. Depends on approved decimal mapping. |
| [ ] | M3-S03 | Create `room_status_history` with room and actor FKs and restricted history mutation. Done when transition history and unauthorized edit/delete tests pass. Depends on Member 2 room and Member 1 actor keys. |
| [ ] | M3-S04 | Create `service_usage` per Table 40, including `voided`, `voided_at`, `voided_by` and price snapshot fields. Done when FK, quantity/price and void-field consistency tests pass. Depends on M3-S02 and Member 2 booking. |
| [ ] | M3-S05 | Add service catalogue read/write API with staff authorization. Done when active filtering, validation and forbidden writes are tested. Depends on M3-S02 and Member 1 auth. |
| [ ] | M3-S06 | Implement the database check-in transaction using Member 2's open assignment: lock booking/room, validate readiness, set CHECKED_IN/current pointer and write both histories. Done when a failure rolls back every state change. Depends on M3-S01/S03 and Member 2 assignment guards. |
| [ ] | M3-S07 | Expose check-in API with branch/role validation and safe conflict responses. Done when repeated, wrong-branch and invalid-state check-in requests fail. Depends on M3-S06. |
| [ ] | M3-S08 | Add active-stay read API resolving the room from assignment, not from historical assumptions about `room.booking_id`. Done when authorized staff see the stay and cross-branch reads fail. Depends on M3-S07. |
| [ ] | M3-S09 | Implement service-usage recording transaction with CHECKED_IN guard and immutable unit-price snapshot. Done when a later catalogue price change does not alter prior charges. Depends on M3-S04 and Member 2 booking state. |
| [ ] | M3-S10 | Expose service-usage record/list API with staff branch scope and validation. Done when inactive service, bad quantity and wrong-branch requests fail. Depends on M3-S09. |
| [ ] | M3-S11 | Add controlled service-usage void operation, preserving the original row and actor/time. Done when repeated voids and unauthorized reversals fail and billing excludes voided charges. Depends on M3-S10 and Member 4 charge contract. |
| [ ] | M3-S12 | Build check-in UI using shadcn primitives. Done when readiness, rejected-state and frontend-build checks pass. Depends on M3-S07. |
| [ ] | M3-S13 | Build active-stay detail UI. Done when current room/status, branch denial and responsive states pass. Depends on M3-S08. |
| [ ] | M3-S14 | Build service catalogue UI. Done when create/edit/active-state controls respect staff permissions and frontend build passes. Depends on M3-S05. |
| [ ] | M3-S15 | Build service-usage record/list UI. Done when price snapshot display and failed-write messages pass. Depends on M3-S10. |
| [ ] | M3-S16 | Add service-usage void UI with confirmation and retained original row. Done when repeat/forbidden void states pass. Depends on M3-S11/S15. |
| [ ] | M3-S17 | Add integration tests for check-in race/rollback, price change and void/history preservation. Done when clean DB tests and relevant builds pass; this task must not hide missing earlier unit tests. |

Handoff: expose a tested room-state/history operation for Member 4's checkout, and a stable service-usage/voided-charge contract for Member 4's invoice and Member 5's reports. Member 4 coordinates checkout; Member 3 must not independently implement a second checkout path.

### Member 2 reservation handoff (M2-S01)

Use [Imandi's reservation contract](m2_s01_reservation_contract.md) for the agreed transition boundary: Member 3 owns check-in orchestration and `room_status_history`, consumes Member 2's open-assignment lookup, and sets the current `room.booking_id` pointer in the same transaction as booking/room status and history. Member 3 supplies a room-status/history operation for Member 4's checkout and coordinates checked-in room moves with Member 2. The working room/booking states and normal transitions, `user_account.user_id` actor target and UTC `timestamptz` mapping are specified in M2-S01. Member 3 still needs to implement/test the operation, agree on the detailed lock order and define service quantity precision. This handoff does not check off M3-S01.

## Completion notes

When checking a row, add a brief evidence note here and the detailed entry under Member 3 in `member_work_log.md`. No subtasks are marked complete by this plan.
