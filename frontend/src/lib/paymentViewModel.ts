/**
 * Payment view model for M4-S14.
 *
 * Wraps the API responses from:
 *   GET  /api/bookings/:bookingId/payments           — payment history + balance summary
 *   POST /api/bookings/:bookingId/payments            — record a payment or FAILED attempt
 *   POST /api/bookings/:bookingId/refunds             — staff-approved manual refund
 *   POST /api/payments/:paymentId/reverse             — reverse a SUCCESSFUL payment/refund
 *
 * All amounts are LKR numeric(14,2) strings from PostgreSQL; parsed into
 * display strings only via formatLkr / toMoneyString so no binary-float
 * rounding can enter the displayed totals.
 */

import { formatLkr, toMoneyString } from './money';
import { RawPayment, RawPaymentHistory } from './invoiceViewModel';

export type { RawPayment, RawPaymentHistory };
export type { PaymentKind, PaymentStatus, PaymentMethod } from './invoiceViewModel';

// ─── Derived payment view shapes ─────────────────────────────────────────────

export interface PaymentRowView {
  paymentId: string;
  bookingId: string;
  kind: 'PAYMENT' | 'REFUND';
  status: 'SUCCESSFUL' | 'FAILED' | 'REVERSED';
  method: 'CASH' | 'BANK_TRANSFER';
  /** Raw LKR string, always positive */
  amount: string;
  amountFormatted: string;
  reference: string;
  paidAt: Date;
  recordedAt: Date;
  /** True for REFUND, false for PAYMENT */
  isRefund: boolean;
  isSuccessful: boolean;
  isFailed: boolean;
  isReversed: boolean;
  /** SUCCESSFUL PAYMENT -> can be reversed */
  canReverse: boolean;
  statusLabel: string;
  methodLabel: string;
  kindLabel: string;
}

export interface PaymentBalanceSummary {
  successfulPaymentsTotal: number;
  successfulRefundsTotal: number;
  netPayments: number;
  invoiceTotal: number;
  outstandingBalance: number;
  creditAmount: number;
  isCredit: boolean;
  isSettled: boolean;
  /** Formatted display strings */
  successfulPaymentsTotalFormatted: string;
  successfulRefundsTotalFormatted: string;
  netPaymentsFormatted: string;
  invoiceTotalFormatted: string;
  outstandingBalanceFormatted: string;
  creditAmountFormatted: string;
}

export interface PaymentHistoryView {
  bookingId: string;
  rows: PaymentRowView[];
  summary: PaymentBalanceSummary;
}

// ─── Payment form draft ───────────────────────────────────────────────────────

export type PaymentFormMode = 'PAYMENT' | 'REFUND';

export interface PaymentFormDraft {
  mode: PaymentFormMode;
  amount: string;
  method: 'CASH' | 'BANK_TRANSFER';
  reference: string;
  /** false = SUCCESSFUL; true = FAILED (records failed attempt only, no balance effect) */
  recordAsFailed: boolean;
}

export function blankPaymentDraft(mode: PaymentFormMode = 'PAYMENT'): PaymentFormDraft {
  return {
    mode,
    amount: '',
    method: 'CASH',
    reference: '',
    recordAsFailed: false,
  };
}

export interface PaymentFormValidation {
  isValid: boolean;
  amountError: string | null;
  methodError: string | null;
}

export function validatePaymentDraft(draft: PaymentFormDraft): PaymentFormValidation {
  let amountError: string | null = null;
  let methodError: string | null = null;

  const num = parseFloat(draft.amount.trim());
  if (!draft.amount.trim()) {
    amountError = 'Amount is required.';
  } else if (isNaN(num) || num <= 0) {
    amountError = 'Amount must be a positive number greater than zero.';
  } else {
    const decimalPlaces = (draft.amount.trim().split('.')[1] ?? '').length;
    if (decimalPlaces > 2) {
      amountError = 'Amount cannot have more than 2 decimal places.';
    }
  }

  if (!['CASH', 'BANK_TRANSFER'].includes(draft.method)) {
    methodError = 'Select a payment method.';
  }

  return {
    isValid: amountError === null && methodError === null,
    amountError,
    methodError,
  };
}

// ─── Transformers ─────────────────────────────────────────────────────────────

