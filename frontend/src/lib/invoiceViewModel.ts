/**
 * Invoice detail view model for M4-S13.
 *
 * Wraps the API response from GET /api/bookings/:bookingId/invoice and
 * GET /api/bookings/:bookingId/payments, providing typed shapes and display
 * helpers for the InvoiceDetailPanel UI.
 */

import { formatLkr, toMoneyString } from './money';

// ─── Raw API shapes (mirror of backend InvoiceDetailResponse) ────────────────

export type InvoiceStatus = 'DRAFT' | 'FINAL';

export type InvoiceLineType =
  | 'ROOM_NIGHT'
  | 'SERVICE'
  | 'DISCOUNT'
  | 'SERVICE_CHARGE'
  | 'TAX'
  | 'CANCELLATION_FEE'
  | 'NO_SHOW_FEE'
  | 'LATE_CHECKOUT_FEE'
  | 'ADJUSTMENT';

export interface RawInvoiceLine {
  invoice_line_id: string;
  invoice_id: string;
  line_type: InvoiceLineType;
  booking_room_line_id: string | null;
  description: string;
  amount: string; // LKR numeric string e.g. "6000.00"
}

export interface RawInvoiceSummary {
  total_amount: number;
  successful_payments: number;
  successful_refunds: number;
  net_payments: number;
  outstanding_balance: number;
  credit_amount: number;
  is_credit: boolean;
  is_settled: boolean;
  is_provisional: boolean;
}

export interface RawInvoiceDetail {
  invoice_id: string;
  booking_id: string;
  billing_policy_id: string;
  invoice_number: string | null;
  status: InvoiceStatus;
  is_provisional: boolean;
  issued_at: string | null;
  created_at: string;
  lines: RawInvoiceLine[];
  summary: RawInvoiceSummary;
}

export type PaymentKind = 'PAYMENT' | 'REFUND';
export type PaymentStatus = 'SUCCESSFUL' | 'FAILED' | 'REVERSED';
export type PaymentMethod = 'CASH' | 'BANK_TRANSFER';

export interface RawPayment {
  payment_id: string;
  booking_id: string;
  recorded_by: string;
  kind: PaymentKind;
  amount: string;
  method: PaymentMethod;
  status: PaymentStatus;
  reference: string;
  paid_at: string;
  recorded_at: string;
}

export interface RawPaymentHistory {
  booking_id: string;
  payments: RawPayment[];
  summary: {
    successful_payments_total: number;
    successful_refunds_total: number;
    net_payments: number;
    invoice_total: number;
    outstanding_balance: number;
    credit_amount: number;
    is_credit: boolean;
    is_settled: boolean;
  };
}

// ─── Derived view shapes ──────────────────────────────────────────────────────

/**
 * SRS §4.7.4 line ordering tiers.
 * Lower tier = appears first in the rendered table.
 */
const LINE_ORDER: Record<InvoiceLineType, number> = {
  ROOM_NIGHT: 1,
  SERVICE: 2,
  DISCOUNT: 3,
  SERVICE_CHARGE: 4,
  TAX: 5,
  CANCELLATION_FEE: 6,
  NO_SHOW_FEE: 7,
  LATE_CHECKOUT_FEE: 8,
  ADJUSTMENT: 9,
};

export interface InvoiceLineView {
  id: string;
  lineType: InvoiceLineType;
  roomLineId: string | null;
  description: string;
  /** Raw numeric string (negative for DISCOUNT) */
  amount: string;
  /** Formatted as "LKR X,XXX.XX" */
  amountFormatted: string;
  /** True if this line reduces the total (negative amount) */
  isDeduction: boolean;
  /** SRS display label for line_type */
  typeLabel: string;
  sortOrder: number;
}

export interface InvoiceDetailView {
  invoiceId: string;
  bookingId: string;
  billingPolicyId: string;
  invoiceNumber: string | null;
  status: InvoiceStatus;
  isProvisional: boolean;
  issuedAt: Date | null;
  createdAt: Date;

  /** Lines sorted per SRS §4.7.4 ordering */
  lines: InvoiceLineView[];

  /** Lines that belong to a specific room line (charges) */
  roomLines: Array<{
    roomLineId: string;
    lines: InvoiceLineView[];
    subtotalFormatted: string;
  }>;

  /** Lines that are booking-wide (fees, adjustments, tax) */
  bookingWideLines: InvoiceLineView[];

  summary: {
    totalAmountFormatted: string;
    netPaymentsFormatted: string;
    outstandingBalanceFormatted: string;
    creditAmountFormatted: string;
    isCredit: boolean;
    isSettled: boolean;
    successfulPayments: number;
    successfulRefunds: number;
  };
}

