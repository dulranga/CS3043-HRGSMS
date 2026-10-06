import { ActorContext, DbClient, verifyBookingAccess } from './invoiceService.js';
import {
  PostPaymentParams,
  PaymentPostingResult,
  ReversePaymentResult,
} from '../models/payment.js';

export interface PaymentReceipt {
  receipt_reference: string;
  booking_id: string;
  payment_id: string;
  kind: 'PAYMENT' | 'REFUND';
  amount: number;
  method: 'CASH' | 'BANK_TRANSFER';
  status: 'SUCCESSFUL' | 'FAILED' | 'REVERSED';
  paid_at: string;
  recorded_at: string;
  recorded_by: string;
  previous_balance: number;
  new_balance: number;
  is_credit: boolean;
  credit_amount: number;
  is_settled: boolean;
}

/**
 * Generates a stable, structured payment or refund reference when not provided.
 * Format: PAY-YYYYMMDD-XXXXXX or REF-YYYYMMDD-XXXXXX
 */
export function generatePaymentReference(kind: 'PAYMENT' | 'REFUND'): string {
  const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomSuffix = Math.floor(100000 + Math.random() * 900000).toString();
  const prefix = kind === 'REFUND' ? 'REF' : 'PAY';
  return `${prefix}-${datePrefix}-${randomSuffix}`;
}

/**
 * Verifies that the actor has authorized staff access to record payments or refunds.
 * Rejects online guests and cross-branch staff without chain-wide authority.
 */
export async function verifyStaffPaymentAccess(
  db: DbClient,
  bookingId: string,
  actor: ActorContext,
): Promise<{
  allowed: boolean;
  statusCode: number;
  reason?: string;
  branchId?: string | null;
}> {
  const access = await verifyBookingAccess(db, bookingId, actor);
  if (!access.allowed) {
    return access;
  }
  if (access.actorType !== 'STAFF') {
    return {
      allowed: false,
      statusCode: 403,
      reason: 'Access denied: online guests are not authorized to record staff payments or refunds',
    };
  }
  return access;
}


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
       FROM fn_record_payment(
        $1::uuid,
        $2::uuid,
        $3::payment_kind_enum,
        $4::numeric,
        $5::payment_method_enum,
        $6::varchar,
        $7::payment_status_enum,
        $8::timestamptz
       )`,
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
