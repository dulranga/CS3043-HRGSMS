// M1-S18 guest account summary clients. Bookings come from Member 2's M2-S14
// read API (GET /api/guest/bookings) and invoices/payments from Member 4's read
// API (GET /api/bookings/:bookingId/invoice|payments). The server derives the
// guest from the session, so this client never sends a guest id; booking ids
// only ever come from the guest's own booking list.

export type BookingChannel = "DIRECT_ONLINE" | "FRONT_DESK" | "PHONE" | "EMAIL";
export type BookingLineStatus =
  | "BOOKED"
  | "CHECKED_IN"
  | "CHECKED_OUT"
  | "CANCELLED"
  | "NO_SHOW";
export type RoomCondition = "READY" | "CLEANING" | "OUT_OF_SERVICE";
export type PaymentKind = "PAYMENT" | "REFUND";
export type PaymentStatus = "SUCCESSFUL" | "FAILED" | "REVERSED";
export type PaymentMethod = "CASH" | "BANK_TRANSFER";

export interface RoomLineSummary {
  total: number;
  booked: number;
  checkedIn: number;
  checkedOut: number;
  cancelled: number;
  noShow: number;
  firstStayDate: string;
  lastStayDate: string;
}

export interface GuestBookingSummary {
  bookingId: string;
  bookingRef: string;
  bookingChannel: BookingChannel;
  createdAt: string;
  updatedAt: string;
  lineSummary: RoomLineSummary;
}

export interface GuestBookingAssignment {
  assignmentId: string;
  roomId: string;
  roomNumber: string;
  branchId: string;
  operationalStatus: RoomCondition;
  roomType: { roomTypeId: string; name: string; capacity: number };
  assignedAt: string;
  unassignedAt: string | null;
  occupiedFrom: string | null;
  occupiedTo: string | null;
  current: boolean;
}

export interface GuestBookingLine {
  lineId: string;
  checkIn: string;
  checkOut: string;
  guestCount: number;
  rateSnapshot: string;
  status: BookingLineStatus;
  createdAt: string;
  updatedAt: string;
  assignments: GuestBookingAssignment[];
}

export interface GuestBookingDetail {
  bookingId: string;
  bookingRef: string;
  bookingChannel: BookingChannel;
  createdAt: string;
  updatedAt: string;
  lines: GuestBookingLine[];
}

// Numeric columns are serialized as strings by node-postgres.
export type Numeric = number | string;

export interface InvoiceLine {
  invoice_line_id: string;
  invoice_id: string;
  line_type: string;
  booking_room_line_id: string | null;
  description: string;
  amount: Numeric;
}

export interface InvoiceSummary {
  total_amount: Numeric;
  successful_payments: Numeric;
  successful_refunds: Numeric;
  net_payments: Numeric;
  outstanding_balance: Numeric;
  credit_amount: Numeric;
  is_credit: boolean;
  is_settled: boolean;
  is_provisional: boolean;
}

export interface BookingInvoice {
  invoice_id: string;
  booking_id: string;
  billing_policy_id: string;
  invoice_number: string | null;
  status: "DRAFT" | "FINAL";
  is_provisional: boolean;
  issued_at: string | null;
  created_at: string;
  lines: InvoiceLine[];
  summary: InvoiceSummary;
}

export interface Payment {
  payment_id: string;
  booking_id: string;
  recorded_by: string;
  kind: PaymentKind;
  amount: Numeric;
  method: PaymentMethod;
  status: PaymentStatus;
  reference: string;
  paid_at: string;
  recorded_at: string;
}

export interface PaymentSummary {
  successful_payments_total: Numeric;
  successful_refunds_total: Numeric;
  net_payments: Numeric;
  invoice_total: Numeric;
  outstanding_balance: Numeric;
  credit_amount: Numeric;
  is_credit: boolean;
  is_settled: boolean;
}

export interface BookingPayments {
  booking_id: string;
  payments: Payment[];
  summary: PaymentSummary;
}

export type GuestBookingErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "FORBIDDEN"
  | "BOOKING_NOT_FOUND"
  | "INVOICE_NOT_FOUND"
  | "VALIDATION_ERROR"
  | "NETWORK_ERROR"
  | "INTERNAL_SERVER_ERROR";

export class GuestBookingError extends Error {
  constructor(
    public readonly code: GuestBookingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GuestBookingError";
  }
}

async function parseError(response: Response): Promise<GuestBookingError> {
  let code: GuestBookingErrorCode = "INTERNAL_SERVER_ERROR";
  let message = "Something went wrong. Please try again.";
  try {
    const body = (await response.json()) as { error?: { code?: GuestBookingErrorCode; message?: string } };
    if (body?.error?.code) code = body.error.code;
    if (body?.error?.message) message = body.error.message;
  } catch {
    // Non-JSON bodies keep the generic message.
  }
  return new GuestBookingError(code, message);
}

async function request<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin" });
  } catch {
    throw new GuestBookingError(
      "NETWORK_ERROR",
      "The server could not be reached. Check your connection and try again.",
    );
  }
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as T;
}

export async function listOwnBookings(limit = 20, offset = 0): Promise<GuestBookingSummary[]> {
  const payload = await request<{ data: { items: GuestBookingSummary[] } }>(
    `/api/guest/bookings?limit=${limit}&offset=${offset}`,
  );
  return payload.data.items;
}

export async function getOwnBookingDetail(bookingId: string): Promise<GuestBookingDetail> {
  const payload = await request<{ data: GuestBookingDetail }>(`/api/guest/bookings/${bookingId}`);
  return payload.data;
}

export async function getOwnInvoice(bookingId: string): Promise<BookingInvoice> {
  return request<BookingInvoice>(`/api/bookings/${bookingId}/invoice`);
}

export async function getOwnPayments(bookingId: string): Promise<BookingPayments> {
  return request<BookingPayments>(`/api/bookings/${bookingId}/payments`);
}
