import {
  CancelLineParams,
  CancelLineReceipt,
  CancelLineResult,
  CancelWholeBookingParams,
  CancelWholeBookingReceipt,
  CancelWholeBookingResult,
  CancellationQuote,
} from '../models/cancellation.js';

export interface DbClient {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[]; rowCount?: number | null }>;
}

export interface ActorContext {
  userId?: string;
  role?: string;
  branchId?: string;
}

export interface CancellationAccessResult {
  allowed: boolean;
  statusCode?: number;
  reason?: string;
  bookingId?: string;
  bookingRef?: string;
  branchId?: string | null;
  actorType?: 'STAFF' | 'GUEST';
  guestId?: string;
  roleName?: string;
}

/**
 * Verifies actor authorization to cancel a booking or room line:
 * 1. Actor must be authenticated (401 Unauthorized if missing).
 * 2. Booking must exist (404 Not Found if missing).
 * 3. If actor is an online guest (guest_account):
 *    - Allowed ONLY for their own booking (guest_account.guest_id === booking.guest_id).
 *    - Cross-guest access is rejected with 403 Forbidden.
 * 4. If actor is a staff member (officer):
 *    - SERVICE_STAFF and AUDITOR are rejected with 403 Forbidden.
 *    - FRONT_DESK and BRANCH_MANAGER are allowed for their OWN branch bookings; cross-branch rejected with 403 Forbidden.
 *    - CHAIN_MANAGER and SYSTEM_ADMINISTRATOR have universal chain-wide access across all branches.
 */
export async function verifyCancellationAccess(
  db: DbClient,
  bookingIdOrRef: string,
  actor: ActorContext,
): Promise<CancellationAccessResult> {
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

  // 2. Check if actor is an online guest (guest_account)
  const gaRes = await db.query<{ guest_id: string }>(
    `SELECT guest_id FROM guest_account WHERE user_id = $1`,
    [actor.userId],
  );

  if (gaRes.rows.length > 0) {
    const guestId = gaRes.rows[0].guest_id;
    if (guestId !== booking.guest_id) {
      return {
        allowed: false,
        statusCode: 403,
        reason: 'Forbidden: You do not have permission to cancel another guest reservation',
      };
    }
    return {
      allowed: true,
      bookingId: booking.booking_id,
      bookingRef: booking.booking_ref,
      branchId: booking.branch_id,
      actorType: 'GUEST',
      guestId,
    };
  }

  // 3. Actor is staff: verify staff profile and role
  const officerRes = await db.query<{
    officer_id: string;
    branch_id: string;
    role_name: string;
  }>(
    `SELECT o.officer_id, o.branch_id, r.role_name
       FROM officer o
       JOIN role r ON r.role_id = o.role_id
      WHERE o.officer_id = $1
        AND o.active = true`,
    [actor.userId],
  );

  if (officerRes.rows.length === 0) {
    return {
      allowed: false,
      statusCode: 403,
      reason: 'Forbidden: Actor profile is not an authorized staff account or registered guest account',
    };
  }

  const officer = officerRes.rows[0];
  const role = officer.role_name;

  if (role === 'SERVICE_STAFF') {
    return {
      allowed: false,
      statusCode: 403,
      reason: 'Forbidden: Service staff are not authorized to cancel reservations',
    };
  }

  if (role === 'AUDITOR') {
    return {
      allowed: false,
      statusCode: 403,
      reason: 'Forbidden: Auditors have read-only access and cannot cancel reservations',
    };
  }

  if (role === 'FRONT_DESK' || role === 'BRANCH_MANAGER') {
    if (booking.branch_id && booking.branch_id !== officer.branch_id) {
      return {
        allowed: false,
        statusCode: 403,
        reason: `Forbidden: Branch staff cannot cancel bookings for another branch`,
      };
    }
  }

  return {
    allowed: true,
    bookingId: booking.booking_id,
    bookingRef: booking.booking_ref,
    branchId: booking.branch_id,
    actorType: 'STAFF',
    roleName: role,
  };
}

/**
 * Executes atomic one-line cancellation.
 */
export async function cancelRoomLine(
  db: DbClient,
  params: CancelLineParams,
): Promise<CancelLineReceipt> {
  const sql = `
    SELECT booking_id,
           line_id,
           status,
           cancelled_at,
           cancelled_by,
           cancellation_fee,
           remaining_active_lines,
           new_outstanding_balance,
           is_credit,
           credit_amount
      FROM fn_cancel_room_line($1, $2, $3, $4, $5);
  `;

  const values = [
    params.bookingId,
    params.lineId,
    params.actorId,
    params.reason || 'Guest requested cancellation',
    params.cancelTime || null,
  ];

  const res = await db.query<CancelLineResult>(sql, values);
  if (res.rows.length === 0) {
    throw new Error('fn_cancel_room_line failed to return execution result');
  }

  const row = res.rows[0];
  return {
    booking_id: row.booking_id,
    line_id: row.line_id,
    status: 'CANCELLED',
    cancelled_at: row.cancelled_at,
    cancelled_by: row.cancelled_by,
    cancellation_fee: Number(row.cancellation_fee),
    remaining_active_lines: Number(row.remaining_active_lines),
    outstanding_balance: Number(row.new_outstanding_balance),
    is_credit: row.is_credit,
    credit_amount: Number(row.credit_amount),
  };
}

