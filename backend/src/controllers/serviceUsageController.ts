import { Request, Response } from 'express';
import { pool } from '../db';
import { member3Actor } from './member3Actor';
import { recordServiceUsage, voidServiceUsage } from '../services/serviceUsageService';
import { authorizeStaff, staffPrincipal } from '../authorization';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value || '').trim();
}

function errorResponse(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

async function resolveBooking(bookingRef: string): Promise<{ bookingId: string; branchId: string } | null> {
  const predicate = UUID_PATTERN.test(bookingRef)
    ? 'booking_id = $1::uuid'
    : 'booking_ref = $1';
  const result = await pool.query<{ booking_id: string; branch_id: string }>(
    `SELECT booking.booking_id,
            room.branch_id
       FROM booking
       JOIN booking_room_line AS line ON line.booking_id = booking.booking_id
       JOIN booking_room_assignment AS assignment
         ON assignment.line_id = line.line_id
        AND assignment.unassigned_at IS NULL
       JOIN room ON room.room_id = assignment.room_id
      WHERE booking.${predicate}
      ORDER BY line.line_id
      LIMIT 1`,
    [bookingRef],
  );
  const row = result.rows[0];
  return row
    ? { bookingId: row.booking_id, branchId: row.branch_id }
    : null;
}

async function authorizeUsageActor(actorId: string, branchId: string): Promise<string | null> {
  const result = await pool.query<{ role_name: string; branch_id: string }>(
    `SELECT role.role_name, officer.branch_id
       FROM officer
       JOIN role ON role.role_id = officer.role_id
       JOIN user_account ON user_account.user_id = officer.officer_id
      WHERE officer.officer_id = $1::uuid
        AND officer.active
        AND user_account.active`,
    [actorId],
  );
  const actor = result.rows[0];
  const roleName = actor?.role_name?.trim().toUpperCase();
  if (!actor || !roleName) {
    return null;
  }
  const decision = authorizeStaff(
    staffPrincipal(actorId, roleName, actor.branch_id),
    'service_usage.record',
    branchId.trim().toLowerCase(),
  );
  return decision.allowed ? roleName : null;
}

async function resolveBookingAnyAssignment(bookingRef: string): Promise<{ bookingId: string; branchId: string } | null> {
  const predicate = UUID_PATTERN.test(bookingRef) ? 'booking_id = $1::uuid' : 'booking_ref = $1';
  const result = await pool.query<{ booking_id: string; branch_id: string }>(
    `SELECT booking.booking_id,
            room.branch_id
       FROM booking
       JOIN booking_room_line AS line ON line.booking_id = booking.booking_id
       JOIN booking_room_assignment AS assignment ON assignment.line_id = line.line_id
       JOIN room ON room.room_id = assignment.room_id
      WHERE booking.${predicate}
      ORDER BY line.line_id
      LIMIT 1`,
    [bookingRef],
  );
  const row = result.rows[0];
  return row ? { bookingId: row.booking_id, branchId: row.branch_id } : null;
}

async function authorizeVoidActor(actorId: string, branchId: string): Promise<string | null> {
  const result = await pool.query<{ role_name: string; branch_id: string }>(
    `SELECT role.role_name, officer.branch_id
       FROM officer
       JOIN role ON role.role_id = officer.role_id
       JOIN user_account ON user_account.user_id = officer.officer_id
      WHERE officer.officer_id = $1::uuid
        AND officer.active
        AND user_account.active`,
    [actorId],
  );
  const actor = result.rows[0];
  const roleName = actor?.role_name?.trim().toUpperCase();
  if (!actor || !roleName) {
    return null;
  }
  const decision = authorizeStaff(
    staffPrincipal(actorId, roleName, actor.branch_id),
    'service_usage.void',
    branchId.trim().toLowerCase(),
  );
  return decision.allowed ? roleName : null;
}

function parseQuantity(value: unknown): number | string | null {
  if (typeof value !== 'number' && typeof value !== 'string') {
    return null;
  }
  const parsed = typeof value === 'string' ? Number(value.trim()) : value;
  return Number.isFinite(parsed) && parsed > 0 ? value : null;
}

export async function recordUsage(req: Request, res: Response): Promise<void> {
  const actor = member3Actor(req);
  const bookingRef = readParam(req.params.bookingRef);
  const body = req.body || {};
  const serviceId = String(body.serviceId ?? body.service_id ?? '').trim();
  const quantity = parseQuantity(body.quantity);
  const lineId = body.bookingRoomLineId ?? body.booking_room_line_id;

  if (!actor.userId) {
    errorResponse(res, 401, 'AUTHENTICATION_REQUIRED', 'Authentication is required to record service usage.');
    return;
  }
  if (!bookingRef || !UUID_PATTERN.test(serviceId)) {
    errorResponse(res, 400, 'INVALID_SERVICE_USAGE_INPUT', 'A booking reference and valid service UUID are required.');
    return;
  }
  if (quantity === null) {
    errorResponse(res, 400, 'INVALID_QUANTITY', 'Quantity must be a positive finite number.');
    return;
  }
  if (lineId !== undefined && (!lineId || !UUID_PATTERN.test(String(lineId)))) {
    errorResponse(res, 400, 'INVALID_ROOM_LINE_ID', 'Room-line attribution must be a valid UUID.');
    return;
  }

  try {
    const booking = await resolveBooking(bookingRef);
    if (!booking) {
      errorResponse(res, 404, 'BOOKING_NOT_FOUND', 'Booking was not found.');
      return;
    }
    if (!await authorizeUsageActor(actor.userId, booking.branchId)) {
      errorResponse(res, 403, 'USAGE_ACCESS_DENIED', 'Only active FRONT_DESK or SERVICE_STAFF users may record usage in their own branch.');
      return;
    }

    const result = await pool.connect();
    try {
      const usage = await recordServiceUsage(result, {
        bookingId: booking.bookingId,
        serviceId,
        quantity,
        recordedBy: actor.userId,
        bookingRoomLineId: lineId ? String(lineId) : undefined,
        usedAt: body.usedAt ?? body.used_at,
      });
      res.status(201).json({
        usage_id: usage.usageId,
        booking_id: usage.bookingId,
        service_id: usage.serviceId,
        booking_room_line_id: usage.bookingRoomLineId,
        quantity: usage.quantity,
        unit_price_snapshot: usage.unitPriceSnapshot,
        invoice_id: usage.invoiceId,
      });
    } finally {
      result.release();
    }
  } catch (error: any) {
    const message = error?.message || 'Unable to record service usage.';
    if (message.includes('Inactive service') || message.includes('CHECKED_IN') || message.includes('same booking')) {
      errorResponse(res, 409, 'USAGE_CONFLICT', message);
      return;
    }
    if (message.includes('Invoice is FINAL')) {
      errorResponse(res, 409, 'INVOICE_FINAL', message);
      return;
    }
    errorResponse(res, 400, 'USAGE_REJECTED', message);
  }
}

export async function listUsage(req: Request, res: Response): Promise<void> {
  const actor = member3Actor(req);
  const bookingRef = readParam(req.params.bookingRef);
  if (!actor.userId) {
    errorResponse(res, 401, 'AUTHENTICATION_REQUIRED', 'Authentication is required to view service usage.');
    return;
  }

  try {
    const booking = await resolveBooking(bookingRef);
    if (!booking) {
      errorResponse(res, 404, 'BOOKING_NOT_FOUND', 'Booking was not found.');
      return;
    }
    if (!await authorizeUsageActor(actor.userId, booking.branchId)) {
      errorResponse(res, 403, 'USAGE_ACCESS_DENIED', 'Service usage is restricted to the actor\'s own branch.');
      return;
    }

    const usage = await pool.query(
      `SELECT usage.usage_id,
              usage.booking_id,
              usage.service_id,
              service.name AS service_name,
              service.category,
              usage.booking_room_line_id,
              usage.used_at,
              usage.quantity,
              usage.unit_price_snapshot,
              ROUND(usage.quantity * usage.unit_price_snapshot, 2) AS amount,
usage.voided,
               usage.voided_at,
               usage.voided_by,
               usage.recorded_at,
               usage.recorded_by
          FROM service_usage AS usage
         JOIN service ON service.service_id = usage.service_id
        WHERE usage.booking_id = $1::uuid
        ORDER BY usage.used_at, usage.usage_id`,
      [booking.bookingId],
    );
    res.status(200).json({ booking_id: booking.bookingId, usage: usage.rows });
  } catch (_error) {
    errorResponse(res, 500, 'USAGE_READ_FAILED', 'Unable to load service usage.');
  }
}

export async function voidUsage(req: Request, res: Response): Promise<void> {
  const actor = member3Actor(req);
  const bookingRef = readParam(req.params.bookingRef);
  const usageId = readParam(req.params.usageId);
  const body = req.body || {};

  if (!actor.userId) {
    errorResponse(res, 401, 'AUTHENTICATION_REQUIRED', 'Authentication is required to void service usage.');
    return;
  }
  if (!bookingRef || !UUID_PATTERN.test(usageId)) {
    errorResponse(res, 400, 'INVALID_SERVICE_USAGE_VOID_INPUT', 'A booking reference and valid usage UUID are required.');
    return;
  }

  try {
    const booking = await resolveBookingAnyAssignment(bookingRef);
    if (!booking) {
      errorResponse(res, 404, 'BOOKING_NOT_FOUND', 'Booking was not found.');
      return;
    }
    if (!await authorizeVoidActor(actor.userId, booking.branchId)) {
      errorResponse(res, 403, 'VOID_ACCESS_DENIED', 'Only an active BRANCH_MANAGER of this branch, CHAIN_MANAGER or SYSTEM_ADMINISTRATOR may void service usage.');
      return;
    }

    const result = await pool.connect();
    try {
      const voided = await voidServiceUsage(result, {
        usageId,
        bookingId: booking.bookingId,
        voidedBy: actor.userId,
        reason: typeof body.reason === 'string' ? body.reason.slice(0, 255) : undefined,
      });
      res.status(200).json({
        usage_id: voided.usageId,
        booking_id: voided.bookingId,
        service_id: voided.serviceId,
        booking_room_line_id: voided.bookingRoomLineId,
        quantity: voided.quantity,
        unit_price_snapshot: voided.unitPriceSnapshot,
        voided: true,
        voided_amount: voided.voidedAmount,
        voided_at: voided.voidedAt,
        voided_by: voided.voidedBy,
        invoice_id: voided.invoiceId,
        billing: voided.balance,
      });
    } finally {
      result.release();
    }
  } catch (error: any) {
    const message = error?.message || 'Unable to void service usage.';
    if (message.includes('not found')) {
      errorResponse(res, 404, 'USAGE_NOT_FOUND', message);
      return;
    }
    if (message.includes('already voided')) {
      errorResponse(res, 409, 'USAGE_ALREADY_VOIDED', message);
      return;
    }
    if (message.includes('Invoice is FINAL')) {
      errorResponse(res, 409, 'INVOICE_FINAL', message);
      return;
    }
    errorResponse(res, 400, 'VOID_REJECTED', message);
  }
}
