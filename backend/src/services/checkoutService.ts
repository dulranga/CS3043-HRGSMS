import { ActorContext, DbClient } from './invoiceService.js';
import { authorizeStaff, staffPrincipal } from '../authorization';
import { CheckoutLineParams, CheckoutResult, CheckoutReceipt } from '../models/checkout.js';

export interface CheckoutAccessResult {
  allowed: boolean;
  statusCode: number;
  reason?: string;
  roleName?: string;
  branchId?: string | null;
  resolvedBookingId?: string;
  guestId?: string;
}

/**
 * Verifies that the actor has staff authorization to perform checkout.
 * Rules:
 * 1. Actor must be authenticated (actor.userId present).
 * 2. Booking must exist (resolves booking_id from UUID or booking_ref).
 * 3. Online guests (guest_account) are strictly rejected with 403 Forbidden.
 * 4. Staff profile (officer) must exist.
 * 5. Role restrictions:
 *    - SERVICE_STAFF is rejected with 403 Forbidden (service staff record service usage, not checkout).
 *    - AUDITOR is rejected with 403 Forbidden (auditor has read-only access).
 *    - FRONT_DESK and BRANCH_MANAGER are allowed for their OWN branch bookings; cross-branch rejected with 403 Forbidden.
 *    - CHAIN_MANAGER and SYSTEM_ADMINISTRATOR have chain-wide access and are allowed across all branches.
 */
export async function verifyStaffCheckoutAccess(
  db: DbClient,
  bookingIdOrRef: string,
  actor: ActorContext,
): Promise<CheckoutAccessResult> {
  if (!actor || !actor.userId) {
    return {
      allowed: false,
      statusCode: 401,
      reason: 'Authentication required',
    };
  }

  // 1. Resolve booking and its branch
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bookingIdOrRef);
  const sql = isUuid
    ? `SELECT b.booking_id, b.booking_ref, b.guest_id, b.created_by,
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
        WHERE b.booking_id = $1`
    : `SELECT b.booking_id, b.booking_ref, b.guest_id, b.created_by,
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
        WHERE b.booking_ref = $1`;

  const bookingRes = await db.query<{
    booking_id: string;
    booking_ref: string;
    guest_id: string;
    created_by: string;
    branch_id: string | null;
  }>(sql, [bookingIdOrRef]);

  if (bookingRes.rows.length === 0) {
    return {
      allowed: false,
      statusCode: 404,
      reason: 'Booking not found',
    };
  }
  const booking = bookingRes.rows[0];

  // 2. Reject online guests
  const gaRes = await db.query<{ guest_id: string }>(
    `SELECT guest_id FROM guest_account WHERE user_id = $1`,
    [actor.userId],
  );
  if (gaRes.rows.length > 0) {
    return {
      allowed: false,
      statusCode: 403,
      reason: 'Access denied: online guests are not authorized to perform staff checkout',
    };
  }

  // 3. Look up staff officer profile & role
  const offRes = await db.query<{ branch_id: string; role_name: string }>(
    `SELECT o.branch_id, r.role_name
       FROM officer o
       JOIN role r ON r.role_id = o.role_id
      WHERE o.officer_id = $1`,
    [actor.userId],
  );

  if (offRes.rows.length === 0) {
    return {
      allowed: false,
      statusCode: 403,
      reason: 'Access denied: user account has no associated staff profile',
    };
  }

  const officer = offRes.rows[0];

  // 4. Role/scope decision from the single role-grant matrix (SRS §6.1.4).
  const decision = authorizeStaff(
    staffPrincipal(actor.userId, officer.role_name, officer.branch_id),
    'checkout.perform',
    booking.branch_id ?? undefined,
  );
  if (!decision.allowed) {
    if (decision.code === 'CROSS_BRANCH_FORBIDDEN') {
      return {
        allowed: false,
        statusCode: 403,
        reason: 'Access denied: staff checkout is restricted to own branch',
      };
    }
    if (officer.role_name === 'SERVICE_STAFF') {
      return {
        allowed: false,
        statusCode: 403,
        reason: 'Access denied: SERVICE_STAFF role is not authorized to perform checkout',
      };
    }
    if (officer.role_name === 'AUDITOR') {
      return {
        allowed: false,
        statusCode: 403,
        reason: 'Access denied: AUDITOR role is not authorized to perform checkout',
      };
    }
    return {
      allowed: false,
      statusCode: 403,
      reason: `Access denied: role ${officer.role_name} is not authorized to perform checkout`,
    };
  }

  return {
    allowed: true,
    statusCode: 200,
    roleName: officer.role_name,
    branchId: officer.branch_id,
    resolvedBookingId: booking.booking_id,
    guestId: booking.guest_id,
  };
}

