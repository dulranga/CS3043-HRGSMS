/**
 * Checkout view model for M4-S15.
 *
 * Wraps the API responses for the checkout endpoints:
 *   POST /api/bookings/:bookingId/lines/:lineId/checkout
 *   GET /api/bookings/:bookingId/lines/:lineId/checkout
 */

export interface RawCheckoutResult {
  success: boolean;
  message: string;
  booking_id: string;
  line_id: string;
  room_id: string;
  room_number: string;
  room_condition: 'READY' | 'CLEANING' | 'OUT_OF_SERVICE';
  checked_out_at: string;
  checked_out_by: string;
  remaining_active_lines: number;
  is_finalized: boolean;
  invoice_id: string | null;
  invoice_number: string | null;
  issued_at: string | null;
  provisional_statement_ref: string;
  receipt?: any;
}

export type ApiErrorCode =
  | 'AUTHENTICATION_REQUIRED'
  | 'FORBIDDEN'
  | 'BOOKING_NOT_FOUND'
  | 'ROOM_LINE_NOT_FOUND'
  | 'INVALID_LINE_ID'
  | 'LINE_ALREADY_CHECKED_OUT'
  | 'INVOICE_ALREADY_FINAL'
  | 'OUTSTANDING_BALANCE_DUE'
  | 'UNREFUNDED_CREDIT_REMAINING'
  | 'INVALID_LINE_STATUS'
  | 'LINE_BOOKING_MISMATCH'
  | 'NO_OPEN_ASSIGNMENT'
  | 'NOT_CHECKED_OUT'
  | 'UNKNOWN_ERROR';

export function describeCheckoutError(code: string, message: string): string {
  const MESSAGES: Partial<Record<ApiErrorCode, string>> = {
    AUTHENTICATION_REQUIRED: 'Authentication required. Please log in.',
    FORBIDDEN: 'Access denied. Only staff may process checkouts.',
    BOOKING_NOT_FOUND: 'Booking not found.',
    ROOM_LINE_NOT_FOUND: 'Room line not found.',
    INVALID_LINE_ID: 'Invalid room line ID.',
    LINE_ALREADY_CHECKED_OUT: 'This room is already checked out.',
    INVOICE_ALREADY_FINAL: 'Checkout not allowed. The invoice is already final.',
    OUTSTANDING_BALANCE_DUE: 'Checkout denied: there is an outstanding balance due.',
    UNREFUNDED_CREDIT_REMAINING: 'Checkout denied: there is an unrefunded credit balance.',
    INVALID_LINE_STATUS: 'Room line must be CHECKED_IN to process checkout.',
    LINE_BOOKING_MISMATCH: 'Room line does not belong to this booking.',
    NO_OPEN_ASSIGNMENT: 'No active room assignment found for this line.',
    NOT_CHECKED_OUT: 'Room line is not currently checked out.',
  };
  return MESSAGES[code as ApiErrorCode] ?? message ?? 'An unexpected error occurred during checkout.';
}

export interface FetchOptions {
  apiBase: string;
  headers?: Record<string, string>;
}

export type PostCheckoutResponse =
  | { ok: true; data: RawCheckoutResult }
  | { ok: false; status: number; code: string; message: string };

export async function postCheckout(
  bookingId: string,
  lineId: string,
  reason: string,
  opts: FetchOptions,
): Promise<PostCheckoutResponse> {
  const url = `${opts.apiBase}/bookings/${encodeURIComponent(bookingId)}/lines/${encodeURIComponent(lineId)}/checkout`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
      body: JSON.stringify({ reason }),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        code: payload?.error?.code ?? 'UNKNOWN_ERROR',
        message: payload?.error?.message ?? 'Checkout failed.',
      };
    }
    return { ok: true, data: payload as RawCheckoutResult };
  } catch {
    return { ok: false, status: 0, code: 'NETWORK_ERROR', message: 'Unable to reach the checkout service.' };
  }
}