function buildPaymentRowView(raw: RawPayment): PaymentRowView {
  const isRefund = raw.kind === 'REFUND';
  const isSuccessful = raw.status === 'SUCCESSFUL';
  const isFailed = raw.status === 'FAILED';
  const isReversed = raw.status === 'REVERSED';
  const canReverse = isSuccessful && !isRefund; // only SUCCESSFUL PAYMENT can be reversed

  const STATUS_LABELS: Record<string, string> = {
    SUCCESSFUL: 'Successful',
    FAILED: 'Failed',
    REVERSED: 'Reversed',
  };
  const METHOD_LABELS: Record<string, string> = {
    CASH: 'Cash',
    BANK_TRANSFER: 'Bank Transfer',
  };
  const KIND_LABELS: Record<string, string> = {
    PAYMENT: 'Payment',
    REFUND: 'Refund',
  };

  return {
    paymentId: raw.payment_id,
    bookingId: raw.booking_id,
    kind: raw.kind,
    status: raw.status,
    method: raw.method,
    amount: toMoneyString(raw.amount),
    amountFormatted: formatLkr(raw.amount),
    reference: raw.reference,
    paidAt: new Date(raw.paid_at),
    recordedAt: new Date(raw.recorded_at),
    isRefund,
    isSuccessful,
    isFailed,
    isReversed,
    canReverse,
    statusLabel: STATUS_LABELS[raw.status] ?? raw.status,
    methodLabel: METHOD_LABELS[raw.method] ?? raw.method,
    kindLabel: KIND_LABELS[raw.kind] ?? raw.kind,
  };
}

function buildBalanceSummary(raw: RawPaymentHistory['summary']): PaymentBalanceSummary {
  const abs = (n: number) => Math.abs(n);
  return {
    successfulPaymentsTotal: raw.successful_payments_total,
    successfulRefundsTotal: raw.successful_refunds_total,
    netPayments: raw.net_payments,
    invoiceTotal: raw.invoice_total,
    outstandingBalance: raw.outstanding_balance,
    creditAmount: raw.credit_amount,
    isCredit: raw.is_credit,
    isSettled: raw.is_settled,
    successfulPaymentsTotalFormatted: formatLkr(toMoneyString(raw.successful_payments_total)),
    successfulRefundsTotalFormatted: formatLkr(toMoneyString(raw.successful_refunds_total)),
    netPaymentsFormatted: formatLkr(toMoneyString(raw.net_payments)),
    invoiceTotalFormatted: formatLkr(toMoneyString(raw.invoice_total)),
    outstandingBalanceFormatted: formatLkr(toMoneyString(abs(raw.outstanding_balance))),
    creditAmountFormatted: formatLkr(toMoneyString(raw.credit_amount)),
  };
}

export function buildPaymentHistoryView(raw: RawPaymentHistory): PaymentHistoryView {
  return {
    bookingId: raw.booking_id,
    rows: raw.payments.map(buildPaymentRowView),
    summary: buildBalanceSummary(raw.summary),
  };
}

// ─── Optimistic update helpers ────────────────────────────────────────────────

/**
 * After a successful POST, merge the new payment into an existing history view
 * without a full re-fetch. Used to give instant feedback in the UI.
 */
export function applyPaymentReceipt(
  prev: PaymentHistoryView,
  receipt: {
    payment_id: string;
    booking_id: string;
    kind: 'PAYMENT' | 'REFUND';
    amount: number;
    method: 'CASH' | 'BANK_TRANSFER';
    status: 'SUCCESSFUL' | 'FAILED' | 'REVERSED';
    reference: string;
    paid_at: string;
    recorded_at: string;
    new_balance: number;
    is_credit: boolean;
    credit_amount: number;
  },
): PaymentHistoryView {
  const newRow: RawPayment = {
    payment_id: receipt.payment_id,
    booking_id: receipt.booking_id,
    kind: receipt.kind,
    amount: receipt.amount.toFixed(2),
    method: receipt.method,
    status: receipt.status,
    reference: receipt.reference,
    paid_at: receipt.paid_at,
    recorded_at: receipt.recorded_at,
    recorded_by: '',
  };

  const updatedRows = [buildPaymentRowView(newRow), ...prev.rows];

  // Rebuild summary based on updated rows
  const updatedSummary = rebuildSummaryFromRows(updatedRows, prev.summary.invoiceTotal);
  return { ...prev, rows: updatedRows, summary: updatedSummary };
}

function rebuildSummaryFromRows(
  rows: PaymentRowView[],
  invoiceTotal: number,
): PaymentBalanceSummary {
  let successPayments = 0;
  let successRefunds = 0;
  for (const r of rows) {
    if (r.isSuccessful) {
      if (r.isRefund) successRefunds += parseFloat(r.amount);
      else successPayments += parseFloat(r.amount);
    }
  }
  const netPayments = successPayments - successRefunds;
  const outstandingBalance = invoiceTotal - netPayments;
  const isCredit = outstandingBalance < 0;
  const creditAmount = isCredit ? Math.abs(outstandingBalance) : 0;
  const isSettled = outstandingBalance === 0;

  const abs = (n: number) => Math.abs(n);
  return {
    successfulPaymentsTotal: successPayments,
    successfulRefundsTotal: successRefunds,
    netPayments,
    invoiceTotal,
    outstandingBalance,
    creditAmount,
    isCredit,
    isSettled,
    successfulPaymentsTotalFormatted: formatLkr(toMoneyString(successPayments)),
    successfulRefundsTotalFormatted: formatLkr(toMoneyString(successRefunds)),
    netPaymentsFormatted: formatLkr(toMoneyString(netPayments)),
    invoiceTotalFormatted: formatLkr(toMoneyString(invoiceTotal)),
    outstandingBalanceFormatted: formatLkr(toMoneyString(abs(outstandingBalance))),
    creditAmountFormatted: formatLkr(toMoneyString(creditAmount)),
  };
}

