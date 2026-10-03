import { DbClient } from './invoiceService.js';
import { CheckoutLineParams, CheckoutResult, CheckoutReceipt } from '../models/checkout.js';

/**
 * Executes a locked, atomic room-line checkout transaction.
 *
 * Invariants enforced by database function fn_checkout_room_line:
 * 1. Pessimistic row locks on booking, invoice, line, assignment, and room.
 * 2. Consolidated balance must be exactly zero (rejects positive unpaid balance or unrefunded credit).
 * 3. The line must be currently CHECKED_IN.
 * 4. The line's open assignment is closed and its occupancy segment completed.
 * 5. The line is set to CHECKED_OUT and line-status history is appended.
 * 6. The room's physical condition is set to CLEANING via Member 3's condition operation and room-status history is appended.
 * 7. If another line remains active, invoice remains DRAFT and provisional statement is returned.
 * 8. If every line is now terminal, the single FINAL invoice is issued and finalized.
 */
export async function checkoutRoomLine(
  db: DbClient,
  params: CheckoutLineParams,
): Promise<CheckoutResult & { receipt: CheckoutReceipt }> {
  const { bookingId, lineId, actorId, reason = 'Guest checkout' } = params;

  const res = await db.query<CheckoutResult>(
    `SELECT
        booking_id,
        line_id,
        room_id,
        room_number,
        room_condition,
        checked_out_at,
        checked_out_by,
        remaining_active_lines,
        is_finalized,
        invoice_id,
        invoice_number,
        issued_at,
        provisional_statement_ref
       FROM fn_checkout_room_line($1, $2, $3, $4)`,
    [bookingId, lineId, actorId, reason],
  );

  if (res.rows.length === 0) {
    throw new Error('Checkout failed: no result returned from database');
  }

  const row = res.rows[0];

  const receipt: CheckoutReceipt = {
    statement_reference: row.provisional_statement_ref,
    booking_id: row.booking_id,
    line_id: row.line_id,
    room_id: row.room_id,
    room_number: row.room_number,
    room_condition: 'CLEANING',
    checked_out_at: row.checked_out_at,
    checked_out_by: row.checked_out_by,
    remaining_active_lines: Number(row.remaining_active_lines),
    is_finalized: row.is_finalized,
    invoice_id: row.invoice_id,
    invoice_number: row.invoice_number,
    issued_at: row.issued_at,
  };

  return {
    ...row,
    remaining_active_lines: Number(row.remaining_active_lines),
    receipt,
  };
}
