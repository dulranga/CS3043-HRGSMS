# 8 October 2026 — integration bug-fix audit

Scope: test the current SkyNest implementation, repair reproducible failures, and preserve member-owned contracts. This is implementation evidence, not completion of every unchecked SRS/member task. No branch, commit, push or pull request was created.

## Verification

| Check | Result |
| --- | --- |
| Root `npm test` | 437 passed: 233 frontend tests in 31 files; 204 backend tests in 59 files; zero failures or skips |
| Frontend regression after final UI fixes | 233 passed |
| `npm run build:frontend` | Passed TypeScript checking and Vite production bundling |
| `npm run build:backend` | Passed TypeScript compilation |
| Production application HTTP integration | Real login cookies for all six staff roles; route mounting, public inventory, denial, branch scope and audited administration passed |
| Configuration initialization follow-up | Registered unset key visible; first write uses the authenticated actor; spoofed actor and financial keys rejected |
| Full production migration runner | All 37 current migration files applied to a clean temporary schema; idempotent rerun passed |
| Development database migration update | 11 pending migrations applied; 26 existing migrations skipped; report views readable |
| Browser against running development app | Colombo availability search returned a valid empty result; anonymous staff pages show sign-in guidance and preserve the destination |
| `git diff --check` | Passed |

The full suite ran before the final configuration-list and UI refinements. The affected production-app integration and complete frontend suite were rerun afterward. The frontend build retains Vite's warning about a JavaScript chunk exceeding 500 kB; the build succeeds.

## Fixed behavior

- **Registration/database connection:** allow 15 seconds for a hosted PostgreSQL connection instead of failing after 2 seconds. A delayed TCP proxy regression verifies the real connection behavior. Persistent deployment still requires a configured strong `SESSION_SECRET`; the current development server uses a process-local secret.
- **Verified sessions and cookies:** room administration, staff reservation create/read/change, direct guest reservation create/read, service catalogue and usage pages now consume the verified AuthProvider identity. Removed development role selectors and null session adapters. Feature clients use relative `/api` URLs so the HTTP-only session cookie reaches Vite's proxy.
- **Production API integration:** extracted `createApplication` and mounted existing booking, guest creation, check-in, active-stay, service catalogue and room-condition factories with session-derived actor/branch permissions. Public availability runs before broad authenticated middleware. Guest invoice/payment reads remain available through the account summary; staff invoice/payment tools remain staff-only.
- **Administration:** legacy branch/account actions delegate to Member 1's audited transactions. Disabling an account updates both account/officer flags and invalidates access; self-disable is rejected. Staff lists exclude guest accounts and the non-login principal. Registered operational settings can be initialized from the UI, use a server-derived actor and activation date, and reject generic financial keys. Auditor controls cannot write.
- **Reporting:** repaired normalized joins, distinct actual current occupancy, branch filtering before service aggregation, one-time guest payment totals, signed FINAL invoice revenue and Asia/Colombo issue-month grouping. Screen and CSV share validated parameterized queries, filters, pagination and stable ordering. DRAFT/FINAL labels replace unsupported statuses. Protected export aliases now match the approved role/scope mapping. CSV handles quotes, carriage returns, dates and spreadsheet formula text without changing signed financial numbers. Unexpected invoice/catalogue/report errors no longer return SQL details.
- **Database compatibility:** archived obsolete competing audit/config DDL. Removed indexes against deleted booking-header fields and generic tax/fee seed values. Added `m5_004_repair_report_contracts.sql` so existing installations receive corrected views/indexes as well as clean installations. Existing view column order/types are preserved for `CREATE OR REPLACE VIEW` compatibility.
- **Navigation and dashboard:** staff navigation follows the current server role mapping; unauthenticated staff tools give clear sign-in guidance. Replaced fabricated dashboard room/guest rows with links to authorized operational tools. Modified administration/report UI reuses shadcn primitives and design tokens.
- **Test reliability:** removed references to the deleted `0000` migration, corrected dependency ordering, repaired cancellation router injection, supplied an explicit test-only guest-registration secret and isolated previously public-schema M5 tests. Tests honor explicit database environment settings and use session-capable direct connections. Added a root runner covering every current `.test.ts`, `.test.tsx` and `.test.cjs` suite.

