import { Request, Response } from 'express';
import { pool } from '../db';
import { resolveActor } from './invoiceController';
import { verifyBookingAccess } from '../services/invoiceService';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value || '').trim();
}

function errorResponse(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

export async function getActiveStay(req: Request, res: Response): Promise<void> {
  const bookingRef = readParam(req.params.bookingRef);
  const actor = resolveActor(req);

  if (!actor.userId) {
    errorResponse(res, 401, 'AUTHENTICATION_REQUIRED', 'Authentication is required to view an active stay.');
    return;
  }
  if (!bookingRef) {
    errorResponse(res, 400, 'INVALID_BOOKING_REFERENCE', 'A booking reference is required.');
    return;
  }

  try {
    const bookingPredicate = UUID_PATTERN.test(bookingRef)
      ? 'booking_id = $1::uuid'
      : 'booking_ref = $1';
    const booking = await pool.query<{ booking_id: string; booking_ref: string }>(
      `SELECT booking_id, booking_ref FROM booking WHERE ${bookingPredicate}`,
      [bookingRef],
    );

    if (!booking.rows.length) {
      errorResponse(res, 404, 'BOOKING_NOT_FOUND', 'Booking was not found.');
      return;
    }

    const access = await verifyBookingAccess(pool, booking.rows[0].booking_id, actor);
    if (!access.allowed) {
      errorResponse(
        res,
        access.statusCode,
        access.statusCode === 401 ? 'AUTHENTICATION_REQUIRED' : 'STAY_ACCESS_DENIED',
        access.reason || 'Access denied.',
      );
      return;
    }

    const activeStay = await pool.query(
      `SELECT line.line_id,
              line.booking_id,
              line.stay_start_date,
              line.stay_end_date,
              line.guest_count,
              line.status,
              assignment.assignment_id,
              assignment.room_id,
              room.room_number,
              room.branch_id,
              assignment.occupied_from
         FROM booking_room_line AS line
         JOIN booking_room_assignment AS assignment
           ON assignment.line_id = line.line_id
          AND assignment.unassigned_at IS NULL
          AND assignment.occupied_from IS NOT NULL
          AND assignment.occupied_to IS NULL
         JOIN room ON room.room_id = assignment.room_id
        WHERE line.booking_id = $1::uuid
          AND line.status = 'CHECKED_IN'
        ORDER BY line.line_id`,
      [booking.rows[0].booking_id],
    );

    res.status(200).json({
      booking_id: booking.rows[0].booking_id,
      booking_ref: booking.rows[0].booking_ref,
      active_stays: activeStay.rows,
    });
  } catch (_error) {
    errorResponse(res, 500, 'ACTIVE_STAY_READ_FAILED', 'Unable to load the active stay.');
  }
}
