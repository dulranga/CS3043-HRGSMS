import {
  MarkNoShowParams,
  NoShowReceipt,
  MarkNoShowResult,
  MarkNoShowBookingParams,
  MarkNoShowBookingReceipt,
  MarkNoShowBookingResult,
  NoShowQuote,
} from '../models/noShow.js';

export interface DbClient {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[]; rowCount?: number | null }>;
}

export interface ActorContext {
  userId?: string;
  role?: string;
  branchId?: string;
}

export interface NoShowAccessResult {
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
 * Verifies staff authorization to mark a room line or booking as NO_SHOW:
 * 1. Actor must be authenticated (401 Unauthorized if missing).
 * 2. Booking must exist (404 Not Found if missing).
 * 3. Online guests (guest_account) are strictly forbidden (403 Forbidden per FR-064).
 * 4. Staff members (officer):
 *    - SERVICE_STAFF and AUDITOR are rejected with 403 Forbidden.
 *    - FRONT_DESK and BRANCH_MANAGER are allowed for their OWN branch bookings; cross-branch rejected with 403 Forbidden.
 *    - CHAIN_MANAGER and SYSTEM_ADMINISTRATOR have universal chain-wide access across all branches.
 */
export async function verifyStaffNoShowAccess(
  db: DbClient,
  bookingIdOrRef: string,
  actor: ActorContext,
): Promise<NoShowAccessResult> {
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

  // 2. Check if actor is an online guest (guest_account) -> Forbidden for NO_SHOW
  const gaRes = await db.query<{ guest_id: string }>(
    `SELECT guest_id FROM guest_account WHERE user_id = $1`,
    [actor.userId],
  );

  if (gaRes.rows.length > 0) {
    return {
      allowed: false,
      statusCode: 403,
      reason: 'Forbidden: Online guests cannot mark reservations as no-show. Only authorized staff may perform no-show transitions.',
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
      WHERE o.officer_id = $1`,
    [actor.userId],
  );

  if (officerRes.rows.length === 0) {
    return {
      allowed: false,
      statusCode: 403,
      reason: 'Forbidden: Actor profile is not an authorized staff account',
    };
  }

  const officer = officerRes.rows[0];
  const role = officer.role_name;

  if (role === 'SERVICE_STAFF') {
    return {
      allowed: false,
      statusCode: 403,
      reason: 'Forbidden: Service staff are not authorized to mark reservations as no-show',
    };
  }

  if (role === 'AUDITOR') {
    return {
      allowed: false,
      statusCode: 403,
      reason: 'Forbidden: Auditors have read-only access and cannot perform no-show transitions',
    };
  }

  if (role === 'FRONT_DESK' || role === 'BRANCH_MANAGER') {
    if (booking.branch_id && booking.branch_id !== officer.branch_id) {
      return {
        allowed: false,
        statusCode: 403,
        reason: 'Forbidden: Branch staff cannot mark no-show for bookings of another branch',
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
 * Executes atomic one-line NO_SHOW transition.
 */
export async function markRoomLineNoShow(
  db: DbClient,
  params: MarkNoShowParams,
): Promise<NoShowReceipt> {
  const sql = `
    SELECT booking_id,
           line_id,
           status,
           no_show_at,
           marked_by,
           no_show_fee,
           remaining_active_lines,
           new_outstanding_balance,
           is_credit,
           credit_amount
      FROM fn_mark_no_show_room_line($1, $2, $3, $4, $5);
  `;

  const values = [
    params.bookingId,
    params.lineId,
    params.actorId,
    params.reason || 'Guest did not arrive (No-Show)',
    params.markTime || null,
  ];

  const res = await db.query<MarkNoShowResult>(sql, values);
  if (res.rows.length === 0) {
    throw new Error('fn_mark_no_show_room_line failed to return execution result');
  }

  const row = res.rows[0];
  return {
    booking_id: row.booking_id,
    line_id: row.line_id,
    status: 'NO_SHOW',
    no_show_at: row.no_show_at,
    marked_by: row.marked_by,
    no_show_fee: Number(row.no_show_fee),
    remaining_active_lines: Number(row.remaining_active_lines),
    outstanding_balance: Number(row.new_outstanding_balance),
    is_credit: row.is_credit,
    credit_amount: Number(row.credit_amount),
  };
}

/**
 * Executes atomic whole-booking NO_SHOW transition.
 */
export async function markBookingNoShow(
  db: DbClient,
  params: MarkNoShowBookingParams,
): Promise<MarkNoShowBookingReceipt> {
  const sql = `
    SELECT booking_id,
           no_show_lines_count,
           no_show_line_ids,
           no_show_at,
           marked_by,
           total_no_show_fees,
           remaining_active_lines,
           new_outstanding_balance,
           is_credit,
           credit_amount
      FROM fn_mark_no_show_booking($1, $2, $3, $4);
  `;

  const values = [
    params.bookingId,
    params.actorId,
    params.reason || 'Guests did not arrive (No-Show)',
    params.markTime || null,
  ];

  const res = await db.query<MarkNoShowBookingResult>(sql, values);
  if (res.rows.length === 0) {
    throw new Error('fn_mark_no_show_booking failed to return execution result');
  }

  const row = res.rows[0];
  return {
    booking_id: row.booking_id,
    no_show_lines_count: Number(row.no_show_lines_count),
    no_show_line_ids: row.no_show_line_ids || [],
    no_show_at: row.no_show_at,
    marked_by: row.marked_by,
    total_no_show_fees: Number(row.total_no_show_fees),
    remaining_active_lines: Number(row.remaining_active_lines),
    outstanding_balance: Number(row.new_outstanding_balance),
    is_credit: row.is_credit,
    credit_amount: Number(row.credit_amount),
  };
}

/**
 * Inspects no-show cutoff eligibility and fee quote for a booking or specific line.
 */
export async function getNoShowQuote(
  db: DbClient,
  bookingId: string,
  lineId?: string,
): Promise<NoShowQuote> {
  const sql = `
    SELECT l.line_id,
           l.status,
           l.stay_start_date,
           bp.no_show_fee,
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
    no_show_fee: string;
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
      no_show_fee: 0,
      rejection_reason: 'Booking or room line not found',
    };
  }

  const row = res.rows[0];
  const cutoffTime = new Date(row.cutoff_deadline).getTime();
  const nowTime = new Date(row.now_time).getTime();
  const fee = Number(row.no_show_fee);
  const graceDays = Number(row.no_show_grace_days);

  if (row.invoice_status === 'FINAL') {
    return {
      booking_id: bookingId,
      line_id: row.line_id,
      is_eligible: false,
      stay_start_date: row.stay_start_date,
      cutoff_deadline: row.cutoff_deadline,
      no_show_grace_days: graceDays,
      no_show_fee: fee,
      rejection_reason: 'Invoice is already finalized',
    };
  }

  if (row.status !== 'BOOKED') {
    return {
      booking_id: bookingId,
      line_id: row.line_id,
      is_eligible: false,
      stay_start_date: row.stay_start_date,
      cutoff_deadline: row.cutoff_deadline,
      no_show_grace_days: graceDays,
      no_show_fee: fee,
      rejection_reason: `Line status is ${row.status}, only BOOKED lines can be marked NO_SHOW`,
    };
  }

  if (nowTime < cutoffTime) {
    return {
      booking_id: bookingId,
      line_id: row.line_id,
      is_eligible: false,
      stay_start_date: row.stay_start_date,
      cutoff_deadline: row.cutoff_deadline,
      no_show_grace_days: graceDays,
      no_show_fee: fee,
      rejection_reason: `Cutoff deadline (${row.cutoff_deadline}) has not yet passed`,
    };
  }

  return {
    booking_id: bookingId,
    line_id: row.line_id,
    is_eligible: true,
    stay_start_date: row.stay_start_date,
    cutoff_deadline: row.cutoff_deadline,
    no_show_grace_days: graceDays,
    no_show_fee: fee,
  };
}
