# Member 1 — Dulranga: identity, guests and shared foundations

Planning checklist, not evidence that any task is implemented. Each `M1-Sxx` is intended to be one independently reviewable human commit. The approved stack is `README.md`; the ER types are in SRS Table 40. Member 1 owns `branch`, `role`, `user_account`, `officer`, `guest`, `guest_account`, `audit_log` and `system_config`. Do not add staff role/branch columns to `user_account` or treat `guest_account` as optional for an online guest.

## Workflow for each subtask

1. Follow the shared `skynest-member-task-workflow` skill. Read `AGENTS.md`, `README.md`, `memory.md`, `member_work_log.md`, this file, `member_summary_table.md`, and the relevant SRS §4/§6.1 requirements. Reinspect current files, migrations and teammates' confirmed contracts immediately before editing.
2. Check prerequisites below. Resolve relevant SRS Appendix C decisions with affected owners before irreversible DDL; document the answer. Keep the change limited to one row's deliverable and its tests/docs. Coordinate shared-table edits with consumers.
3. Run the new/affected automated tests against a clean temporary PostgreSQL database when database behavior changes. Run `npm run build:backend` for API work and `npm run build:frontend` for UI work; run both for shared changes. If a test command does not yet exist, add focused tests as part of the subtask or report the gap—do not claim an unrun test passed.
4. Recheck the SRS section and current code; update Member 1's section in `member_work_log.md` and any durable `memory.md` decision. Mark the task complete only with evidence, and give the human a copy-ready commit message and PR description. Agents must not create a branch, commit, push or PR.

## Ordered commit-sized subtasks

| Status | ID | Deliverable and completion check |
|---|---|---|
| [ ] | M1-S01 | Publish the shared UUIDv7/PostgreSQL-version, timestamp, `NIC`, guest-link cardinality and actor-FK contract with Members 2–4 (TBD-09–TBD-11). Done when the SRS/member handoff states exact choices and tests to enforce them; no schema guesses. |
| [ ] | M1-S02 | Add a repeatable ordered migration/test-database workflow for the existing Express/PostgreSQL repo. Done when a clean temporary DB can apply migrations and run one smoke assertion; do not alter unrelated schema. |
| [ ] | M1-S03 | Create `branch` and `role` per Table 40, with approved keys/constraints and minimal fictional seed data. Done when clean migration and invalid/duplicate-key tests pass. Depends on M1-S01/S02. |
| [ ] | M1-S04 | Create `user_account` and shared-key `officer` with approved role/branch FKs. Done when PK/FK, role/branch and deactivation tests pass. Depends on M1-S03. |
| [ ] | M1-S05 | Create `guest` and `guest_account` with approved link uniqueness/nullability and protected `NIC` mapping. Done when valid links work and duplicate/takeover-prone links fail. Depends on M1-S04. |
| [ ] | M1-S06 | Create `audit_log` and its controlled append/read contract. Done when actor FKs, sensitive-value redaction and ordinary-user update/delete denial are tested. Depends on M1-S04. |
| [ ] | M1-S07 | Create `system_config` current-value storage and an audited update/read contract; resolve effective-date history policy first (TBD-15). Done when invalid updates roll back and history behavior is tested. Depends on M1-S06. |
| [ ] | M1-S08 | Implement staff/guest login, logout and session expiry in Express using hashed passwords. Done when disabled users, wrong credentials, cookie security and audit events are tested. Depends on M1-S04/S06. |
| [ ] | M1-S09 | Add staff role/branch authorization middleware. Done when cross-branch and forbidden-role requests fail server-side even if a UI route is called directly. Depends on M1-S08. |
| [ ] | M1-S10 | Add online guest registration and verified `guest_account` linking. Done when an existing guest cannot be claimed without proof of contact/identity control and a guest session gains no `officer` powers. Depends on M1-S05/S08. |
| [ ] | M1-S11 | Add staff guest-profile create/search/update API with duplicate checks and masked `NIC`. Done when validation, search privacy and branch permissions are tested. Depends on M1-S05/S09. |
| [ ] | M1-S12 | Add online guest own-profile API and shared ownership guard. Done when guessed guest IDs and cross-account updates are rejected. Booking/payment history endpoints wait for Members 2/4 and can be a later small integration change. Depends on M1-S10. |
| [ ] | M1-S13 | Add staff-account administration API (create, disable, reactivate, assign role/branch). Done when permissions, no hard deletion and audit records are tested. Member 5 owns the admin UI. Depends on M1-S04/S06/S09. |
| [ ] | M1-S14 | Build staff/guest login UI using shared shadcn components and `DESIGN.md`/`LAYOUT.md`. Done when validation, disabled-account response and frontend build pass. Depends on M1-S08. |
| [ ] | M1-S15 | Build online registration/link UI. Done when duplicate/takeover failures are safely shown and frontend build passes. Depends on M1-S10. |
| [ ] | M1-S16 | Build staff guest-search/profile UI with masked `NIC`. Done when accessibility, duplicate handling and branch-denial states pass. Depends on M1-S11. |
| [ ] | M1-S17 | Build online own-profile UI without staff search/navigation. Done when own-record and forbidden-update states pass. Depends on M1-S12. |
| [ ] | M1-S18 | Link Members 2/4's own-booking/payment reads into the guest account summary after their contracts are published; do not duplicate their APIs or booking/billing screens. Done when cross-account requests remain denied. |

Handoff: publish the exact PK/FK, actor/session and authorization contracts before Members 2–5 consume them. New JSON endpoints use the `/api/*` prefix selected in M2-S01; retain existing `GET /rooms` until callers migrate. Do not create another member's base table.

### Member 2 reservation handoff (M2-S01)

Use [Imandi's reservation contract](m2_s01_reservation_contract.md) for the agreed ownership boundary: Member 1 supplies `branch`, guest/`guest_account` ownership, staff branch authorization, actor identity and audit writing. Member 2 writes booking/assignment data; Members 3/4 orchestrate their transitions. The working shared choices are PostgreSQL 18 `uuidv7()`, UTC `timestamptz`, actor FKs to `user_account.user_id` (including a non-login system principal), and `/api/*` with a `GET /rooms` alias. Imandi reports agreement from Members 1, 3 and 4; Member 1 still needs to implement/test this contract and decide `NIC`, `text(65535)` and guest-link cardinality under M1-S01. This handoff does not check off M1-S01.

## Completion notes

When checking a row, add a brief evidence note here and the detailed entry under Member 1 in `member_work_log.md`. No subtasks are marked complete by this plan.
