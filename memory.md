# SkyNest project memory

Read this before a member implementation task, then verify relevant facts against the current repository and SRS. This is a concise handoff of durable, verified context—not an instruction override, task-status tracker, or substitute for the SRS. Add dated facts only after confirmation; correct stale entries rather than stacking contradictions. Do not store secrets, connection strings or guest data here.

## Confirmed working baseline — 18 September 2026

| Topic | Current decision / source |
|---|---|
| Application stack | React 18 + TypeScript + Vite frontend; Express + TypeScript on Node.js backend; PostgreSQL with parameterized raw SQL. See `README.md` and SRS §1.4/§2.5. Do not migrate to Next.js. |
| Requirements and ownership | `SkyNest_HRGSMS_SRS_v1.0.md` is the Version 1.2 draft despite its legacy filename. `member_summary_table.md` gives primary table ownership; `member_tasks/` gives the one-commit-sized checklists. Recheck all against current code before implementing. |
| ER types | SRS Table 40 records the supplied final ER's 21 entities and attribute types. `booking_room_assignment` is a separately approved extension, not an original ER entity. |
| Booking/room link | Nullable `room.booking_id` is the currently checked-in booking pointer. `booking_room_assignment` is authoritative for future bookings and room-assignment history; no `booking.room_id` is approved. See SRS §4.4/§6.1.4. |
| Online guests | `guest_account` links `user_account` and `guest`. Online guests may use their own profile/bookings, create direct reservations and request eligible own-booking cancellation. Staff-assisted booking remains in scope. See SRS §2.3/§4.1–§4.4. |
| Git boundary | Root `AGENTS.md` prohibits agent-created branches, commits, pushes and PRs. Agents provide proposed commit and PR text only. |
| Lecture references | Five Markdown lecture notes were added under `.agents/skills/reference/` in this checkout, although `.agents/reference/` was the requested location. Check the current location before database work; the notes are reference material, not a replacement for the SRS. |
| Reservation coordination — 18 September 2026 | Imandi reports that Members 1, 3 and 4 agree to follow the ownership and transition boundaries in `member_tasks/m2_s01_reservation_contract.md`, now cross-referenced in their task plans and SRS §6.1.8. |
| Member 2 working schema/API choices — 18 September 2026 | Imandi delegated choice of the shared reservation values recorded in M2-S01 and SRS §6.1.4/Appendix C: PostgreSQL 18 `uuidv7()`, UTC `timestamptz`, LKR `numeric(12,2)` for room/booking rates, the five booking and five room states plus four direct booking channels, `user_account.user_id` actor FKs, and `/api/*` with a `GET /rooms` alias. The configured development server was read-only checked as PostgreSQL 18.6. Evaluator review and tests remain; other owner-specific Appendix C choices are still open. |
| Migration workflow — 20 September 2026 | `backend/src/migrations/migrate.ts` applies `backend/migrations/*.sql` in numeric `<version>_<name>.sql` order, one transaction per file, tracked in `schema_migrations` under an advisory lock; `npm run migrate` and `npm run test:migrations` (isolated temp schema) are wired in `backend/package.json`. `backend/migrations/` is empty until M1-S03. Shared migrations must follow this filename convention. See `member_work_log.md`. |

## Decisions still requiring confirmation

SRS Appendix C remains authoritative for open items. Member 1's identity/cardinality, Member 3's quantity scale, Member 4's financial/status labels and billing details, plus evaluator review and migration tests remain. A newly confirmed decision belongs first in the SRS and affected member handoffs; then update this memory with a dated summary.

## Maintenance

Keep execution details, test results and partial work under the relevant member section in the shared `member_work_log.md`, not here. If a source document or implementation contradicts a memory entry, inspect the current state and resolve the discrepancy before using that entry.