/**
 * Executes atomic whole-booking cancellation.
 */
export async function cancelWholeBooking(
  db: DbClient,
  params: CancelWholeBookingParams,
): Promise<CancelWholeBookingReceipt> {
  const sql = `
    SELECT booking_id,
           cancelled_lines_count,
           cancelled_line_ids,
           cancelled_at,
           cancelled_by,
           total_cancellation_fees,
           remaining_active_lines,
           new_outstanding_balance,
           is_credit,
           credit_amount
      FROM fn_cancel_whole_booking($1, $2, $3, $4);
  `;

  const values = [
    params.bookingId,
    params.actorId,
    params.reason || 'Guest requested whole booking cancellation',
    params.cancelTime || null,
  ];

  const res = await db.query<CancelWholeBookingResult>(sql, values);
  if (res.rows.length === 0) {
    throw new Error('fn_cancel_whole_booking failed to return execution result');
  }

  const row = res.rows[0];
  return {
    booking_id: row.booking_id,
    cancelled_lines_count: Number(row.cancelled_lines_count),
    cancelled_line_ids: row.cancelled_line_ids || [],
    cancelled_at: row.cancelled_at,
    cancelled_by: row.cancelled_by,
    total_cancellation_fees: Number(row.total_cancellation_fees),
    remaining_active_lines: Number(row.remaining_active_lines),
    outstanding_balance: Number(row.new_outstanding_balance),
    is_credit: row.is_credit,
    credit_amount: Number(row.credit_amount),
  };
}

/**
 * Inspects cancellation eligibility and fee quote for a booking or specific line.
 */
export async function getCancellationQuote(
  db: DbClient,
  bookingId: string,
  lineId?: string,
): Promise<CancellationQuote> {
  const sql = `
    SELECT l.line_id,
           l.status,
           l.stay_start_date,
           bp.cancellation_fee,
           bp.no_show_grace_days,
           inv.status AS invoice_status,
           ((l.stay_start_date + bp.no_show_grace_days)::text || ' 00:00:00+05:30')::timestamptz AS cutoff_deadline,
           CURRENT_TIMESTAMP AS now_time
      FROM booking_room_line l
      JOIN invoice inv ON inv.booking_id = l.booking_id
      JOIN billing_policy bp ON bp.billing_policy_id = inv.billing_policy_id
     WHERE l.booking_id = $1
       AND ($2::uuid IS NULL OR l.line_id = $2::uuid)
     ORDER BY l.line_id
     LIMIT 1;
  `;

  const res = await db.query<{
    line_id: string;
    status: string;
    stay_start_date: string;
    cancellation_fee: string;
    no_show_grace_days: number;
    invoice_status: string;
    cutoff_deadline: string;
    now_time: string;
  }>(sql, [bookingId, lineId || null]);

  if (res.rows.length === 0) {
    return {
      booking_id: bookingId,
      line_id: lineId,
      is_eligible: false,
      cancellation_fee: 0,
      rejection_reason: 'Line or booking not found',
    };
  }

  const row = res.rows[0];
  const fee = Number(row.cancellation_fee);
  const cutoff = new Date(row.cutoff_deadline).getTime();
  const now = new Date(row.now_time).getTime();

  if (row.invoice_status === 'FINAL') {
    return {
      booking_id: bookingId,
      line_id: row.line_id,
      is_eligible: false,
      stay_start_date: row.stay_start_date,
      cutoff_deadline: row.cutoff_deadline,
      cancellation_fee: fee,
      rejection_reason: 'Invoice is already FINAL',
    };
  }

  if (row.status !== 'BOOKED') {
    return {
      booking_id: bookingId,
      line_id: row.line_id,
      is_eligible: false,
      stay_start_date: row.stay_start_date,
      cutoff_deadline: row.cutoff_deadline,
      cancellation_fee: fee,
      rejection_reason: `Line is in ${row.status} status; only BOOKED lines may be cancelled`,
    };
  }

  if (now >= cutoff) {
    return {
      booking_id: bookingId,
      line_id: row.line_id,
      is_eligible: false,
      stay_start_date: row.stay_start_date,
      cutoff_deadline: row.cutoff_deadline,
      cancellation_fee: fee,
      rejection_reason: 'Cancellation deadline (no-show cutoff) has passed',
    };
  }

  return {
    booking_id: bookingId,
    line_id: row.line_id,
    is_eligible: true,
    stay_start_date: row.stay_start_date,
    cutoff_deadline: row.cutoff_deadline,
    cancellation_fee: fee,
  };
}
