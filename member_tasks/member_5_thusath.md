# Member 5 — Thusath: reports, administration and audit review

Planning checklist, not evidence of implementation. Each `M5-Sxx` is intended as one independently reviewable human commit. Member 5 owns the approved reporting views/queries and reporting/export/admin-review UI, but no additional ER base table. Member 1 owns `user_account`, `officer`, non-financial `system_config`, target `billing_policy` and `audit_log` DDL and account/config write contracts.

## Workflow for each subtask

1. Follow the shared `skynest-member-task-workflow` skill. Read `AGENTS.md`, `README.md`, `memory.md`, `member_work_log.md`, this file, `member_summary_table.md`, and SRS §4.9–§4.10/§6.1. Reinspect current schema/code and the latest Member 1–4 contracts before working on a query or screen.
2. Use SRS §4.7.4/FR-070 for report formulas, DRAFT versus FINAL scope, signed invoice lines and PAYMENT/REFUND handling. Monthly billed revenue uses the Asia/Colombo month of FINAL `invoice.issued_at`, one booking branch, and all signed lines once; cash movements are separate. Confirm reconciliation examples with Members 2–4. Join booking → room line → assignment for historical physical-room attribution and derive current occupancy from open CHECKED_IN line assignments or the approved view. Count each room-night, service usage, payment and refund once; do not invent `invoice.total_amount`.
3. Implement one report or UI/API slice at a time. Verify each SQL output against an independent calculation on a clean temporary PostgreSQL DB with multi-branch, multi-stay and void/payment examples. Run `npm run build:backend` for API changes and `npm run build:frontend` for UI changes; add focused tests if missing.
4. Recheck the SRS and current implementation, record evidence under Member 5 in `member_work_log.md`, update `memory.md` only for durable decisions, mark complete only when verified, and give a copy-ready human commit message/PR description. Agents do not branch, commit, push or create PRs.

## Ordered commit-sized subtasks

