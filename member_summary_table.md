# ER-aligned member responsibilities — draft for team confirmation

This is the proposed handoff map for the five members, aligned with the team-supplied final ER transcription dated 18 September 2026 and the approved online-guest/assignment clarifications. The full 21-entity attribute/type inventory and the separately approved `booking_room_assignment` extension are in `SkyNest_HRGSMS_SRS_v1.0.md` §6.1.4 (Version 1.2 draft). The source ER diagram should also be checked visually and updated for the extension before formal approval. This document assigns **one proposed primary schema owner per base table** while preserving cross-team feature work. At Imandi's request, the Member 2 working choices in M2-S01 were selected with her reported agreement from Members 1, 3 and 4; remaining Appendix C items and evaluator review stay open.

## One-commit-sized work plans

The detailed checklists and task-specific workflows are in [Member 1 — Dulranga](member_tasks/member_1_dulranga.md), [Member 2 — Imandi](member_tasks/member_2_imandi.md), [Member 3 — Kulunu](member_tasks/member_3_kulunu.md), [Member 4 — Chamikara](member_tasks/member_4_chamikara.md) and [Member 5 — Thusath](member_tasks/member_5_thusath.md). The shared `.agents/skills/skynest-member-task-workflow/SKILL.md` guides execution; `memory.md` stores verified context and all members record actual work under their respective sections in `member_work_log.md`. Each row is a proposed unit for one human Git commit, not an instruction for an agent to commit. The checkboxes are planning status only; verify current code and teammate contracts before claiming completion.

Imandi's [M2-S01 reservation handoff](member_tasks/m2_s01_reservation_contract.md) records the Member 1/2/3/4 ownership, transaction boundaries and selected booking/room/rate/actor/route/UUIDv7 mappings. Imandi reports that the other members agree to follow that handoff. Remaining owner-specific Appendix C decisions and evaluator review are called out there.

## Contracts that must be agreed before dependent migrations

1. All ER ID PKs and matching FKs are `UUIDv7` except `system_config.config_key varchar(255)` and the composite `room_type_amenity` key. The working contract is PostgreSQL 18 `uuid DEFAULT uuidv7()` with version checks on PKs; test it on every owner table and avoid mixed UUID/BIGINT migrations (TBD-09).
2. The ER has `room.booking_id → booking.booking_id`, **not** `booking.room_id`. The team has approved an additional `booking_room_assignment` table owned by Member 2, with the fields/invariants in SRS §6.1.4. The nullable ER pointer is only for the currently checked-in booking; availability, history and reports use assignments. Members 2–4 review locking, status transitions and pointer synchronization before migration. Record this as an explicit ER-diagram extension, not as an original ER attribute.
3. `enum(n)` is an ER annotation, not a `varchar(n)` length or required label count. Member 2's complete working booking-channel, booking-status and room-status sets are in M2-S01. Members 1/4 still need audit/payment/invoice value contracts and constraint tests (TBD-07).
4. Member 2 rates map to non-negative LKR `numeric(12,2)` with PostgreSQL rounding ties away from zero. Other financial/quantity sign and scale rules remain with Members 3/4. ER event `timestamp` maps to UTC `timestamptz` with Asia/Colombo display; `text(65535)` and `NIC` mapping remain open (TBD-08/TBD-10).
5. Actor FKs `created_by`, `changed_by`, `recorded_by`, `voided_by` and `updated_by` target `user_account.user_id`, with authenticated users for user actions and a non-login system principal for jobs. Member 1 must implement and test that shared contract; not-yet-occurred event fields remain nullable (TBD-11).
6. The approved stack is README's React 18/TypeScript/Vite frontend and Express/TypeScript/Node API with PostgreSQL and raw parameterized SQL. New JSON routes use `/api/*`; existing `GET /rooms` remains a compatibility alias during caller migration (TBD-12).
7. Online guest accounts are in scope: `guest_account` links `user_account` to `guest`; online guests may access only their own profile/bookings, search availability, create direct bookings and request eligible cancellation. Staff-assisted bookings for guests without accounts remain in scope. Verify contact/identity control before account linking; never trust a submitted guest ID as proof of ownership.

## Proposed single-owner ER table map