const LINE_TYPE_LABELS: Record<InvoiceLineType, string> = {
  ROOM_NIGHT: 'Room Night Charge',
  SERVICE: 'Service',
  DISCOUNT: 'Discount',
  SERVICE_CHARGE: 'Service Charge',
  TAX: 'Tax',
  CANCELLATION_FEE: 'Cancellation Fee',
  NO_SHOW_FEE: 'No-Show Fee',
  LATE_CHECKOUT_FEE: 'Late Checkout Fee',
  ADJUSTMENT: 'Adjustment',
};

function buildLineView(raw: RawInvoiceLine): InvoiceLineView {
  const amount = toMoneyString(raw.amount);
  const numeric = parseFloat(amount);
  const isDeduction = numeric < 0;
  return {
    id: raw.invoice_line_id,
    lineType: raw.line_type,
    roomLineId: raw.booking_room_line_id,
    description: raw.description,
    amount,
    amountFormatted: formatLkr(amount),
    isDeduction,
    typeLabel: LINE_TYPE_LABELS[raw.line_type] ?? raw.line_type,
    sortOrder: LINE_ORDER[raw.line_type] ?? 99,
  };
}

export function buildInvoiceDetailView(raw: RawInvoiceDetail): InvoiceDetailView {
  const lines = raw.lines
    .map(buildLineView)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.description.localeCompare(b.description));

  // Group lines that have a room line FK (per-room charges) vs booking-wide
  const roomLineMap = new Map<string, InvoiceLineView[]>();
  const bookingWideLines: InvoiceLineView[] = [];

  for (const line of lines) {
    if (line.roomLineId) {
      if (!roomLineMap.has(line.roomLineId)) {
        roomLineMap.set(line.roomLineId, []);
      }
      roomLineMap.get(line.roomLineId)!.push(line);
    } else {
      bookingWideLines.push(line);
    }
  }

  const roomLines = Array.from(roomLineMap.entries()).map(([roomLineId, rl]) => {
    const subtotal = rl.reduce((acc, l) => acc + parseFloat(l.amount), 0);
    return {
      roomLineId,
      lines: rl,
      subtotalFormatted: formatLkr(subtotal.toFixed(2)),
    };
  });

  const s = raw.summary;
  return {
    invoiceId: raw.invoice_id,
    bookingId: raw.booking_id,
    billingPolicyId: raw.billing_policy_id,
    invoiceNumber: raw.invoice_number,
    status: raw.status,
    isProvisional: raw.is_provisional,
    issuedAt: raw.issued_at ? new Date(raw.issued_at) : null,
    createdAt: new Date(raw.created_at),
    lines,
    roomLines,
    bookingWideLines,
    summary: {
      totalAmountFormatted: formatLkr(toMoneyString(s.total_amount)),
      netPaymentsFormatted: formatLkr(toMoneyString(s.net_payments)),
      outstandingBalanceFormatted: formatLkr(toMoneyString(Math.abs(s.outstanding_balance))),
      creditAmountFormatted: formatLkr(toMoneyString(s.credit_amount)),
      isCredit: s.is_credit,
      isSettled: s.is_settled,
      successfulPayments: s.successful_payments,
      successfulRefunds: s.successful_refunds,
    },
  };
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

export interface InvoiceFetchOptions {
  bookingId: string;
  apiBase: string;
  headers?: Record<string, string>;
}

export type InvoiceFetchResult =
  | { ok: true; data: RawInvoiceDetail }
  | { ok: false; status: number; code: string; message: string };

export async function fetchInvoiceDetail(opts: InvoiceFetchOptions): Promise<InvoiceFetchResult> {
  const url = `${opts.apiBase}/bookings/${encodeURIComponent(opts.bookingId)}/invoice`;
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
        message: payload?.error?.message ?? 'Failed to load invoice',
      };
    }

    return { ok: true, data: payload as RawInvoiceDetail };
  } catch {
    return { ok: false, status: 0, code: 'NETWORK_ERROR', message: 'Unable to reach the billing service.' };
  }
}

export function describeInvoiceError(result: Extract<InvoiceFetchResult, { ok: false }>): string {
  if (result.status === 401) return 'Authentication required. Please log in to view the invoice.';
  if (result.status === 403) return 'Access denied. You do not have permission to view this invoice.';
  if (result.status === 404) return 'No invoice found for this booking.';
  return result.message || 'Failed to load invoice details.';
}