## Reconciliation evidence

The isolated two-room stay covers partial/full check-in, multiple non-overlapping future reservations for one physical room, price changes, voided usage, payment/refund and DRAFT/FINAL behavior. Successful gross payments of 490 are counted once for guest history; a refund of 50 and failed attempt of 900 do not multiply gross expenditure. FINAL billed revenue is 440 (room 400 + service 50 + other −10), independent of cash, and excludes DRAFT estimates. Current occupancy counts actually checked-in physical rooms rather than assigned future reservations. SQL migration and operational constraint suites also exercise negative and concurrency cases.

Integration tests use temporary schemas and clean them up. Browser checks do not create bookings, guest accounts or fictional inventory in the development database. The development database update applies existing pending operational migrations and the report repair. The previously requested `imandi` account remains an active Colombo `SYSTEM_ADMINISTRATOR`.

## Setup and remaining owner acceptance

- The development database currently has **zero active room types and zero active physical rooms**. A Chain Manager must configure the catalogue and a Branch Manager must configure real branch rooms before availability/booking can return inventory. One billing-policy version exists; no new prices or financial rules were invented.
- Current occupancy is a **current snapshot**. Historical date/period occupancy by room type and sellable room-night denominators (FR-066/067) remain Member 5 work; the UI must not imply that this snapshot fulfills those requirements.
- Service totals now reconcile, but detailed room-line/unallocated rows and historical room attribution after moves (FR-069) still require Member 5's owner implementation.
- The complete AT-22 month-boundary acceptance example remains to be added even though the issue-month/timezone SQL and two-room FINAL reconciliation are covered.
- Full report execution audit requirements and broader responsive/accessibility acceptance still require owner verification. Report read/export handlers do not yet record every execution as an audit event.
- Staff-account creation/role reassignment UI and typed billing-policy publication UI remain planned owner tasks. Current administration covers branch creation/status and staff status changes.
- The unused legacy guest cancellation simulator is not mounted as My Bookings. Authenticated guest cancellation controls remain a Member 4 UI handoff; cancellation engine/API tests pass.
- SRS Appendix C's role/enum/scale confirmations remain with the owners. This audit preserves the implemented working contracts and does not approve unresolved decisions. No additional member checklist rows were checked solely from these fixes.

## Lecture concepts applied

Preserved the normalized booking → room line → assignment relationship and immutable historical facts. Aggregated independent invoice, payment and service facts before combining results to avoid join fanout. Used parameterized filtering, indexes matching the actual schema, transactions and existing row locks for audited mutations, and separate schemas/session connections for deterministic database tests.

## Human Git handoff

Proposed commit message:

```text
fix: integrate verified sessions and repair admin/report contracts
```

Proposed PR title:

```text
Fix authenticated feature integration, audited administration and report totals
```

Proposed PR description:

```text
Connect existing staff/guest feature pages and API factories to verified sessions so reservations, services and room operations are reachable with their approved role and branch scope. Route legacy administration through audited owner transactions, support first-time operational configuration, and remove fabricated dashboard records.

Repair reporting views and queries for the normalized multi-room schema, count financial/occupancy facts once, and keep filtered CSV exports aligned with screens. Add a compatible forward migration and restore isolated full-suite testing.

Validation: 437 automated tests pass; affected integration/frontend tests pass after final refinements; both production builds pass; all 37 migrations apply cleanly and rerun idempotently; public availability and staff sign-in guidance verified in the browser. Remaining historical occupancy, service attribution and owner acceptance are recorded in docs/qa/2026-10-08-bug-fix-audit.md.
```

Browser evidence: [availability](live-availability.jpg), [staff sign-in guidance](staff-signin-gate.jpg).
