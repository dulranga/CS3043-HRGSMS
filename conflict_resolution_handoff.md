# Imandi/dev reconciliation — 5 October 2026

The local `Imandi` branch was merged with the verified remote `dev` tip
`a8f2c88d61d2068da13e49d3ed464eb40a3de3af` using `--no-commit --no-ff`.
No branch, commit, push or pull request was created. A human must finish and
publish the merge before GitHub's PR conflict warning can change.

## Changes within the existing implementation scope

- Preserved Imandi's M2-S11 booking-read core and Member 3's existing M3-S02–S08
  schema/API/check-in work. The package script conflict keeps both sets of tests.
- Removed conflict markers already committed in the ownership summary and
  replaced retired M2 correction-task prerequisites with M2-S03/S04/S05/S06/S28.
- Kept published `m3_001` and `m3_002` mock migration keys and consumers intact.
  Member 3 upgrades now use unique keys: `m3_003` service usage, `m3_004` catalogue,
  `m3_005` room history. They preserve existing IDs, snapshots, history, reason
  fields and the existing checkout hook, and reuse `room_condition_enum`.
- Check-in compares SQL-formatted dates with the server's Asia/Colombo hotel
  date after locking. It records one actual instant for occupancy/history/audit
  and cannot use a submitted stayDate to check in a future or expired line.
- Member 3 protected routers require injected authentication and use only
  verified `req.user` actors. They remain unmounted pending M1-S08/S09. The
  earlier M3-S07/S08 checked rows are corrected to partial/uncompleted status.
- The operational handoff reflects the implemented checkout lock order:
  booking, invoice, line, assignment, room. No later service-recording/void,
  direct-condition authorization, room-move or UI tasks were implemented.
- The M2-S11 test now casts booking function arguments explicitly, preventing
  ambiguous overload resolution when `public` also contains the same function.

## Verification

- Backend and frontend production builds pass.
- All eleven existing Member 3 schema, service API, check-in and active-stay
  tests pass. The two new current-baseline cases pass: complete numbered chain
  with real creation/check-in/active stays/partial checkout, and data-preserving
  upgrades over the published mocks.
- M2 booking creation, booking reads, availability, catalogue/room APIs,
  lifecycle/overlap guards and capacity/type-edit concurrency tests pass.
- Member 4 billing calculations, checkout transaction scenarios and the
  migration runner's fixture tests pass. The unchanged Member 4 checkout API
  suite still fails scenarios 12–18: expected credit becomes positive balance,
  so checkout fails and later receipt/repeat assertions cascade. Its files were
  not changed; see `.scratch/m4-checkout-api.log` from this session.
- The numbered chain applies in isolated schemas. The production runner still
  rejects Member 5's unnumbered `backend/migrations/audit_and_config.sql`.
  That file and Member 1's runner are outside the authorized code ownership.
- Database concepts used: normalized relationships, foreign keys/domain
  constraints, immutable history, exact decimal snapshots, atomic rollback,
  row locking and transaction-local schema isolation.

## Database verification incident — unresolved restoration

The agent mistakenly used the existing production migration runner for one
pooled-database verification run. Its session-scoped `SET search_path` was not
reliable between transactions. Pending migrations were applied to **public**,
not only the intended scratch schema. This was unintended and is not evidence
of user approval to deploy these migrations.

Before verification, `public.schema_migrations` contained 14 records: `0000`,
`m1_001`–`m1_005` (where `m1_004` records the old billing-policy mock),
`m2_001`–`m2_006`, and `m4_001`–`m4_002`. The unintended run added these 13:

`m1_006`, `m2_007`, `m2_008`, `m3_001`–`m3_005`, `m4_003`–`m4_007`.

Their recorded application times are 4 October 2026 19:10:16–19:10:20 UTC
(5 October 2026 00:40:16–00:40:20 Asia/Colombo). `m1_006` drops/recreates
`system_config`; its current row count is zero. The user confirmed there is
no pre-session snapshot or record of the previous values. No speculative
database rollback or configuration reinsertion was performed.

The user subsequently identified `main` as a previous snapshot. Its verified
local/remote tip is `1a30682d50bfdc65c8e5ee5076683515c852d4a17`. Its full tracked
file inventory contains source/migrations/tests, with no database dump or saved
live `system_config` rows; it already includes the same `m1_006` replacement.
It can recover source/schema definitions, but cannot prove the erased live
values. No checkout, branch change or database restoration from `main` occurred.

These last audit-recorded values are recoverable evidence, not a complete
pre-run snapshot or approved financial policy:

| Legacy key | Last audited value | Audit timestamp UTC |
|---|---|---|
| cancellation_fee_rate | 12.0 | 19 September 2026 12:49:05 |
| tax_rate | 10 | 19 September 2026 12:49:19 |
| late_checkout_amount | 2009.00 | 3 October 2026 17:49:34 |

No matching audit evidence was found for `service_charge_rate` or
`discount_rate`. Do not assume bootstrap defaults are their previous values.
The current SRS puts financial rules in immutable typed `billing_policy`
versions; these legacy audit values must not be silently published as a new
production policy or inserted into the new non-financial `system_config`.

The corrected reconciliation test never uses the production runner. It uses
the runner's filename/key ordering, then pins every migration and operation
to a temporary schema with an explicit transaction and `SET LOCAL` excluding
`public`. A cancelled earlier test also left session advisory locks; only the
identified test locks were cleared. Member 1 must address the shared runner's
transaction-pool isolation before anyone uses it for pooled-schema migrations.
The interrupted scratch schema was removed after checking that it had no
external dependencies. The final lock audit found no remaining test-runner
advisory locks. The application migration count remained 27.

## Proposed human Git handoff

Commit message: `fix: reconcile Imandi and Member 3 with the normalized baseline`

PR title: `Reconcile reservations and check-in with the current normalized schema`

PR description:

Preserve the existing M2 booking-read and M3 operational cores while resolving
the dev merge, retiring obsolete correction-task dependencies and removing
duplicate Member 3 migration keys/condition types. Upgrade existing mock
tables without losing IDs, rates or history, use the server hotel date for
check-in, and keep protected M3 routers behind pending Member 1 authentication.

Both builds and affected M2/M3 integration coverage pass. The current-baseline
test covers creation through partial checkout and preserved mock data. Remaining
gaps are Member 1 auth/runner isolation, the unnumbered Member 5 SQL file, the
unchanged Member 4 checkout API failures and the database incident documented
above. No pending feature task is completed by this reconciliation.
