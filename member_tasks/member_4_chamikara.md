# Member 4 — Chamikara: billing, payments and end-of-stay

Planning checklist, not evidence of implementation. Each `M4-Sxx` is intended as one independently reviewable human commit. Member 4 owns `invoice`, `invoice_line` and `payment` (SRS Table 40), plus checkout/cancellation/no-show orchestration. The ER has no `invoice.total_amount`; derive totals from protected lines unless a separately approved amendment changes that.

## Workflow for each subtask

1. Follow the shared `skynest-member-task-workflow` skill. Read `AGENTS.md`, `README.md`, `memory.md`, `member_work_log.md`, this file, `member_summary_table.md`, and SRS §4.7–§4.8/§6.1. Reinspect live schema/code plus Member 1's actor/config/audit, Member 2's booking/assignment and Member 3's room/service contracts before each task.
2. Close relevant Appendix C decisions—financial scale/rounding, full enums, actor FKs, invoice cardinality, cancellation-fee representation and policy values—before dependent SQL. Coordinate any booking/room/status-history write with its primary owner.
3. Implement one row's behavior and focused tests. Migrations run on a clean temporary PostgreSQL DB; test partial payments, concurrent final payment and transaction rollback. Run `npm run build:backend` and/or `npm run build:frontend` for affected packages. If test infrastructure is absent, add focused coverage rather than marking an untested item done.
4. Recheck the SRS and current implementation; record verification under Member 4 in `member_work_log.md`, update `memory.md` only for durable decisions, mark complete only with evidence, and give a copy-ready human commit message/PR description. Agents do not branch, commit, push or create PRs.

## Ordered commit-sized subtasks

| Status | ID | Deliverable and completion check |
|---|---|---|
| [ ] | M4-S01 | Publish the financial contract with Members 1–3: LKR precision/rounding, all payment/invoice enum labels, invoice-per-booking cardinality, cancellation-fee line representation and actor IDs. Done when Appendix C decisions and expected tests are recorded. |
| [ ] | M4-S02 | Create `invoice` and `invoice_line` with Table 40 types/FKs and approved line/status constraints. Done when invalid lines and duplicate invoice-number cases fail; no `invoice.total_amount` added. Depends on M4-S01 and Member 2 booking. |
| [ ] | M4-S03 | Create `payment` with Table 40 types, booking/actor FKs and approved status/method constraints. Done when invalid amount/status and missing-reference cases are tested. Depends on M4-S01 and Member 1 actor key. |
| [ ] | M4-S04 | Implement deterministic room-night and non-void service charge calculations from booking rate and Member 3 usage snapshots. Done when boundary nights, changed catalogue prices and exact decimal rounding tests pass. Depends on M4-S02 and Member 3 usage. |
| [ ] | M4-S05 | Implement invoice generation/finalization transaction and protected invoice-line history. Done when retry behavior, duplicate prevention and immutable finalized lines are tested. Depends on M4-S04. |
| [ ] | M4-S06 | Expose invoice/detail and payment-history read API with branch-scoped staff access and online guests limited to their own linked bookings. Done when cross-branch/guest reads fail and totals match lines. Depends on M4-S05 and Member 1 guest ownership guard. |
| [ ] | M4-S07 | Implement balance calculation and payment-posting transaction using successful payments only. Done when three partial payments, failed payments, duplicate references and concurrent final payments reconcile. Depends on M4-S03/S05. |
| [ ] | M4-S08 | Expose payment API with validation, staff authorization and safe errors. Done when overpay/negative/forbidden requests fail and receipts use stable references. Depends on M4-S07. |
| [ ] | M4-S09 | Implement checkout transaction: lock booking/room/invoice, require zero balance, close assignment, clear current pointer, set CHECKED_OUT/CLEANING and write histories. Done when injected failure rolls back all changes. Depends on M4-S07 and Members 2/3 transition contracts. |
| [ ] | M4-S10 | Expose checkout API with branch/role guards and idempotent or explicit repeated-request behavior. Done when positive-balance and repeat checkout tests pass. Depends on M4-S09. |
| [ ] | M4-S11 | Implement cancellation transaction and any approved fee line; close assignment and release availability without deleting history. Done when policy cutoff, rollback and guest ownership tests pass. Depends on Members 1/2 and M4-S01. |
| [ ] | M4-S12 | Implement no-show transition with cutoff, history and assignment closure. Done when early no-show and repeat transitions fail while inventory is released correctly. Depends on Member 2 status/assignment contract. |
| [ ] | M4-S13 | Build invoice-detail UI using shadcn primitives, showing lines and exact totals. Done when role-scope and frontend-build checks pass. Depends on M4-S06. |
| [ ] | M4-S14 | Build payment UI with partial-payment entry, balance and failure states. Done when exact displayed totals and frontend build pass. Depends on M4-S08. |
| [ ] | M4-S15 | Build staff checkout UI with zero-balance guard and confirmation. Done when positive-balance and rollback responses are displayed safely. Depends on M4-S10. |
| [ ] | M4-S16 | Build staff cancellation UI with policy eligibility, fee display and confirmation. Done when denied/cancelled states pass. Depends on M4-S11. |
| [ ] | M4-S17 | Build staff no-show UI with cutoff feedback and confirmation. Done when early/repeated transition states pass. Depends on M4-S12. |
| [ ] | M4-S18 | Add online own-booking cancellation control to Member 2's My Bookings UI. Done when cross-account denial, policy messages and frontend build pass. Depends on M4-S11 and Member 2 own-booking UI. |

Handoff: publish invoice/payment/charge and cancellation status contracts for Member 5's reports and Member 1's own-payment history. Do not add a duplicate `system_config` or `audit_log` table; use Member 1's interfaces.

### Member 2 reservation handoff (M2-S01)

Use [Imandi's reservation contract](m2_s01_reservation_contract.md) for the agreed end-of-stay boundary: Member 4 orchestrates checkout, cancellation and no-show; closes Member 2's assignment without deleting history; clears a current-stay pointer at checkout; and writes each booking-status event inside the same transaction. Member 3 supplies the room-status/history operation, while Member 1 supplies actor/audit and guest-ownership guards. The working booking states, `user_account.user_id` actor target and LKR `numeric(12,2)` rate scale are fixed in M2-S01. Member 4 still needs its payment/invoice enum, sign, cancellation-fee and policy contracts plus tested transaction/lock details. This handoff does not check off M4-S01.

## Completion notes

When checking a row, add a brief evidence note here and the detailed entry under Member 4 in `member_work_log.md`. No subtasks are marked complete by this plan.
