# Audit entity-filter repair — 11 October 2026

Scope: Member 5 M5-S18/S19 follow-up, requested by Imandi during manual System Administrator testing. Relevant requirements: SRS §4.10, FR-078/079 and shared §6.1.4 audit contract.

## Problem and resulting behavior

The Audit Log text field sent every keystroke, but the API required exact, case-sensitive entity names. Earlier requests could also finish later and overwrite the current results. Searching `system` now finds `system_config`, `SYSTEM` gives the same results, and leading/trailing spaces are ignored. SQL LIKE wildcard characters are treated literally. Filters apply before pagination, whose ordering is now deterministic even for equal timestamps.

The UI aborts/ignores superseded requests and displays a failure message instead of leaving old records under a new filter. It keeps page reset and Reset Filters behavior. The action select uses the existing shadcn NativeSelect and shared audit action labels, including CREATE rather than the unsupported INSERT choice. No schema, authorization or audit-writing contract was changed.

## Verification

- `npm run test:admin --workspace backend`: 1/1 isolated full-chain production-app test passed, with new assertions for partial/exact matching, capitalization and spaces, blank/reset, combined action filtering, literal wildcards, SQL-looking text, no matches, pagination, duplicate entity query rejection and ordinary-role denial. The fixture is an automatically cleaned temporary schema, not shared application records.
- `npm run build:backend`: passed.
- `npm run build:frontend`: final build passed; existing bundle-size warning remains.
- Database test and frontend build needed sandbox escalation because of DNS and Vite filesystem restrictions. Initial combined-filter fixture expected an UPDATE event that it had not created; corrected it to the real LOGIN events and reran successfully.
- No interactive browser assertion was performed. Manual confirmation of the screen is pending. The full M5-S18/S19 masking/denied-state acceptance is not established by this focused repair, so task checkboxes remain unchanged.

## Manual check

1. Refresh `/dashboard/admin/audit` as System Administrator. Leave action set to All Actions.
2. Type `system`. Every result should have an entity name containing `system`, including the saved `system_config` event if present.
3. Replace it with `SYSTEM`, then `  system_config  `. The configuration rows should still appear.
4. Select UPDATE to see configuration updates only. If the configuration was only initialized, choose CREATE instead.
5. Quickly replace the entity text with `branch`. Once loading finishes, no rows for the old search should remain. Select All Actions if the preceding action narrowed out branch events.
6. Use Reset Filters: all entity/action restrictions clear and page returns to 1.
7. Type `no-such-entity`: show No audit records found. Check Next/Previous on a filter with enough rows.

## Lecture concepts

SQL predicates and parameterized queries implement the filter at the database, before LIMIT/OFFSET. LIKE pattern escaping preserves literal identifier characters; PostgreSQL ILIKE supplies case-insensitive matching. The existing LEFT JOIN preserves events when a user display name is absent. No new index was added without evidence of a performance requirement.

## Proposed human Git handoff

Commit message:

```text
fix(audit): support partial entity filters and discard stale results
```

PR title:

```text
Fix entity filtering in the Audit Log screen
```

PR description:

```text
Audit entity search previously required an exact, case-sensitive name, and earlier requests could overwrite the current filtered rows. Accept trimmed, case-insensitive literal partial names on the server, cancel superseded UI requests, surface read failures and stabilize pagination. Align the action choices with the shared audit contract using the existing shadcn select.

Validation: isolated production-app administration regression test passes with filter, pagination and authorization cases; backend and frontend production builds pass. Interactive manual screen verification remains pending. No schema or audit-writing changes.
```

No Git publication actions were performed.