| Member | Primary ER schema ownership | Main integration responsibility |
|---|---|---|
| 1 — dulranga | `branch`, `role`, `user_account`, `officer`, `guest`, `guest_account`, `audit_log`, `system_config` | Publish UUIDv7, actor, staff-role/branch, guest-account, audit and configuration FK contracts; other members write through agreed interfaces. |
| 2 — imandi | `room_type`, `amenity`, `room_type_amenity`, `room`, `room_block`, `booking`, `booking_status_history`; approved extension `booking_room_assignment` | Room inventory, availability, staff/online reservations and no-overlap protection; consume Member 1's `branch`/guest/actor keys and Member 3's room-status history contract. |
| 3 — kulunu | `service`, `service_usage`, `room_status_history` | Check-in, active-stay service usage and room-status transitions; consume booking/room and actor contracts. |
| 4 — chamikara | `invoice`, `invoice_line`, `payment` | Billing, partial payment, checkout, cancellation and no-show; consume booking/service/config/audit contracts. |
| 5 — thusath | No additional ER base table; owns agreed reporting views | Reports and exports; admin/configuration UI and audit review use Member 1-owned base tables instead of competing DDL. |

The ownership above is a coordination proposal, not permission to overwrite another member's schema. A shared-table change is reviewed by its primary owner and affected consumers before migration.

## Member 1 — identity, staff, guests and shared foundations

- Establish the common UUIDv7 PK/FK generation and migration contract. Create `branch`, `role`, `user_account` and `officer`; `officer.officer_id` is both its PK and an FK to `user_account.user_id`, while `officer.branch_id` and `officer.role_id` carry staff scope. Do **not** put role/branch FKs back on `user_account` without an approved ER change.
- Create `guest` and `guest_account` (`guest_account_id` PK; `guest_id`/`user_id` FKs). Implement staff-assisted guest/profile management plus online account registration/linking, own-profile/history access and account-takeover protection while protecting `guest.NIC`; settle NIC uniqueness, passport handling and guest-account cardinality with the team.
- Own `audit_log` and `system_config` base DDL and publish safe write/read interfaces. `audit_log.user_id` references `user_account`; `system_config.config_key varchar(255)` is its PK, not a UUID. Decide how effective-date history works when the key permits only one row per setting, and confirm actor FK/system-actor policy for all consumers.
- Deliver login/logout for staff and online guests, staff/guest administration APIs, branch authorization against `officer` roles, and guest ownership authorization through `guest_account`. New endpoints use the selected `/api/*` prefix; candidate paths are `/api/auth/*`, `/api/users/*`, `/api/guests/*`. Member 1's candidate UI routes are `/login`, `/account`, `/guests/*`, while Member 5 owns the `/admin/users/*` UI.
- Verify shared-key one-to-one behavior, branch/role authorization, guest links, audit immutability, UUIDv7 types and safe account deactivation before handoff.

## Member 2 — room inventory, availability and reservations

- Create `room_type`, `amenity` and composite-PK `room_type_amenity` under M2-S02 using the selected PostgreSQL 18 UUIDv7 and LKR rate mapping. Later `room`, `room_block`, `booking` and `booking_status_history` migrations consume Member 1's implemented branch/guest/actor tables and the M2-S01 booking/room enum contract. Add the approved `booking_room_assignment` extension per separate §6.1.4. `room.room_number` and catalogue names are `varchar(255)` in the ER; nullable `room.booking_id` is only the current checked-in pointer.
- Preserve branch-scoped room-number uniqueness, positive capacity/guest count, valid block/stay dates, immutable `booking.rate_snapshot decimal`, one open assignment per active booking, and database-enforced same-room active-date conflict protection. Keep assignment history, booking-status history, current-stay pointer and coordinated room changes atomic.
- Build room-type/amenity/room/block administration, availability search, staff booking create/modify/list/detail and online guest booking create/own-list/own-detail. Online requests use Member 1's authenticated guest ownership; staff retains branch scope. Date/room modifications are staff-controlled, and cancellation/checkout/no-show belong to Member 4. Candidate endpoints: `/api/room-types`, `/api/amenities`, `/api/rooms/*`, `/api/room-blocks/*`, `/api/availability`, `/api/bookings/*`; candidate routes: `/admin/rooms/*`, `/search`, `/bookings/*`, `/my-bookings`.
- Hand Member 3 a reliable booking-to-room lookup and room-status transition interface, Member 4 booking/rate/status events, and Member 5 a historical assignment path for occupancy reports. Verify sequential and concurrent stays, adjacent dates, reassignment and retained history before declaring the booking/availability schema complete.

