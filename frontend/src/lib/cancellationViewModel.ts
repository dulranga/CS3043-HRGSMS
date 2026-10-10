/**
 * Cancellation view model for M4-S16.
 *
 * Wraps the API responses for the cancellation endpoints:
 *   GET  /api/bookings/:bookingId/lines/:lineId/cancellation-quote
 *   GET  /api/bookings/:bookingId/cancellation-quote
 *   POST /api/bookings/:bookingId/lines/:lineId/cancel
 *   POST /api/bookings/:bookingId/cancel-all
 */

export interface RawCancellationQuote {
  booking_id: string;
  line_id?: string;
  is_eligible: boolean;
  stay_start_date?: string;
  cutoff_deadline?: string;
  cancellation_fee: number;
  rejection_reason?: string;
}

export interface RawCancelLineResult {
  success?: boolean;
  booking_id: string;
  line_id: string;
  status: 'CANCELLED';
  cancelled_at: string;
  cancelled_by: string;
  cancellation_fee: number;
  remaining_active_lines: number;
  new_outstanding_balance?: number;
  outstanding_balance?: number;
  is_credit: boolean;
  credit_amount: number;
  receipt?: any;
}

export interface RawCancelWholeBookingResult {
  success?: boolean;
  booking_id: string;
  cancelled_lines_count: number;
  cancelled_line_ids: string[];
  cancelled_at: string;
  cancelled_by: string;
  total_cancellation_fees: number;
  remaining_active_lines: number;
  new_outstanding_balance?: number;
  outstanding_balance?: number;
  is_credit: boolean;
  credit_amount: number;
  receipt?: any;
}

export type ApiErrorCode =
  | 'AUTHENTICATION_REQUIRED'
  | 'FORBIDDEN'
  | 'BOOKING_NOT_FOUND'
  | 'ROOM_LINE_NOT_FOUND'
  | 'INVALID_LINE_ID'
  | 'CANCELLATION_DEADLINE_PASSED'
  | 'LINE_ALREADY_CANCELLED'
  | 'NOT_ALL_LINES_ELIGIBLE'
  | 'INVALID_LINE_STATUS'
  | 'LINE_BOOKING_MISMATCH'
  | 'UNKNOWN_ERROR';

export function describeCancellationError(code: string, message: string): string {
  const MESSAGES: Partial<Record<ApiErrorCode, string>> = {
    AUTHENTICATION_REQUIRED: 'Authentication required. Please log in.',
    FORBIDDEN: 'Access denied. Only authorized staff may process cancellations.',
    BOOKING_NOT_FOUND: 'Booking not found.',
    ROOM_LINE_NOT_FOUND: 'Room line not found.',
    INVALID_LINE_ID: 'Invalid room line ID.',
    CANCELLATION_DEADLINE_PASSED: 'Cancellation denied: the no-show cutoff deadline has passed.',
    LINE_ALREADY_CANCELLED: 'This room is already cancelled.',
    NOT_ALL_LINES_ELIGIBLE: 'Whole-booking cancellation denied: not all lines are eligible (e.g. some are already checked in or cancelled).',
    INVALID_LINE_STATUS: 'Room line must be BOOKED to be cancelled.',
    LINE_BOOKING_MISMATCH: 'Room line does not belong to this booking.',
  };
  return MESSAGES[code as ApiErrorCode] ?? message ?? 'An unexpected error occurred during cancellation.';
}

export interface FetchOptions {
  apiBase: string;
  headers?: Record<string, string>;
}

export type QuoteResponse =
  | { ok: true; data: RawCancellationQuote }
  | { ok: false; status: number; code: string; message: string };