// ─── Error helpers ────────────────────────────────────────────────────────────

export type ApiErrorCode =
  | 'AUTHENTICATION_REQUIRED'
  | 'FORBIDDEN'
  | 'BOOKING_NOT_FOUND'
  | 'OVERPAYMENT_NOT_ALLOWED'
  | 'OVER_REFUND_NOT_ALLOWED'
  | 'NO_OUTSTANDING_BALANCE'
  | 'NO_CREDIT_TO_REFUND'
  | 'DUPLICATE_REFERENCE'
  | 'INVOICE_FINAL'
  | 'INVALID_PAYMENT_STATE'
  | 'UNKNOWN_ERROR';

export function describePaymentError(code: string, message: string): string {
  const MESSAGES: Partial<Record<ApiErrorCode, string>> = {
    AUTHENTICATION_REQUIRED: 'Authentication required. Please log in before posting payments.',
    FORBIDDEN: 'Access denied. Only staff may record or reverse payments.',
    BOOKING_NOT_FOUND: 'Booking not found.',
    OVERPAYMENT_NOT_ALLOWED:
      'Payment exceeds the outstanding balance. Reduce the amount or pay the exact balance.',
    OVER_REFUND_NOT_ALLOWED:
      'Refund exceeds the available credit. Reduce the refund amount.',
    NO_OUTSTANDING_BALANCE:
      'There is no outstanding balance to pay. The booking is already settled.',
    NO_CREDIT_TO_REFUND:
      'There is no credit balance to refund. Post a refund only when overpayment exists.',
    DUPLICATE_REFERENCE:
      'This reference already exists. Provide a unique payment reference.',
    INVOICE_FINAL:
      'Payments cannot be added after the invoice has been finalized.',
    INVALID_PAYMENT_STATE:
      'Only SUCCESSFUL payments can be reversed.',
  };
  return MESSAGES[code as ApiErrorCode] ?? message ?? 'An unexpected error occurred.';
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

export interface FetchOptions {
  apiBase: string;
  headers?: Record<string, string>;
}

export type PaymentHistoryResult =
  | { ok: true; data: RawPaymentHistory }
  | { ok: false; status: number; code: string; message: string };

export async function fetchPaymentHistory(
  bookingId: string,
  opts: FetchOptions,
): Promise<PaymentHistoryResult> {
  const url = `${opts.apiBase}/bookings/${encodeURIComponent(bookingId)}/payments`;
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        code: payload?.error?.code ?? 'UNKNOWN_ERROR',
        message: payload?.error?.message ?? 'Failed to load payment history',
      };
    }
    return { ok: true, data: payload as RawPaymentHistory };
  } catch {
    return { ok: false, status: 0, code: 'NETWORK_ERROR', message: 'Unable to reach the billing service.' };
  }
}

export type PostPaymentResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; status: number; code: string; message: string };

export async function postPayment(
  bookingId: string,
  body: {
    amount: number;
    method: 'CASH' | 'BANK_TRANSFER';
    kind: 'PAYMENT' | 'REFUND';
    status: 'SUCCESSFUL' | 'FAILED';
    reference?: string;
  },
  opts: FetchOptions,
): Promise<PostPaymentResult> {
  const url = `${opts.apiBase}/bookings/${encodeURIComponent(bookingId)}/payments`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
      body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        code: payload?.error?.code ?? 'UNKNOWN_ERROR',
        message: payload?.error?.message ?? 'Payment post failed',
      };
    }
    return { ok: true, data: payload };
  } catch {
    return { ok: false, status: 0, code: 'NETWORK_ERROR', message: 'Unable to reach the billing service.' };
  }
}

export type ReversePaymentResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; status: number; code: string; message: string };

export async function reversePaymentRequest(
  paymentId: string,
  opts: FetchOptions,
): Promise<ReversePaymentResult> {
  const url = `${opts.apiBase}/payments/${encodeURIComponent(paymentId)}/reverse`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        code: payload?.error?.code ?? 'UNKNOWN_ERROR',
        message: payload?.error?.message ?? 'Reversal failed',
      };
    }
    return { ok: true, data: payload };
  } catch {
    return { ok: false, status: 0, code: 'NETWORK_ERROR', message: 'Unable to reach the billing service.' };
  }
}