## Member 3 — check-in, active stay and services

- Create `service`, `service_usage` and `room_status_history` with UUIDv7 keys; keep `service_usage.quantity`, `unit_price_snapshot` and `service.current_price` exact `decimal` pending TBD-08. The ER includes `voided bool`, `voided_at timestamp` and `voided_by UUIDv7`; preserve original usage rows on reversal.
- Implement check-in and active-stay state changes with Member 2's booking/room model, writing booking and room histories atomically. Own service catalogue/usage and price snapshots; reject usage unless the booking is checked in. Member 4 owns checkout orchestration, while Member 3 supplies the agreed room-status/history operation it needs.
- Candidate endpoints: `/api/checkin/:ref`, `/api/stays/:ref`, `/api/services/*`; candidate routes: `/checkin/:ref`, `/stay/:ref`, `/services/*`. Confirm actor FK and route prefix before implementation.
- Test price changes against historical usage, void auditability, check-in rollback and room-status history consistency.

## Member 4 — billing, payment and end-of-stay transitions

- Create `invoice`, `invoice_line` and `payment` with UUIDv7 PK/FK types and ER attributes. The ER has **no** `invoice.total_amount`; derive totals from protected lines unless an explicit amendment approves a snapshot. Decide invoice-per-booking cardinality before adding uniqueness to `invoice.booking_id`.
- Own invoice generation, partial payments, zero-balance checkout, cancellation and no-show workflows. Online guests may request cancellation only for their own eligible BOOKED reservation under the same server-enforced policy; staff handles other authorized cancellations. Coordinate booking status/history and assignment closure with Member 2 and room CLEANING/history updates with Member 3. Use approved `system_config` policy values and Member 1's audit writer; do not create duplicate config/audit tables.
- Candidate endpoints: `/api/bookings/:ref/invoice`, `/api/payments`, `/api/bookings/:ref/checkout`, `/api/bookings/:ref/cancel`, `/api/bookings/:ref/noshow`; candidate routes: `/billing/:ref`, `/checkout/:ref`, `/bookings/:ref/cancel`, `/bookings/:ref/noshow`.
- Test exact decimal calculations, immutable finalized invoice lines, partial/failed payments, zero-balance enforcement, cancellation fee representation, guest ownership denial and atomic checkout/room/assignment changes.

## Member 5 — reporting, administration and audit review

- Define the five mandatory reporting outputs and their SQL views/queries with the team: current occupancy, guest billing summary, service usage breakdown, monthly branch revenue and top services (SRS §6.1.10). Availability is a separate sixth operational view/query. Use the approved booking–room history path for occupancy, service usage and revenue attribution; no report should infer history from a mutable `room.booking_id` pointer alone.
- Own report screens/filters/exports and read-only audit review. Implement approved configuration/user administration interfaces against Member 1-owned `system_config`, `user_account`, `officer` and `audit_log` contracts; coordinate writes with Member 1 rather than adding competing DDL.
- Candidate endpoints: `/api/reports/*`, `/api/reports/export/*`, `/api/admin/audit`, `/api/admin/config/*`; candidate routes: `/reports/*`, `/admin/audit`, `/admin/config`.
- Reconcile report totals to independent booking/invoice/payment/service queries, test branch permissions and CSV parity, and verify audit before/after visibility without permitting audit edits.

## Cross-team definition of ready/done

- Before a dependent task starts, recheck current migrations and code, SRS Table 40 types plus the separate assignment extension, README's approved stack, and affected owners' latest decisions. There is currently no ER migration in this checkout; these documents are not database changes.
- Before a shared migration is accepted, apply the complete ordered chain to a clean PostgreSQL database, verify FK type/target matching and approved enum sets, run negative constraint and multi-session concurrency tests, and build the affected application packages.
- Record an ER/SRS amendment for every deliberate deviation. Close the relevant Appendix C TBD item rather than silently choosing an ID type, actor target, enum member, decimal scale or booking–room relationship.
