import { Request, Response } from 'express';
import { pool } from '../db';
import { member3Actor } from './member3Actor';
import { checkInRoomLine } from '../services/checkInService';

const UUID_ANY_VERSION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BRANCH_SCOPED_ROLES = new Set(['FRONT_DESK', 'BRANCH_MANAGER']);
const CHAIN_SCOPED_ROLES = new Set(['CHAIN_MANAGER', 'SYSTEM_ADMINISTRATOR']);

function readParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value || '').trim();
}

function errorResponse(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

export async function postCheckIn(req: Request, res: Response): Promise<void> {
  const bookingRef = readParam(req.params.bookingRef);
  const lineId = readParam(req.params.lineId);
  const actor = member3Actor(req);

  if (!actor.userId) {
    errorResponse(res, 401, 'AUTHENTICATION_REQUIRED', 'Authentication is required for check-in.');
    return;
  }
  if (!bookingRef) {
    errorResponse(res, 400, 'INVALID_BOOKING_REFERENCE', 'A booking reference is required.');
    return;
  }
  if (!UUID_ANY_VERSION_PATTERN.test(lineId)) {
    errorResponse(res, 400, 'INVALID_LINE_ID', 'A valid room-line UUID is required.');
    return;
  }

  try {
    const bookingPredicate = UUID_ANY_VERSION_PATTERN.test(bookingRef)
      ? 'b.booking_id = $1::uuid'
      : 'b.booking_ref = $1';
    const target = await pool.query<{
      booking_id: string;
      line_id: string;
      branch_id: string;
    }>(
      `SELECT b.booking_id, line.line_id, room.branch_id
         FROM booking AS b
         JOIN booking_room_line AS line ON line.booking_id = b.booking_id
         JOIN booking_room_assignment AS assignment
           ON assignment.line_id = line.line_id
          AND assignment.unassigned_at IS NULL
         JOIN room ON room.room_id = assignment.room_id
        WHERE ${bookingPredicate}
          AND line.line_id = $2::uuid`,
      [bookingRef, lineId],
    );

    if (!target.rows.length) {
      errorResponse(res, 404, 'BOOKING_LINE_NOT_FOUND', 'Booking or room line was not found.');
      return;
    }

    const staff = await pool.query<{
      branch_id: string;
      role_name: string;
    }>(
      `SELECT officer.branch_id, role.role_name
         FROM officer
         JOIN user_account ON user_account.user_id = officer.officer_id
         JOIN role ON role.role_id = officer.role_id
        WHERE officer.officer_id = $1::uuid
          AND user_account.active = true`,
      [actor.userId],
    );

    if (!staff.rows.length) {
      errorResponse(res, 403, 'STAFF_AUTHORIZATION_REQUIRED', 'An active staff profile is required for check-in.');
      return;
    }

    const { branch_id: actorBranchId, role_name: roleName } = staff.rows[0];
    if (!BRANCH_SCOPED_ROLES.has(roleName) && !CHAIN_SCOPED_ROLES.has(roleName)) {
      errorResponse(res, 403, 'CHECK_IN_FORBIDDEN', `Role ${roleName} cannot perform check-in.`);
      return;
    }
    if (BRANCH_SCOPED_ROLES.has(roleName) && actorBranchId !== target.rows[0].branch_id) {
      errorResponse(res, 403, 'BRANCH_ACCESS_DENIED', 'Check-in is restricted to the staff member\'s branch.');
      return;
    }

    const client = await pool.connect();
    try {
      const result = await checkInRoomLine(client, {
        lineId,
        actorId: actor.userId,
        bookingId: target.rows[0].booking_id,
      });

      res.status(200).json({
        success: true,
        message: 'Room line checked in successfully.',
        booking_id: result.bookingId,
        line_id: result.lineId,
        assignment_id: result.assignmentId,
        room_id: result.roomId,
        checked_in_at: result.checkedInAt,
      });
    } finally {
      client.release();
    }
  } catch (error: any) {
    const message = error?.message || 'Unable to check in room line.';
    if (['23514', '23505', '40P01', '40001'].includes(error?.code)) {
      errorResponse(res, 409, 'CHECK_IN_CONFLICT', 'The room line changed or conflicts with current inventory. Retry the complete request.');
      return;
    }
    if (message.includes('not found')) {
      errorResponse(res, 404, 'BOOKING_LINE_NOT_FOUND', message);
      return;
    }
    if (message.includes('Only BOOKED') || message.includes('outside the room line stay')) {
      errorResponse(res, 409, 'INVALID_CHECK_IN_STATE', message);
      return;
    }
    if (message.includes('READY') || message.includes('open assignment')) {
      errorResponse(res, 409, 'CHECK_IN_CONFLICT', message);
      return;
    }
    errorResponse(res, 500, 'CHECK_IN_FAILED', 'Check-in could not be completed.');
  }
}