/**
 * Executes a locked, atomic room-line checkout transaction.
 *
 * Invariants enforced by database function fn_checkout_room_line:
 * 1. Pessimistic row locks on booking, invoice, line, assignment, and room.
 * 2. Consolidated balance must be exactly zero (rejects positive unpaid balance or unrefunded credit).
 * 3. The line must be currently CHECKED_IN.
 * 4. The line's open assignment is closed and its occupancy segment completed.
 * 5. The line is set to CHECKED_OUT and line-status history is appended.
 * 6. The room's physical condition is set to CLEANING via Member 3's condition operation and room-status history is appended.
 * 7. If another line remains active, invoice remains DRAFT and provisional statement is returned.
 * 8. If every line is now terminal, the single FINAL invoice is issued and finalized.
 */
export async function checkoutRoomLine(
  db: DbClient,
  params: CheckoutLineParams,
): Promise<CheckoutResult & { receipt: CheckoutReceipt }> {
  const { bookingId, lineId, actorId, reason = 'Guest checkout' } = params;

  const res = await db.query<CheckoutResult>(
    `SELECT
        booking_id,
        line_id,
        room_id,
        room_number,
        room_condition,
        checked_out_at,
        checked_out_by,
        remaining_active_lines,
        is_finalized,
        invoice_id,
        invoice_number,
        issued_at,
        provisional_statement_ref
       FROM fn_checkout_room_line($1, $2, $3, $4)`,
    [bookingId, lineId, actorId, reason],
  );

  if (res.rows.length === 0) {
    throw new Error('Checkout failed: no result returned from database');
  }

  const row = res.rows[0];

  const receipt: CheckoutReceipt = {
    statement_reference: row.provisional_statement_ref,
    booking_id: row.booking_id,
    line_id: row.line_id,
    room_id: row.room_id,
    room_number: row.room_number,
    room_condition: 'CLEANING',
    checked_out_at: row.checked_out_at,
    checked_out_by: row.checked_out_by,
    remaining_active_lines: Number(row.remaining_active_lines),
    is_finalized: row.is_finalized,
    invoice_id: row.invoice_id,
    invoice_number: row.invoice_number,
    issued_at: row.issued_at,
  };

  return {
    ...row,
    remaining_active_lines: Number(row.remaining_active_lines),
    receipt,
  };
}

/**
 * Retrieves the checkout receipt and state for a room line that has already been checked out.
 * Useful for explicit repeated-request inspection.
 */
export async function getCheckedOutLineReceipt(
  db: DbClient,
  lineId: string,
): Promise<CheckoutReceipt | null> {
  const res = await db.query<any>(
    `SELECT
        l.line_id,
        l.booking_id,
        l.status,
        a.room_id,
        r.room_number,
        r.operational_status as room_condition,
        a.occupied_to as checked_out_at,
        h.changed_by as checked_out_by,
        (SELECT count(*)::integer
           FROM booking_room_line bl
          WHERE bl.booking_id = l.booking_id
            AND bl.status IN ('BOOKED', 'CHECKED_IN')) as remaining_active_lines,
        inv.status as invoice_status,
        inv.invoice_id,
        inv.invoice_number,
        inv.issued_at
       FROM booking_room_line l
       JOIN booking_room_assignment a ON a.line_id = l.line_id AND a.unassigned_at IS NOT NULL
       JOIN room r ON r.room_id = a.room_id
       LEFT JOIN invoice inv ON inv.booking_id = l.booking_id
       LEFT JOIN booking_room_line_status_history h ON h.line_id = l.line_id AND h.new_status = 'CHECKED_OUT'
      WHERE l.line_id = $1
      ORDER BY h.changed_at DESC
      LIMIT 1`,
    [lineId],
  );

  if (res.rows.length === 0) {
    return null;
  }

  const row = res.rows[0];
  const isFinalized = row.invoice_status === 'FINAL';
  const stmtRef = isFinalized
    ? row.invoice_number
    : 'PROV-' + new Date(row.checked_out_at).toISOString().slice(0, 10).replace(/-/g, '') + '-' + row.line_id.slice(0, 8);

  return {
    statement_reference: stmtRef,
    booking_id: row.booking_id,
    line_id: row.line_id,
    room_id: row.room_id,
    room_number: row.room_number,
    room_condition: 'CLEANING',
    checked_out_at: row.checked_out_at,
    checked_out_by: row.checked_out_by,
    remaining_active_lines: Number(row.remaining_active_lines || 0),
    is_finalized: isFinalized,
    invoice_id: row.invoice_id,
    invoice_number: row.invoice_number,
    issued_at: row.issued_at,
  };
}
