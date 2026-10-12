import type { StaffRole } from './roomAdministration';
import { ROLE_GRANTS } from './rolePermissions.generated';

/**
 * Shared booking finder data source for the billing, check-in, active-stay and
 * service-usage screens. Staff should never have to copy a raw booking UUID:
 * they either pick a branch booking from a searchable list or type the
 * human-readable booking reference (FR-029), which the backend resolves.
 *
 * Only FRONT_DESK holds `booking.manage`, so only it may call the branch list
 * `GET /api/bookings`. Every other role still gets the reference field, whose
 * value the resource endpoint resolves server-side.
 */
export function canSearchBookings(role: StaffRole | null | undefined): boolean {
  return !!role && ROLE_GRANTS[role]?.['booking.manage'] !== undefined;
}

export interface BookingOption {
  bookingId: string;
  bookingRef: string;
  guestName: string;
  firstStayDate: string;
  lastStayDate: string;
  statusLabel: string;
}

export type BookingOptionsResult =
  | { ok: true; items: BookingOption[] }
  | { ok: false; status: number; message: string };

const LINE_STATUS_LABEL: Record<string, string> = {
  booked: 'BOOKED',
  checkedIn: 'CHECKED_IN',
  checkedOut: 'CHECKED_OUT',
  cancelled: 'CANCELLED',
  noShow: 'NO_SHOW',
};

function optionFrom(value: unknown): BookingOption | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, any>;
  const guest = row.guest && typeof row.guest === 'object' ? row.guest : {};
  const summary = row.lineSummary && typeof row.lineSummary === 'object' ? row.lineSummary : {};
  if (typeof row.bookingId !== 'string' || typeof row.bookingRef !== 'string') return null;

  const parts: string[] = [];
  for (const [key, label] of Object.entries(LINE_STATUS_LABEL)) {
    if (Number(summary[key]) > 0) parts.push(`${Number(summary[key])} ${label}`);
  }

  return {
    bookingId: row.bookingId,
    bookingRef: row.bookingRef,
    guestName: typeof guest.fullName === 'string' ? guest.fullName : 'Guest',
    firstStayDate: typeof summary.firstStayDate === 'string' ? summary.firstStayDate : '',
    lastStayDate: typeof summary.lastStayDate === 'string' ? summary.lastStayDate : '',
    statusLabel: parts.join(' · '),
  };
}

/** Parses the `GET /api/bookings` list envelope into picker options. */
export function parseBookingOptions(payload: unknown): BookingOption[] {
  const data = (payload as { data?: { items?: unknown[] } } | null)?.data;
  if (!data || !Array.isArray(data.items)) return [];
  return data.items.map(optionFrom).filter((item): item is BookingOption => item !== null);
}

/** Case-insensitive match on booking reference or guest name. */
export function filterBookingOptions(options: BookingOption[], query: string): BookingOption[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return options;
  return options.filter(
    (option) =>
      option.bookingRef.toLowerCase().includes(needle) ||
      option.guestName.toLowerCase().includes(needle),
  );
}

export function bookingOptionLabel(option: BookingOption): string {
  return `${option.bookingRef} · ${option.guestName}`;
}

export type BookingOptionsFetcher = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Loads the current branch's bookings for the picker. The backend applies the
 * officer's branch scope, so no branch filter is sent from the client.
 */
export async function fetchBookingOptions(
  fetcher: BookingOptionsFetcher = fetch,
  limit = 100,
): Promise<BookingOptionsResult> {
  const query = new URLSearchParams({ limit: String(limit), offset: '0' });
  try {
    const response = await fetcher(`/api/bookings?${query.toString()}`, {
      method: 'GET',
      credentials: 'same-origin',
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        (payload as { error?: { message?: string } } | null)?.error?.message ??
        'Booking records could not be loaded.';
      return { ok: false, status: response.status, message };
    }
    return { ok: true, items: parseBookingOptions(payload) };
  } catch {
    return { ok: false, status: 0, message: 'Booking records could not be reached.' };
  }
}
