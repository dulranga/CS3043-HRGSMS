import { Client } from 'pg';
import { BookingBalance, Invoice, InvoiceLine, InvoiceStatus } from '../models/invoice';

export interface FinalInvoiceResult {
  invoiceId: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  issuedAt: Date;
  totalAmount: number;
}

export interface InvoiceWithLines {
  invoice: Invoice;
  lines: InvoiceLine[];
  balance: BookingBalance;
}

/**
 * Booking-confirmation hook for Member 2 to create the DRAFT invoice row
 * with the effective policy in the same transaction.
 * Idempotent / retry safe: returns existing invoice ID if already created in DRAFT.
 * Fails with an error (triggering transaction rollback) if no policy is applicable.
 */
export async function createBookingDraftInvoice(
  client: Client,
  bookingId: string,
  userId?: string,
): Promise<{ invoiceId: string }> {
  const res = await client.query(
    'SELECT fn_create_booking_draft_invoice($1, $2) AS invoice_id',
    [bookingId, userId || null],
  );
  return { invoiceId: res.rows[0].invoice_id };
}

/**
 * Refreshes draft invoice lines for a booking based on current room lines and services.
 * Preserves explicit manual price adjustments.
 */
export async function refreshDraftInvoice(
  client: Client,
  bookingId: string,
  userId?: string,
  approvedDiscount: number = 0.0,
): Promise<{ invoiceId: string }> {
  const res = await client.query(
    'SELECT fn_refresh_draft_invoice($1, $2, $3) AS invoice_id',
    [bookingId, userId || null, approvedDiscount],
  );
  return { invoiceId: res.rows[0].invoice_id };
}

/**
 * Calculates the shared booking balance:
 * invoice total amount - successful payments + successful refunds (failed/reversed excluded).
 */
export async function getBookingBalance(
  client: Client,
  bookingId: string,
): Promise<BookingBalance> {
  const res = await client.query(
    'SELECT * FROM fn_booking_balance($1)',
    [bookingId],
  );

  if (res.rows.length === 0) {
    return {
      invoice_id: null,
      status: null,
      total_amount: 0,
      successful_payments: 0,
      successful_refunds: 0,
      net_paid: 0,
      balance: 0,
      is_settled: true,
    };
  }

  const row = res.rows[0];
  return {
    invoice_id: row.invoice_id,
    status: row.status,
    total_amount: Number(row.total_amount),
    successful_payments: Number(row.successful_payments),
    successful_refunds: Number(row.successful_refunds),
    net_paid: Number(row.net_paid),
    balance: Number(row.balance),
    is_settled: Boolean(row.is_settled),
  };
}

/**
 * Issues the single FINAL invoice for a booking.
 * Preconditions:
 * 1. Invoice is in DRAFT.
 * 2. Every room line is terminal (CHECKED_OUT, CANCELLED, NO_SHOW).
 *    Partial checkout keeps the invoice in DRAFT.
 * 3. All charges are recorded and refreshed.
 * 4. Consolidated balance is exactly zero (0.00). Unsettled debt or credit blocks finalization.
 */
export async function issueFinalInvoice(
  client: Client,
  bookingId: string,
  userId?: string,
): Promise<FinalInvoiceResult> {
  const res = await client.query(
    'SELECT * FROM fn_issue_final_invoice($1, $2)',
    [bookingId, userId || null],
  );

  const row = res.rows[0];
  return {
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number,
    status: row.status,
    issuedAt: new Date(row.issued_at),
    totalAmount: Number(row.total_amount),
  };
}

/**
 * Fetches full invoice details including lines and balance summary.
 */
export async function getBookingInvoiceDetails(
  client: Client,
  bookingId: string,
): Promise<InvoiceWithLines | null> {
  const invRes = await client.query(
    'SELECT * FROM invoice WHERE booking_id = $1',
    [bookingId],
  );

  if (invRes.rows.length === 0) {
    return null;
  }

  const invoice: Invoice = {
    invoice_id: invRes.rows[0].invoice_id,
    booking_id: invRes.rows[0].booking_id,
    billing_policy_id: invRes.rows[0].billing_policy_id,
    invoice_number: invRes.rows[0].invoice_number,
    status: invRes.rows[0].status,
    issued_at: invRes.rows[0].issued_at ? new Date(invRes.rows[0].issued_at) : null,
    created_at: new Date(invRes.rows[0].created_at),
  };

  const linesRes = await client.query(
    'SELECT * FROM invoice_line WHERE invoice_id = $1 ORDER BY invoice_line_id',
    [invoice.invoice_id],
  );

  const lines: InvoiceLine[] = linesRes.rows.map((r) => ({
    invoice_line_id: r.invoice_line_id,
    invoice_id: r.invoice_id,
    line_type: r.line_type,
    booking_room_line_id: r.booking_room_line_id,
    description: r.description,
    amount: r.amount,
  }));

  const balance = await getBookingBalance(client, bookingId);

  return {
    invoice,
    lines,
    balance,
  };
}
