import {
  BookingBalance,
  Invoice,
  InvoiceDetailResponse,
  InvoiceLine,
  InvoiceStatus,
  PaymentHistoryResponse,
} from '../models/invoice';
import { Payment } from '../models/payment';

export interface DbClient {
  query<T = any>(sql: string, values?: any[]): Promise<{ rows: T[] }>;
}

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

export interface ActorContext {
  userId: string;
  role?: string;
  branchId?: string;
}

export interface AccessVerificationResult {
  allowed: boolean;
  statusCode: number; // 200, 401, 403, 404
  reason?: string;
  actorType?: 'ONLINE_GUEST' | 'STAFF' | 'UNKNOWN';
  roleName?: string;
  branchId?: string;
}

/**
 * Booking-confirmation hook for Member 2 to create the DRAFT invoice row
 * with the effective policy in the same transaction.
 * Idempotent / retry safe: returns existing invoice ID if already created in DRAFT.
 * Fails with an error (triggering transaction rollback) if no policy is applicable.
 */
export async function createBookingDraftInvoice(
  client: DbClient,
  bookingId: string,
  userId?: string,
): Promise<{ invoiceId: string }> {
  const res = await client.query<{ invoice_id: string }>(
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
  client: DbClient,
  bookingId: string,
  userId?: string,
  approvedDiscount: number = 0.0,
): Promise<{ invoiceId: string }> {
  const res = await client.query<{ invoice_id: string }>(
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
  client: DbClient,
  bookingId: string,
): Promise<BookingBalance> {
  const res = await client.query<any>(
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
  client: DbClient,
  bookingId: string,
  userId?: string,
): Promise<FinalInvoiceResult> {
  const res = await client.query<any>(
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
  client: DbClient,
  bookingId: string,
): Promise<InvoiceWithLines | null> {
  const invRes = await client.query<any>(
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

  const linesRes = await client.query<any>(
    'SELECT * FROM invoice_line WHERE invoice_id = $1 ORDER BY invoice_line_id',
    [invoice.invoice_id],
  );

  const lines: InvoiceLine[] = linesRes.rows.map((r: any) => ({
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

/**
 * Authorizes access to a booking by verifying either:
 * 1. Online guest ownership: User owns the linked guest_account matching booking.guest_id.
 * 2. Staff branch scope: User is an officer whose branch matches the booking branch,
 *    or user has a chain-wide role (CHAIN_MANAGER, SYSTEM_ADMINISTRATOR, AUDITOR).
 */
export async function verifyBookingAccess(
  db: DbClient,
  bookingId: string,
  actor: ActorContext,
): Promise<AccessVerificationResult> {
  if (!actor || !actor.userId) {
    return { allowed: false, statusCode: 401, reason: 'Authentication required' };
  }

  // 1. Fetch booking, guest_id, and resolved branch_id
  const bookingRes = await db.query<{
    booking_id: string;
    guest_id: string;
    created_by: string;
    branch_id: string | null;
  }>(
    `SELECT
        b.booking_id,
        b.guest_id,
        b.created_by,
        COALESCE(
            (SELECT r.branch_id
               FROM booking_room_line bl
               JOIN booking_room_assignment bra ON bra.line_id = bl.line_id
               JOIN room r ON r.room_id = bra.room_id
              WHERE bl.booking_id = b.booking_id
              LIMIT 1),
            (SELECT o.branch_id
               FROM officer o
              WHERE o.officer_id = b.created_by)
        ) AS branch_id
      FROM booking b
     WHERE b.booking_id = $1`,
    [bookingId],
  );

  if (bookingRes.rows.length === 0) {
    return { allowed: false, statusCode: 404, reason: 'Booking not found' };
  }
  const booking = bookingRes.rows[0];

  // 2. Check if actor is an online guest (guest_account)
  const gaRes = await db.query<{ guest_id: string }>(
    `SELECT guest_id FROM guest_account WHERE user_id = $1`,
    [actor.userId],
  );

  if (gaRes.rows.length > 0) {
    const guestAccount = gaRes.rows[0];
    if (guestAccount.guest_id === booking.guest_id) {
      return { allowed: true, statusCode: 200, actorType: 'ONLINE_GUEST' };
    }
    return {
      allowed: false,
      statusCode: 403,
      reason: 'Access denied: online guests can only access their own bookings',
    };
  }

  // 3. Check if actor is staff (officer + role)
  const offRes = await db.query<{ branch_id: string; role_name: string }>(
    `SELECT o.branch_id, r.role_name
       FROM officer o
       JOIN role r ON r.role_id = o.role_id
      WHERE o.officer_id = $1`,
    [actor.userId],
  );

  if (offRes.rows.length > 0) {
    const officer = offRes.rows[0];
    // Chain-wide roles have universal access
    if (['CHAIN_MANAGER', 'SYSTEM_ADMINISTRATOR', 'AUDITOR'].includes(officer.role_name)) {
      return {
        allowed: true,
        statusCode: 200,
        actorType: 'STAFF',
        roleName: officer.role_name,
        branchId: officer.branch_id,
      };
    }

    // Branch-scoped roles (FRONT_DESK, BRANCH_MANAGER, SERVICE_STAFF)
    if (booking.branch_id && booking.branch_id === officer.branch_id) {
      return {
        allowed: true,
        statusCode: 200,
        actorType: 'STAFF',
        roleName: officer.role_name,
        branchId: officer.branch_id,
      };
    }

    return {
      allowed: false,
      statusCode: 403,
      reason: 'Access denied: staff access is restricted to own branch',
    };
  }

  return {
    allowed: false,
    statusCode: 403,
    reason: 'Access denied: user account has no associated guest or staff profile',
  };
}

/**
 * Returns full invoice detail with signed lines, provisional DRAFT labeling,
 * and distinct credit calculation.
 */
export async function getBookingInvoiceDetail(
  db: DbClient,
  bookingId: string,
): Promise<InvoiceDetailResponse | null> {
  const invRes = await db.query<any>(
    'SELECT * FROM invoice WHERE booking_id = $1',
    [bookingId],
  );

  if (invRes.rows.length === 0) {
    return null;
  }

  const invRow = invRes.rows[0];
  const linesRes = await db.query<any>(
    'SELECT * FROM invoice_line WHERE invoice_id = $1 ORDER BY amount DESC, invoice_line_id ASC',
    [invRow.invoice_id],
  );

  const lines: InvoiceLine[] = linesRes.rows.map((r: any) => ({
    invoice_line_id: r.invoice_line_id,
    invoice_id: r.invoice_id,
    line_type: r.line_type,
    booking_room_line_id: r.booking_room_line_id,
    description: r.description,
    amount: r.amount,
  }));

  const balRes = await db.query<any>(
    'SELECT * FROM fn_booking_balance($1)',
    [bookingId],
  );

  const bal = balRes.rows[0] || {
    total_amount: 0,
    successful_payments: 0,
    successful_refunds: 0,
    net_paid: 0,
    balance: 0,
    is_settled: true,
  };

  const totalAmount = Number(bal.total_amount);
  const netPayments = Number(bal.net_paid);
  const outstandingBalance = Number(bal.balance);
  const isCredit = outstandingBalance < 0;
  const creditAmount = isCredit ? Math.abs(outstandingBalance) : 0;
  const isProvisional = invRow.status === 'DRAFT';

  return {
    invoice_id: invRow.invoice_id,
    booking_id: invRow.booking_id,
    billing_policy_id: invRow.billing_policy_id,
    invoice_number: invRow.invoice_number,
    status: invRow.status,
    is_provisional: isProvisional,
    issued_at: invRow.issued_at ? new Date(invRow.issued_at) : null,
    created_at: new Date(invRow.created_at),
    lines,
    summary: {
      total_amount: totalAmount,
      successful_payments: Number(bal.successful_payments),
      successful_refunds: Number(bal.successful_refunds),
      net_payments: netPayments,
      outstanding_balance: outstandingBalance,
      credit_amount: creditAmount,
      is_credit: isCredit,
      is_settled: Boolean(bal.is_settled),
      is_provisional: isProvisional,
    },
  };
}

/**
 * Returns full payment and refund history for a booking with totals matching
 * net payments and signed invoice lines.
 */
export async function getBookingPaymentHistory(
  db: DbClient,
  bookingId: string,
): Promise<PaymentHistoryResponse> {
  const paymentsRes = await db.query<any>(
    `SELECT payment_id, booking_id, recorded_by, kind, amount, method, status, reference, paid_at, recorded_at
       FROM payment
      WHERE booking_id = $1
      ORDER BY paid_at ASC, payment_id ASC`,
    [bookingId],
  );

  const payments: Payment[] = paymentsRes.rows.map((r: any) => ({
    payment_id: r.payment_id,
    booking_id: r.booking_id,
    recorded_by: r.recorded_by,
    kind: r.kind,
    amount: r.amount,
    method: r.method,
    status: r.status,
    reference: r.reference,
    paid_at: new Date(r.paid_at),
    recorded_at: new Date(r.recorded_at),
  }));

  const balRes = await db.query<any>(
    'SELECT * FROM fn_booking_balance($1)',
    [bookingId],
  );

  const bal = balRes.rows[0] || {
    total_amount: 0,
    successful_payments: 0,
    successful_refunds: 0,
    net_paid: 0,
    balance: 0,
    is_settled: true,
  };

  const outstandingBalance = Number(bal.balance);
  const isCredit = outstandingBalance < 0;
  const creditAmount = isCredit ? Math.abs(outstandingBalance) : 0;

  return {
    booking_id: bookingId,
    payments,
    summary: {
      successful_payments_total: Number(bal.successful_payments),
      successful_refunds_total: Number(bal.successful_refunds),
      net_payments: Number(bal.net_paid),
      invoice_total: Number(bal.total_amount),
      outstanding_balance: outstandingBalance,
      credit_amount: creditAmount,
      is_credit: isCredit,
      is_settled: Boolean(bal.is_settled),
    },
  };
}
