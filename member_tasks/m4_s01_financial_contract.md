# M4-S01 Financial Contract — Multi-Room Billing, Payment and End-of-Stay

Published 29 September 2026 by Member 4 (Chamikara).

This contract documents the Version 1 billing, invoicing, payment and end-of-stay rules for SkyNest HRGSMS, derived from SRS §4.7/§4.8/§6.1.4 and the approved M2-S01 reservation handoff. It is a planning handoff for Members 1–5, not executable code. Member 4 owns `invoice`, `invoice_line` and `payment` (Table 40); Member 1 owns `billing_policy`; Member 2 owns `booking_room_line` and `booking_room_assignment`; Member 3 owns `service`/`service_usage` and room-condition history.

---

## 1. Invoice Lifecycle

- **One invoice per booking:** `invoice.booking_id` is required and unique. Created atomically at booking confirmation as DRAFT, linked to the effective billing-policy version.
- **DRAFT state:** While any room line is BOOKED or CHECKED_IN, the invoice stays DRAFT. Line amounts can be refreshed after permitted booking changes and service usage. DRAFT has no `invoice_number` or `issued_at`.
- **FINAL state:** Issued only when *all* room lines are terminal (CHECKED_OUT, CANCELLED or NO_SHOW), all charges are recorded, and the consolidated balance is exactly zero. Assigns a unique `invoice_number` and `issued_at` timestamp. After FINAL, no invoice-line edits, payments, refunds or line amendments are accepted by the ordinary Version 1 workflow.
- **No `invoice.total_amount`:** The ER has no stored total; totals derive from summing protected `invoice_line.amount` values.

## 2. Billing Policy Link

