# Member 5 — Thusath: reports, administration and audit review

Planning checklist, not evidence of implementation. Each `M5-Sxx` is intended as one independently reviewable human commit. Member 5 owns the approved reporting views/queries and reporting/export/admin-review UI, but no additional ER base table. Member 1 owns `user_account`, `officer`, `system_config` and `audit_log` DDL and account/config write contracts.

## Workflow for each subtask

1. Follow the shared `skynest-member-task-workflow` skill. Read `AGENTS.md`, `README.md`, `memory.md`, `member_work_log.md`, this file, `member_summary_table.md`, and SRS §4.9–§4.10/§6.1. Reinspect current schema/code and the latest Member 1–4 contracts before working on a query or screen.
2. Agree on report formulas, status inclusion, branch attribution, time zone and reconciliation examples. Use `booking_room_assignment` for historical room attribution; never infer it from mutable `room.booking_id` or invent `invoice.total_amount`.
3. Implement one report or UI/API slice at a time. Verify each SQL output against an independent calculation on a clean temporary PostgreSQL DB with multi-branch, multi-stay and void/payment examples. Run `npm run build:backend` for API changes and `npm run build:frontend` for UI changes; add focused tests if missing.
4. Recheck the SRS and current implementation, record evidence under Member 5 in `member_work_log.md`, update `memory.md` only for durable decisions, mark complete only when verified, and give a copy-ready human commit message/PR description. Agents do not branch, commit, push or create PRs.

## Ordered commit-sized subtasks

| Status | ID | Deliverable and completion check |
|---|---|---|
| [ ] | M5-S01 | Publish report definitions with Members 2–4: five mandatory outputs, dates/statuses, branch attribution, financial meaning, role filters and CSV parity cases. Done when each has an independent expected-result example. |
| [ ] | M5-S02 | Implement current-occupancy view/query from checked-in booking assignments and room/branch data. Done when simultaneous future bookings do not appear as occupied and room moves retain correct history. Depends on Member 2 assignment and Member 3 check-in. |
| [ ] | M5-S03 | Implement guest billing summary from invoice lines and successful payments, without `invoice.total_amount`. Done when partial/failed payments reconcile. Depends on Member 4 invoice/payment contract. |
| [ ] | M5-S04 | Implement service-usage breakdown by branch/room/booking/service using assignment history and non-void usage. Done when price changes and voids preserve historical totals. Depends on Members 2/3. |
| [ ] | M5-S05 | Implement monthly branch revenue from approved finalized invoice-line/payment rules. Done when month boundary, room move, cancellation and multi-branch examples reconcile. Depends on M5-S01 and Member 4 billing rules. |
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
| [ ] | M5-S21 | Build configuration administration UI against Member 1's audited config API. Done when approved policy values, effective-date behavior and failed-update feedback pass. Depends on Member 1 config contract. |

Handoff: Member 5 supplies report reconciliation evidence and export parity; Members 1–4 remain owners of their base tables and operational transactions. Availability is a separate operational query owned by Member 2, not a sixth management-report deliverable.

## Completion notes

When checking a row, add a brief evidence note here and the detailed entry under Member 5 in `member_work_log.md`. No subtasks are marked complete by this plan.
