/**
 * No-Show view model for M4-S17.
 *
 * Wraps the API responses for the no-show endpoints:
 *   GET  /api/bookings/:bookingId/lines/:lineId/no-show-quote
 *   GET  /api/bookings/:bookingId/no-show-quote
 *   POST /api/bookings/:bookingId/lines/:lineId/no-show
 *   POST /api/bookings/:bookingId/no-show
 */

export interface RawNoShowQuote {
  booking_id: string;
  line_id?: string;
  is_eligible: boolean;
  stay_start_date?: string;
  cutoff_deadline?: string;
  no_show_grace_days?: number;
  no_show_fee: number;
  rejection_reason?: string;
}

export interface RawNoShowLineResult {
  success?: boolean;
  booking_id: string;
  line_id: string;
  status: 'NO_SHOW';
  no_show_at: string;
  marked_by: string;
  no_show_fee: number;
  remaining_active_lines: number;
  new_outstanding_balance?: number;
  outstanding_balance?: number;
  is_credit: boolean;
  credit_amount: number;
  receipt?: any;
}

export interface RawNoShowBookingResult {
  success?: boolean;
  booking_id: string;
  no_show_lines_count: number;
  no_show_line_ids: string[];
  no_show_at: string;
  marked_by: string;
  total_no_show_fees: number;
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
  | 'EARLY_NO_SHOW_NOT_ALLOWED'
  | 'LINE_ALREADY_NO_SHOW'
  | 'NOT_ALL_LINES_ELIGIBLE'
  | 'INVALID_LINE_STATUS'
  | 'LINE_BOOKING_MISMATCH'
  | 'UNKNOWN_ERROR';

export function describeNoShowError(code: string, message: string): string {
  const MESSAGES: Partial<Record<ApiErrorCode, string>> = {
    AUTHENTICATION_REQUIRED: 'Authentication required. Please log in.',
    FORBIDDEN: 'Access denied. Only authorized staff may mark no-shows.',
    BOOKING_NOT_FOUND: 'Booking not found.',
    ROOM_LINE_NOT_FOUND: 'Room line not found.',
    INVALID_LINE_ID: 'Invalid room line ID.',
    EARLY_NO_SHOW_NOT_ALLOWED: 'No-show denied: the cutoff deadline has not yet passed.',
    LINE_ALREADY_NO_SHOW: 'This room is already marked as no-show.',
    NOT_ALL_LINES_ELIGIBLE: 'Whole-booking no-show denied: not all lines are eligible (e.g. some are checked in or cancelled).',
    INVALID_LINE_STATUS: 'Room line must be BOOKED to be marked as no-show.',
    LINE_BOOKING_MISMATCH: 'Room line does not belong to this booking.',
  };
  return MESSAGES[code as ApiErrorCode] ?? message ?? 'An unexpected error occurred during no-show marking.';
}

export interface FetchOptions {
  apiBase: string;
  headers?: Record<string, string>;
}

export type NoShowQuoteResponse =
  | { ok: true; data: RawNoShowQuote }
  | { ok: false; status: number; code: string; message: string };

export async function fetchLineNoShowQuote(
  bookingId: string,
  lineId: string,
  opts: FetchOptions,
): Promise<NoShowQuoteResponse> {
  const url = `${opts.apiBase}/bookings/${encodeURIComponent(bookingId)}/lines/${encodeURIComponent(lineId)}/no-show-quote`;
  try {
    const res = await fetch(url, { headers: { ...(opts.headers ?? {}) } });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        code: payload?.error?.code ?? 'UNKNOWN_ERROR',
        message: payload?.error?.message ?? 'Failed to get quote.',
      };
    }
    return { ok: true, data: payload as RawNoShowQuote };
  } catch {
    return { ok: false, status: 0, code: 'NETWORK_ERROR', message: 'Unable to reach the service.' };
  }
}

export async function fetchWholeBookingNoShowQuote(
  bookingId: string,
  opts: FetchOptions,
): Promise<NoShowQuoteResponse> {
  const url = `${opts.apiBase}/bookings/${encodeURIComponent(bookingId)}/no-show-quote`;
  try {
    const res = await fetch(url, { headers: { ...(opts.headers ?? {}) } });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        code: payload?.error?.code ?? 'UNKNOWN_ERROR',
        message: payload?.error?.message ?? 'Failed to get quote.',
      };
    }
    return { ok: true, data: payload as RawNoShowQuote };
  } catch {
    return { ok: false, status: 0, code: 'NETWORK_ERROR', message: 'Unable to reach the service.' };
  }
}

export type MarkNoShowResponse =
  | { ok: true; data: RawNoShowLineResult }
  | { ok: false; status: number; code: string; message: string };

export async function postMarkLineNoShow(
  bookingId: string,
  lineId: string,
  reason: string,
  opts: FetchOptions,
): Promise<MarkNoShowResponse> {
  const url = `${opts.apiBase}/bookings/${encodeURIComponent(bookingId)}/lines/${encodeURIComponent(lineId)}/no-show`;
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
        message: payload?.error?.message ?? 'Failed to mark no-show.',
      };
    }
    return { ok: true, data: payload as RawNoShowLineResult };
  } catch {
    return { ok: false, status: 0, code: 'NETWORK_ERROR', message: 'Unable to reach the service.' };
  }
}

export type MarkBookingNoShowResponse =
  | { ok: true; data: RawNoShowBookingResult }
  | { ok: false; status: number; code: string; message: string };

export async function postMarkBookingNoShow(
  bookingId: string,
  reason: string,
  opts: FetchOptions,
): Promise<MarkBookingNoShowResponse> {
  const url = `${opts.apiBase}/bookings/${encodeURIComponent(bookingId)}/no-show`;
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
        message: payload?.error?.message ?? 'Failed to mark whole booking as no-show.',
      };
    }
    return { ok: true, data: payload as RawNoShowBookingResult };
  } catch {
    return { ok: false, status: 0, code: 'NETWORK_ERROR', message: 'Unable to reach the service.' };
  }
}
