import { DbClient } from './invoiceService.js';
import {
  PostPaymentParams,
  PaymentPostingResult,
  ReversePaymentResult,
} from '../models/payment.js';

/**
 * Posts a locked payment or refund for a booking using fn_record_payment.
 * Under pessimistic row-level locks on booking and invoice, this re-evaluates
 * the authoritative balance and enforces that:
 * 1. PAYMENT cannot exceed the positive balance.
 * 2. REFUND cannot exceed the existing credit balance (negative balance).
 * 3. FAILED records are tracked without adjusting net balance.
 * 4. Duplicate references are rejected.
 */
export async function recordPayment(
  db: DbClient,
  params: PostPaymentParams,
): Promise<PaymentPostingResult> {
  const {
    bookingId,
    recordedBy,
    kind,
    amount,
    method,
    reference,
    status = 'SUCCESSFUL',
    paidAt,
  } = params;

  const res = await db.query<PaymentPostingResult>(
    `SELECT
        payment_id,
        booking_id,
        recorded_by,
        kind,
        amount,
        status,
        method,
        reference,
        paid_at,
        recorded_at,
        previous_balance,
        new_balance,
        is_credit,
        credit_amount
       FROM fn_record_payment($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      bookingId,
      recordedBy,
      kind,
      amount,
      method,
      reference,
      status,
      paidAt ? new Date(paidAt).toISOString() : null,
    ],
  );

  if (res.rows.length === 0) {
    throw new Error('Failed to record payment: no record returned from database');
  }

  return res.rows[0];
}

/**
 * Reverses a previously SUCCESSFUL payment or refund using fn_reverse_payment.
 * Transitions status to REVERSED under locks and recalculates outstanding balance.
 */
export async function reversePayment(
  db: DbClient,
  paymentId: string,
  userId: string,
): Promise<ReversePaymentResult> {
  const res = await db.query<ReversePaymentResult>(
    `SELECT
        payment_id,
        booking_id,
        kind,
        amount,
        status,
        reference,
        previous_balance,
        new_balance
       FROM fn_reverse_payment($1, $2)`,
    [paymentId, userId],
  );

  if (res.rows.length === 0) {
    throw new Error('Failed to reverse payment: no record returned from database');
  }

  return res.rows[0];
}

/**
 * Retrieves the outstanding balance for a booking using fn_outstanding_balance.
 */
export async function getOutstandingBalance(
  db: DbClient,
  bookingId: string,
): Promise<number> {
  const res = await db.query<{ balance: string }>(
    `SELECT fn_outstanding_balance($1) AS balance`,
    [bookingId],
  );

  if (res.rows.length === 0 || res.rows[0].balance === null) {
    return 0.0;
  }

  return parseFloat(res.rows[0].balance);
}
