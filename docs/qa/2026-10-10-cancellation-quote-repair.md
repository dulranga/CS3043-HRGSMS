# Cancellation quote follow-up — 10 October 2026

Manual testing of accidental booking `SKY-01a12651ec6e7a55af371ae0927bec15` showed a cancellation denial even though both QA-102 and QA-202 were BOOKED. The frontend was reading the controller's `{ success, quote }` envelope as the quote, so `is_eligible` was undefined. Cancellation success receipts had the same mismatch with `{ success, cancellation }`.

The clients now unwrap the documented controller fields and reject malformed success payloads. Separately, the whole-booking quote service inspected only the first line via `LIMIT 1`, understating the fee and potentially allowing a quote despite another ineligible line. It now checks every line and totals linked-policy fees in cents. An eligible whole quote has no single-line attribution and reports the earliest cutoff. Per-line quotes retain their one-line fee. SRS FR-062/063 and §4.7.4 require these all-line guards and flat fees after percentage calculation. No schema, migration, authorization or cancellation-write behavior changed.

## Verification

- `npm run test:m4-cancellation-ui --workspace frontend`: 6/6 passed; real response envelopes, denial messages, fees, receipts, request reasons, malformed payloads and transport/API failures.
- `node --import tsx --test backend/tests/m4CancellationQuote.test.ts`: 5/5 passed; all-line fee sum, later-line denial, exact cutoff boundary, FINAL/missing data, per-line attribution and fractional fees. Also available as `npm run test:m4-cancellation-quote --workspace backend`.
- Backend and frontend production builds pass. Vite's sandbox filesystem `EPERM` was resolved by rerunning the frontend build with approved escalation; existing bundle-size warning remains.
- A real read-only transaction called the repaired service against the saved accidental booking. Whole quote: eligible, LKR 10,000 total; QA-102 line quote: eligible, LKR 5,000. Both saved lines remain BOOKED. The agent did not cancel a reservation or change financial records.

## Remaining acceptance and contracts

Refresh `/cancellation`, load UUID `01a12651-ec6e-7a55-af37-1ae0927bec15`, and get the whole-booking quote. Review LKR 10,000 before manually confirming. After confirmation, verify both lines CANCELLED, both assignments closed, their inventory released and the original booking unaffected. With no payments or services, expected remaining invoice charges are the two flat fees totaling LKR 10,000; verify the actual saved invoice. Those steps are pending, not claimed passed by this repair.

The panel still supplies a fixed guest-request reason instead of accepting a staff-entered reason. This pre-existing UI limitation is separate from the quote blocker; a future Member 4 change should allow a truthful explanation for staff corrections. This repair does not waive cancellation fees or erase accidental-booking history. Other billing screens were not audited here. No additional member-task checkboxes were changed.

Lecture concepts used: joins and parameterized predicates over normalized facts; complete related-row inspection; read-only quote versus an atomic guarded write. No new database structures were needed.

## Proposed human Git handoff

Commit message: `fix(cancellation): decode API envelopes and quote all booking lines`

PR title: `Fix false cancellation denials and whole-booking fee quotes`

PR description:

Cancellation quotes incorrectly appeared denied because the UI read the response envelope instead of its `quote` field; confirmation receipts also lost their fee values. Unwrap the actual controller fields and reject malformed payloads. Inspect every saved line for whole-booking eligibility and total the policy fee for all affected lines, matching the existing cancellation transaction.

Validated with 6 frontend and 5 backend focused tests, both production builds, and a live read-only two-line quote of LKR 10,000. Manual confirmation, invoice and released-inventory checks remain pending. No migration or booking mutation is included.