| Status | ID | Deliverable and completion check |
|---|---|---|
| [ ] | M5-S01 | Publish report definitions with Members 2–4: five mandatory outputs, per-line dates/statuses, actual room-night attribution, branch, FR-070 FINAL-issue-month billed revenue versus net cash after refunds, role filters and CSV parity. Done when a two-room booking with a room move, partial checkout, one unallocated service, a refund and a month boundary has independent expected results. |
| [ ] | M5-S02 | Implement current-occupancy view/query from open CHECKED_IN line assignments and room/branch data, reusing Member 2's view if provided. Done when two rooms under one booking appear as two occupancy rows, future lines do not appear occupied, moves retain history and physical READY can coexist with occupancy. Depends on Member 2 M2-S22/S06 and Member 3 check-in. |
| [ ] | M5-S03 | Implement booking-level guest billing summary from the one booking invoice's signed lines, successful PAYMENTs and successful REFUNDs, without `invoice.total_amount`; label DRAFT totals provisional and negative balance as credit. Done when mixed-type differently priced rooms, same-type equal-base-rate rooms, partial/failed payments, a refund and no duplicated totals reconcile. Depends on Member 4 invoice/payment contract. |
| [ ] | M5-S04 | Implement service-usage breakdown by branch/room line/booking/service using optional usage line FK and non-void usage. For a moved guest, attribute the usage to the assignment occupied at `used_at`; display booking-wide or unreconciled usage as unallocated/flagged, never on every room. Done when move, price change and void totals reconcile. Depends on Members 2/3. |
| [ ] | M5-S05 | Implement monthly billed revenue by booking branch and Asia/Colombo month of FINAL `invoice.issued_at`; include all signed FINAL lines once and expose room/service/other columns that reconcile to total. Exclude DRAFT estimates and PAYMENT/REFUND cash movement; do not allocate a multi-month stay across nights in Version 1. Done when a two-room booking is counted once, and AT-22 month-boundary/move/cancellation/refund examples reconcile. Depends on M5-S01 and Member 4 billing rules. |
| [ ] | M5-S06 | Implement top-services view/query with quantity, booking count and revenue rankings. Done when ties, voids and price snapshots are tested. Depends on Member 3 usage. |
| [ ] | M5-S07 | Add report API filter/authorization foundation with parameterized branch/date inputs. Done when invalid ranges and cross-branch requests fail; no report formulas duplicated in JavaScript. Depends on Member 1 auth. |
| [ ] | M5-S08 | Expose occupancy and billing-summary report endpoints. Done when API totals match M5-S02/S03 SQL outputs and manager/auditor permissions pass. Depends on M5-S07. |
| [ ] | M5-S09 | Expose service-usage, revenue and top-services endpoints. Done when filters match the five view/query results and unauthorized access fails. Depends on M5-S04–S07. |
| [ ] | M5-S10 | Add CSV export using the same validated filters and source rows as on-screen reports. Done when row count, order, escaping and totals equal the screen/API results. Depends on M5-S08/S09. |
| [ ] | M5-S11 | Build report navigation and shared branch/date filters using shadcn primitives. Done when invalid ranges, role scope and frontend build pass. Depends on M5-S07. |
| [ ] | M5-S12 | Build current-occupancy screen. Done when rows/totals, empty/loading/error states and frontend build pass. Depends on M5-S08/S11. |
| [ ] | M5-S13 | Build guest-billing-summary screen. Done when line/payment totals reconcile and responsive states pass. Depends on M5-S08/S11. |
| [ ] | M5-S14 | Build service-usage breakdown screen. Done when voided usage is excluded and filter totals match API. Depends on M5-S09/S11. |
| [ ] | M5-S15 | Build monthly-branch-revenue screen. Done when month/branch labels and totals match API. Depends on M5-S09/S11. |
| [ ] | M5-S16 | Build top-services screen. Done when rankings/ties and accessible display pass. Depends on M5-S09/S11. |
| [ ] | M5-S17 | Add CSV actions to report UI with visible active filters. Done when downloaded rows match corresponding screens and frontend build passes. Depends on M5-S10/S12–S16. |
| [ ] | M5-S18 | Add read-only audit API against Member 1's `audit_log` with masking and role/branch rules. Done when ordinary users cannot read or mutate records. Depends on Member 1 audit/auth. |
| [ ] | M5-S19 | Build read-only audit-review UI. Done when filters, masked before/after values and denied-access states pass. Depends on M5-S18. |
| [ ] | M5-S20 | Build staff-account administration UI against Member 1's existing API; do not write separate account logic. Done when create/disable/role/branch flows and permission failures pass. Depends on Member 1 account API. |
| [ ] | M5-S21 | Build non-financial current-value configuration UI against Member 1's audited `system_config` API; changes take effect immediately with no future scheduling, and billing percentages/fees are never generic keys. Done when current activation date, permissions and failed-update feedback pass. Depends on Member 1 M1-S07. |
| [ ] | M5-S22 | Build authorized management UI for Member 1's typed `billing_policy` publication/read API, separate from M5-S21. Show effective date, percentage/fee bounds, no-show grace days, `is_demo` marker and immutable prior versions; allow an audited same-date correction as a new row and warn that it affects only future confirmations and demo rows are forbidden in production. Done when invalid values, same-date ordering, forbidden edits/deletes, policy quote preview and frontend build pass. Depends on M1-S19. |
| [ ] | M5-S23 | Build branch-record administration UI against Member 1's M1-S20 API. Only SYSTEM_ADMINISTRATOR may create/edit/deactivate branches; show affected active reservations and the AT-25 rejection until their assignments close through cancellation or completed stays, with no hard-delete control or access to chain-wide catalogue prices. Done when FR-008 role denial, active-booking deactivation feedback, validation and frontend build pass. Depends on M1-S20. |

Handoff: Member 5 supplies report reconciliation evidence and export parity with two-room, partial-state and room-move fixtures; Members 1–4 remain owners of base tables and operational transactions. Availability is a separate operational query owned by Member 2, not a sixth management-report deliverable.

## Completion notes

When checking a row, add a brief evidence note here and the detailed entry under Member 5 in `member_work_log.md`. No subtasks are marked complete by this plan.