export async function fetchLineCancellationQuote(
  bookingId: string,
  lineId: string,
  opts: FetchOptions,
): Promise<QuoteResponse> {
  const url = `${opts.apiBase}/bookings/${encodeURIComponent(bookingId)}/lines/${encodeURIComponent(lineId)}/cancellation-quote`;
  try {
    const res = await fetch(url, {
      headers: { ...(opts.headers ?? {}) },
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        code: payload?.error?.code ?? 'UNKNOWN_ERROR',
        message: payload?.error?.message ?? 'Failed to get quote.',
      };
    }
    if (typeof payload?.quote?.is_eligible !== 'boolean' ||
        !Number.isFinite(payload?.quote?.cancellation_fee)) {
      return { ok: false, status: res.status, code: 'INVALID_RESPONSE', message: 'Invalid cancellation quote response. Reload and try again.' };
    }
    return { ok: true, data: payload.quote as RawCancellationQuote };
  } catch {
    return { ok: false, status: 0, code: 'NETWORK_ERROR', message: 'Unable to reach the service.' };
  }
}

export async function fetchWholeBookingCancellationQuote(
  bookingId: string,
  opts: FetchOptions,
): Promise<QuoteResponse> {
  const url = `${opts.apiBase}/bookings/${encodeURIComponent(bookingId)}/cancellation-quote`;
  try {
    const res = await fetch(url, {
      headers: { ...(opts.headers ?? {}) },
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        code: payload?.error?.code ?? 'UNKNOWN_ERROR',
        message: payload?.error?.message ?? 'Failed to get quote.',
      };
    }
    if (typeof payload?.quote?.is_eligible !== 'boolean' ||
        !Number.isFinite(payload?.quote?.cancellation_fee)) {
      return { ok: false, status: res.status, code: 'INVALID_RESPONSE', message: 'Invalid cancellation quote response. Reload and try again.' };
    }
    return { ok: true, data: payload.quote as RawCancellationQuote };
  } catch {
    return { ok: false, status: 0, code: 'NETWORK_ERROR', message: 'Unable to reach the service.' };
  }
}

export type CancelLineResponse =
  | { ok: true; data: RawCancelLineResult }
  | { ok: false; status: number; code: string; message: string };

export async function postCancelLine(
  bookingId: string,
  lineId: string,
  reason: string,
  opts: FetchOptions,
): Promise<CancelLineResponse> {
  const url = `${opts.apiBase}/bookings/${encodeURIComponent(bookingId)}/lines/${encodeURIComponent(lineId)}/cancel`;
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
        message: payload?.error?.message ?? 'Cancellation failed.',
      };
    }
    if (payload?.cancellation?.status !== 'CANCELLED' ||
        !Number.isFinite(payload?.cancellation?.cancellation_fee)) {
      return { ok: false, status: res.status, code: 'INVALID_RESPONSE', message: 'Cancellation response could not be read. Reload booking data before retrying.' };
    }
    return { ok: true, data: payload.cancellation as RawCancelLineResult };
  } catch {
    return { ok: false, status: 0, code: 'NETWORK_ERROR', message: 'Unable to reach the service.' };
  }
}

export type CancelWholeBookingResponse =
  | { ok: true; data: RawCancelWholeBookingResult }
  | { ok: false; status: number; code: string; message: string };

export async function postCancelWholeBooking(
  bookingId: string,
  reason: string,
  opts: FetchOptions,
): Promise<CancelWholeBookingResponse> {
  const url = `${opts.apiBase}/bookings/${encodeURIComponent(bookingId)}/cancel-all`;
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
        message: payload?.error?.message ?? 'Cancellation failed.',
      };
    }
    if (!Number.isInteger(payload?.cancellation?.cancelled_lines_count) ||
        !Number.isFinite(payload?.cancellation?.total_cancellation_fees)) {
      return { ok: false, status: res.status, code: 'INVALID_RESPONSE', message: 'Cancellation response could not be read. Reload booking data before retrying.' };
    }
    return { ok: true, data: payload.cancellation as RawCancelWholeBookingResult };
  } catch {
    return { ok: false, status: 0, code: 'NETWORK_ERROR', message: 'Unable to reach the service.' };
  }
}
