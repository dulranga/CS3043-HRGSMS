# Room-condition manual-test repair — 10 October 2026

QA-102's CLEANING request failed because the installed `room_status_history` table lacked `reason` and used the separate legacy `room_condition` enum. The installed function expected `room_condition_enum`. Recorded migration versions did not detect this drift: the table already existed when the earlier create-if-absent migrations ran. The failed transaction left QA-102 READY and added no history.

The additive `m3_007_reconcile_room_history_condition.sql` migration repairs these columns while preserving event IDs, labels, actors, timestamps, foreign keys and the append-only trigger. Earlier migrations and the condition/checkout operations remain unchanged. Existing reason values survive a rerun. Unsupported historical labels abort the transaction rather than being discarded. The legacy enum remains available to other consumers.

Validation used isolated schemas and direct database connections:

- `node --import tsx --test backend/tests/m3RoomConditionApi.test.cjs backend/tests/m3RoomCondition.test.cjs backend/tests/m3BookingLifecycleIntegration.test.cjs`: 16/16 passed, including the populated legacy-table regression, condition authorization/conflicts/no-ops, checkout rollback and complete numbered chain.
- `npm run build:backend`: passed.
- The existing migration runner applied only the pending M3 repair to the configured development database. Follow-up read-only checks verified the corrected columns and preserved all preexisting history (0 rows). QA-102 still reads READY, allowing the user to perform the change manually.

Remaining acceptance: refresh Room Administration, open QA-102, choose CLEANING, enter `QA M2 cleaning test` and save. Then verify normal future availability versus the READY-only filter. No task completion status was expanded.

Lecture concepts used: explicit domain conversions, relational history/foreign-key preservation and atomic transaction rollback.

Proposed commit message:

```text
fix(db): reconcile legacy room-condition history columns
```

Proposed PR title: **Fix room-condition changes on legacy development schemas**

Proposed PR description:

```text
Physical condition changes fail when an existing room_status_history table lacks
the reason column and uses the legacy room_condition enum. Add a data-preserving
migration aligning those columns with the installed condition function and the
Member 2 enum, without rewriting published migrations or losing history.

Add an API regression covering populated legacy history, rollback, audited
changes, no-op behavior, immutable events, active-assignment conflicts and reruns.
Validation: 16 condition/API/lifecycle tests and the backend build passed. The
scoped development migration was applied; manual UI acceptance remains pending.
```

No branch, commit, push or PR was created.