- **Immutable FK:** `invoice.billing_policy_id uuid` → `billing_policy.billing_policy_id` (Member 1's table). Required, set at confirmation, never changed.
- **Policy selection:** At booking confirmation, select the latest published policy by `(effective_from, created_at, billing_policy_id)` descending, where `effective_from ≤ Asia/Colombo confirmation date` and `created_at ≤ confirmation time`. No applicable policy blocks confirmation.
- **Same-date correction:** A later-published billing-policy row with the same `effective_from` supersedes only for *new* confirmations. Existing invoices retain their original FK; their calculations and no-show grace days remain unchanged.
- **Changed policy before confirmation:** Requires a refreshed quote and guest/staff reconfirmation.
- **Demo policy:** `is_demo=true`, all percentages/fees zero, `no_show_grace_days=1`. Production must reject `is_demo=true`.

## 3. Room Charge Calculation

Each room line's charge depends on its status:

| Line status | Room charge |
|---|---|
| BOOKED | Provisional: `rate_snapshot × reserved_nights` (shown in DRAFT) |
| CHECKED_IN | `rate_snapshot × reserved_nights` (even if guest leaves early) |
| CHECKED_OUT | `rate_snapshot × reserved_nights` (final, early departure retains full nights) |
| CANCELLED | No room-night charge; only the policy's flat `cancellation_fee` (if applicable) |
| NO_SHOW | No room-night charge; only the policy's flat `no_show_fee` (if applicable) |

Where:
- `reserved_nights = stay_end_date − stay_start_date` (half-open interval, integer days)
- `rate_snapshot` is the non-negative LKR `numeric(12,2)` base rate confirmed at booking
- Without an approved override, rooms of the same type confirmed together share the same base rate; different types may differ

## 4. Invoice Line Types and Domains

### 4.1 Invoice line type enum (§6.1.4 working proposal — TBD-07)

| Label | Sign | `booking_room_line_id` required? | Description |
|---|---|---|---|
| `ROOM` | Non-negative | Yes | `rate_snapshot × reserved_nights` for one room line |
| `SERVICE` | Non-negative | No (null = booking-wide) | Sum of rounded non-void `quantity × unit_price_snapshot` per service usage |
| `DISCOUNT` | Negative | No | Approved discount `D`, capped at `max_discount_percent` of `G` |
| `PERCENT_SERVICE_CHARGE` | Non-negative | No | Percentage service charge on `(G − D)`, rounded to 2 decimals |
| `TAX` | Non-negative | No | Tax on `(G − D + service_charge)`, rounded to 2 decimals |
| `CANCELLATION_FEE` | Non-negative | Yes | Flat fee from the linked policy for a CANCELLED line |
| `NO_SHOW_FEE` | Non-negative | Yes | Flat fee from the linked policy for a NO_SHOW line |
| `LATE_CHECKOUT_FEE` | Non-negative | Yes | Flat fee from the linked policy for a late checkout |
| `PRICE_ADJUSTMENT` | Signed | Yes or No | Explicit approved adjustment (not retroactive repricing) |

- `invoice_line.amount`: signed LKR `numeric(14,2)` — each line is rounded to 2 decimals before summing.
- `invoice_line.booking_room_line_id`: nullable FK; required for ROOM and room-specific adjustments, null for booking-wide adjustments. When populated, the referenced line must belong to the same booking as the invoice.

### 4.2 Ordered calculation (§4.7.4 Version 1 formula)

1. Compute each chargeable room line's ROOM amount = `rate_snapshot × reserved_nights`, rounded to 2 decimals.
2. Compute each non-void service usage amount = `quantity × unit_price_snapshot`, rounded to 2 decimals. Sum all as the SERVICE total.
3. Let **G** = sum of all ROOM + SERVICE amounts (all rounded line values).
4. DISCOUNT line: approved discount **D** (zero by default), where `0 ≤ D ≤ G` and `D ≤ G × max_discount_percent / 100`. DISCOUNT invoice line amount = `−D`.
5. PERCENT_SERVICE_CHARGE line: `round((G − D) × service_charge_percent / 100, 2)`.
6. TAX line: `round((G − D + service_charge) × tax_percent / 100, 2)`.
7. Flat fees (CANCELLATION_FEE, NO_SHOW_FEE, LATE_CHECKOUT_FEE, PRICE_ADJUSTMENT): added **after** tax; they do not enter the percentage bases.
8. **Invoice total** = sum of all signed `invoice_line.amount` values. Must not be negative after approved credits.

## 5. Payment and Refund Domains

### 5.1 Payment kind enum (§6.1.4 working proposal — TBD-07)

| Label | Description |
|---|---|
| `PAYMENT` | Guest payment toward the balance |
| `REFUND` | Staff-approved manual refund of a credit |

- `payment.amount`: positive LKR `numeric(14,2)` — both PAYMENT and REFUND store positive amounts.
- No automatic gateway or refund; both are manually recorded.

### 5.2 Payment status enum (§6.1.4 working proposal — TBD-07)

| Label | Affects balance? |
|---|---|
| `SUCCESSFUL` | Yes |
| `FAILED` | No |
| `REVERSED` | No (preserved for audit; balance reverted) |

### 5.3 Payment method enum (§6.1.4 working proposal — TBD-07)

| Label | Reference rule |
|---|---|
| `CASH` | Generated receipt reference |
| `BANK_TRANSFER` | Externally verified transfer reference |

### 5.4 Balance formula (FR-055)

```
outstanding_balance = invoice_line_total − successful_PAYMENT_sum + successful_REFUND_sum
```
- Positive balance = amount due
- Negative balance = credit (requires staff manual REFUND before checkout)
- Zero balance = required for each line checkout

### 5.5 Payment posting rules (FR-057, DBR-016)

- Reject a new PAYMENT if `amount > current positive balance`.
- Reject a new REFUND if `amount > current credit` (absolute value of negative balance).
- FAILED and REVERSED records are recorded but do not affect balance.
- Concurrent payment posting must re-read the balance under lock before accepting.

## 6. End-of-Stay Transitions

### 6.1 Per-line checkout (Member 4 owns)

1. Lock booking, selected line, its assignment, room and DRAFT invoice.
2. Verify line is CHECKED_IN and consolidated balance is exactly zero.
3. Set line → CHECKED_OUT, end actual occupancy segment, close its assignment.
4. Set that room → CLEANING via Member 3's condition/history operation (authorized FRONT_DESK checkout may invoke this internal CLEANING transition; it does not grant a general room-condition edit right).
5. Write line-status history, room-condition history and audit records.
6. If this makes all lines terminal and settled → issue FINAL invoice (assign number + `issued_at`).
7. Otherwise → show refreshed DRAFT provisional statement and any payment receipt.

### 6.2 Per-line cancellation (Member 4 owns)

- Eligible: BOOKED line before its no-show cutoff (`stay_start_date + no_show_grace_days` at 00:00 Asia/Colombo).
- Remove that line's provisional ROOM-night charge.
- Add only the linked policy's flat `cancellation_fee` as a CANCELLATION_FEE invoice line.
- Set line → CANCELLED, close its assignment, release inventory.
- Preserve all history; do not delete.
- Online guest may cancel their own BOOKED line before the cutoff (FR-084).

### 6.3 Whole-booking cancellation (Member 4 owns)

- Requires *every* line to be eligible for cancellation (all BOOKED, all before cutoff).
- Cancels all lines atomically; otherwise reject and staff may cancel individual eligible lines.

### 6.4 Per-line no-show (Member 4 owns)

- Eligible: BOOKED line at or after midnight Asia/Colombo on `stay_start_date + no_show_grace_days`.
- Demo default: 1 grace day → earliest cutoff is midnight after the scheduled arrival date.
- Replace provisional ROOM-night charges with the linked policy's flat `no_show_fee` as a NO_SHOW_FEE invoice line.
- Set line → NO_SHOW, close its assignment, preserve history.
- A pre-check-in date revision changes the derived cutoff, not the linked policy version.

## 7. Appendix C Review — Members 1–4

### TBD-03 (Production policy values)

- **Confirmed for Version 1:** Calculation order, typed policy structure and demo defaults are fixed in §4.7.4/§6.1.4.
- **Still open:** Actual production tax/service-charge/discount-limit percentages and flat fee values require authorized management/lecturer approval. Deployment must not silently reuse the demo row.

### TBD-07 (Domain labels)

This contract **adopts** the following §6.1.4 working proposals for Member 4–owned domains and requests Member 1–3 review:

| Domain | Adopted labels |
|---|---|
| `payment.kind` | PAYMENT, REFUND |
| `payment.status` | SUCCESSFUL, FAILED, REVERSED |
| `payment.method` | CASH, BANK_TRANSFER |
| `invoice.status` | DRAFT, FINAL |
| `invoice_line.line_type` | ROOM, SERVICE, DISCOUNT, PERCENT_SERVICE_CHARGE, TAX, CANCELLATION_FEE, NO_SHOW_FEE, LATE_CHECKOUT_FEE, PRICE_ADJUSTMENT |

Member 1 must separately review audit-action domains. Members 2/3 are consumers of line-type and payment contracts.

### TBD-08 (Numeric precision and sign)

This contract **adopts** the following §6.1.4 proposals:

| Column | Type | Sign |
|---|---|---|
| `invoice_line.amount` | `numeric(14,2)` LKR | Signed (DISCOUNT negative, others per line-type sign rules) |
| `payment.amount` | `numeric(14,2)` LKR | Positive only |
| `service.current_price` / `service_usage.unit_price_snapshot` | `numeric(12,2)` LKR | Non-negative (Member 3) |
| `service_usage.quantity` | `numeric(10,2)` | Positive (Member 3) |

All calculations use exact `numeric`; each invoice line is rounded to 2 LKR decimals before summing.

---

## 8. Worked Examples

### Example A: Two-Room Booking — Different Room Types (Single + Double)

**Setup:**
- Policy: demo (zero percentages/fees, 1 grace day)
- Room Line 1 (Single): rate_snapshot = LKR 5,000.00, stay 3 nights (Sep 1–Sep 4)
- Room Line 2 (Double): rate_snapshot = LKR 8,000.00, stay 3 nights (Sep 1–Sep 4)

**Both lines CHECKED_IN, no services, no discount:**

| Invoice line | Type | Line FK | Amount (LKR) |
|---|---|---|---|
| Single room charge | ROOM | Line 1 | 5,000.00 × 3 = **15,000.00** |
| Double room charge | ROOM | Line 2 | 8,000.00 × 3 = **24,000.00** |
| _Discount_ | DISCOUNT | null | 0.00 (demo: max_discount_percent = 0) |
| _Service charge_ | PERCENT_SERVICE_CHARGE | null | round((39,000.00 − 0.00) × 0 / 100, 2) = **0.00** |
| _Tax_ | TAX | null | round((39,000.00 − 0.00 + 0.00) × 0 / 100, 2) = **0.00** |
| **Invoice total** | | | **39,000.00** |

**Payments:** 3 × LKR 13,000.00 partial payments → balance = 39,000.00 − 39,000.00 = **0.00**.

**Checkout Line 1 (Single):**
- Balance = 0.00 ✓ → Line 1 → CHECKED_OUT, room → CLEANING
- Line 2 remains CHECKED_IN → DRAFT invoice shown as provisional statement

**Checkout Line 2 (Double):**
- Balance still 0.00 ✓ → Line 2 → CHECKED_OUT, room → CLEANING
- All lines terminal → issue FINAL invoice with number and `issued_at`

### Example B: Two Same-Type Rooms (2 × Single) — Partial Cancellation

**Setup:**
- Policy: demo (zero percentages/fees, 1 grace day)
- Room Line 1 (Single): rate_snapshot = LKR 5,000.00, stay 2 nights (Oct 5–Oct 7)
- Room Line 2 (Single): rate_snapshot = LKR 5,000.00, stay 2 nights (Oct 5–Oct 7)
- Same room type → same base rate confirmed together

**Line 2 cancelled before cutoff (before Oct 6 00:00 Asia/Colombo):**

| Invoice line | Type | Line FK | Amount (LKR) |
|---|---|---|---|
| Single room charge (Line 1) | ROOM | Line 1 | 5,000.00 × 2 = **10,000.00** |
| ~~Single room charge (Line 2)~~ | ~~ROOM~~ | ~~Line 2~~ | ~~removed (CANCELLED)~~ |
| Cancellation fee (Line 2) | CANCELLATION_FEE | Line 2 | **0.00** (demo) |
| **Invoice total** | | | **10,000.00** |

**Balance after LKR 10,000.00 payment = 0.00.**

**Checkout Line 1:** Line 1 → CHECKED_OUT; all lines now terminal → FINAL issued.

### Example C: Same Two Rooms — With a Corrected Policy

**Setup (illustrating same-date policy correction):**
- Policy v1 published Sep 20: effective_from = Sep 15, tax_percent = 0, service_charge_percent = 0
- Booking A confirmed Sep 21 → uses Policy v1
- Policy v2 published Sep 25: effective_from = Sep 15 (same date, later `created_at`), tax_percent = 10, service_charge_percent = 5
- Booking B confirmed Sep 26 → uses Policy v2 (latest by `created_at`)
- Booking A **retains** Policy v1 — its invoice FK is unchanged

**Booking A total (Policy v1, same example as A):** LKR 39,000.00 (zero tax/service charge)

**Booking B total (Policy v2, same rooms/nights):**

| Invoice line | Type | Amount (LKR) |
|---|---|---|
| Single room charge | ROOM | **15,000.00** |
| Double room charge | ROOM | **24,000.00** |
| G = 39,000.00 | | |
| Discount (0%) | DISCOUNT | **0.00** |
| Service charge | PERCENT_SERVICE_CHARGE | round(39,000.00 × 5 / 100, 2) = **1,950.00** |
| Tax | TAX | round((39,000.00 + 1,950.00) × 10 / 100, 2) = **4,095.00** |
| **Invoice total** | | **45,045.00** |

**Verification:** Booking A's balance uses v1 (LKR 39,000.00); Booking B's uses v2 (LKR 45,045.00). Each retains its own immutable policy FK.

### Example D: No-Show with Credit and Manual Refund

**Setup:**
- Policy: demo (no_show_fee = 0, no_show_grace_days = 1)
- Room Line 1 (Single): rate_snapshot = LKR 5,000.00, stay 2 nights (Nov 10–Nov 12)
- Guest made a LKR 10,000.00 advance payment

**Guest arrives Nov 10, checked in. Nov 11 at 00:00 cutoff passed (not applicable since checked in).**

**Alternative scenario — guest never arrives:**
- Nov 11 at 00:00 Asia/Colombo: cutoff reached (stay_start_date Nov 10 + 1 grace day)
- Staff marks Line 1 → NO_SHOW

| Invoice line | Type | Amount (LKR) |
|---|---|---|
| ~~Room charge~~ | ~~ROOM~~ | ~~removed (NO_SHOW)~~ |
| No-show fee | NO_SHOW_FEE | **0.00** (demo) |
| **Invoice total** | | **0.00** |

**Balance:** 0.00 (invoice total) − 10,000.00 (successful payment) + 0.00 (refunds) = **−10,000.00** (credit)

**Staff records REFUND of LKR 10,000.00:**
- Balance: 0.00 − 10,000.00 + 10,000.00 = **0.00** ✓
- All lines terminal, balance zero → issue FINAL invoice

---

## 9. Handoffs and Dependencies

| Consumer | What this contract provides |
|---|---|
| **Member 1** (Dulranga) | Invoice `billing_policy_id` FK contract; audit-action labels for PUBLISH, STATUS_CHANGE (review separately); policy selection ordering rule |
| **Member 2** (Imandi) | DRAFT invoice creation hook at booking confirmation; room-line rate/night charge derivation consumed by M4-S04; assignment closure consumed by M4-S09/S11/S12 |
| **Member 3** (Kulunu) | Service-usage quantity/price precision confirmed; room CLEANING transition from checkout; `booking_room_line_id` attribution FK for service usage |
| **Member 5** (Thusath) | Invoice/payment/charge status contracts for reports; DRAFT vs FINAL scope; monthly revenue by FINAL `issued_at` |

### Remaining decisions NOT resolved by this contract

1. **TBD-03:** Production policy values (tax, service charge, discount, fees) still require management/lecturer approval.
2. **TBD-15:** Staff permission matrix for billing/payment operations (Member 1/5 review).
3. **Lock order:** Members 2–4 must agree on a single PostgreSQL lock order for booking/line/assignment/room/invoice before implementation of M2-S06, M3 check-in and M4-S09 checkout procedures.
4. **Evaluator review:** Formal ER-to-target comparison remains pending.

---

## 10. Acceptance Criteria for M4-S01

| Criterion | Evidence |
|---|---|
| Appendix C review of TBD-07 domains | Adopted labels documented in §7 above |
| Appendix C review of TBD-08 numeric domains | Adopted precision/sign documented in §7 above |
| Two-room invoice totals (different types) | Example A: verified LKR 39,000.00 with demo policy |
| Two same-type rooms | Example B: verified equal base rates, partial cancellation |
| Old-vs-corrected policy | Example C: verified Booking A retains v1 (39,000.00), Booking B uses v2 (45,045.00) |
| Credit/refund lifecycle | Example D: verified no-show → credit → manual refund → zero balance → FINAL |
| Same-date policy correction documented | §2, Example C |
| Payment status/method proposals reviewed | §5, no new labels invented |
| Formula and rounding order documented | §4.2 matches §4.7.4 exactly |
