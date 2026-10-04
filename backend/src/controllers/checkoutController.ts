import { Request, Response } from 'express';
import { pool } from '../db.js';
import { resolveActor } from './invoiceController.js';
import { DbClient } from '../services/invoiceService.js';
import {
  checkoutRoomLine,
  getCheckedOutLineReceipt,
  verifyStaffCheckoutAccess,
} from '../services/checkoutService.js';

export function createCheckoutControllers(db: DbClient = pool) {
  /**
   * POST /bookings/:bookingId/lines/:lineId/checkout
   * (or POST /bookings/:bookingId/checkout with body.lineId)
   *
   * Executes a line-specific checkout transaction with staff authorization,
   * zero-balance enforcement, assignment closure, room cleaning transition,
   * and explicit repeated-request behavior.
   */
  const postCheckoutHandler = async (req: Request, res: Response): Promise<void> => {
    const bookingId = Array.isArray(req.params.bookingId)
      ? req.params.bookingId[0]
      : req.params.bookingId;
    const rawLineId = Array.isArray(req.params.lineId)
      ? req.params.lineId[0]
      : req.params.lineId;
    const lineId: string | undefined =
      rawLineId ||
      req.body?.lineId ||
      req.body?.line_id;

    try {
      const actor = resolveActor(req);

      // 1. Validate line identifier
      if (!lineId || typeof lineId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lineId.trim())) {
        res.status(400).json({
          error: {
            code: 'INVALID_LINE_ID',
            message: 'A valid room line UUID is required for checkout',
          },
        });
        return;
      }

      const trimmedLineId = lineId.trim();

      // 2. Staff Authorization Guard (Role + Branch Tenancy)
      const access = await verifyStaffCheckoutAccess(db, bookingId, actor);
      if (!access.allowed) {
        res.status(access.statusCode).json({
          error: {
            code:
              access.statusCode === 401
                ? 'AUTHENTICATION_REQUIRED'
                : access.statusCode === 404
                ? 'BOOKING_NOT_FOUND'
                : 'FORBIDDEN',
            message: access.reason || 'Access denied',
          },
        });
        return;
      }

      const resolvedBookingId = access.resolvedBookingId || bookingId;

      // 3. Explicit Repeated-Request Check (Idempotency handling)
      // If the client explicitly requests idempotent repeat handling via header or query,
      // and the line is already CHECKED_OUT, return the existing receipt with 200 OK.
      const isIdempotentRequest =
        req.query.idempotent === 'true' ||
        Boolean(req.header('idempotency-key'));

      if (isIdempotentRequest) {
        const lineCheck = await db.query<{ status: string }>(
          'SELECT status FROM booking_room_line WHERE line_id = $1',
          [trimmedLineId],
        );
        if (lineCheck.rows.length > 0 && lineCheck.rows[0].status === 'CHECKED_OUT') {
          const existingReceipt = await getCheckedOutLineReceipt(db, trimmedLineId);
          if (existingReceipt) {
            res.status(200).json({
              success: true,
              repeated: true,
              message: 'Room line was already checked out',
              ...existingReceipt,
              receipt: existingReceipt,
            });
            return;
          }
        }
      }

      // 4. Execute atomic checkout transaction
      const reason = req.body?.reason || 'Guest checkout';
      const result = await checkoutRoomLine(db, {
        bookingId: resolvedBookingId,
        lineId: trimmedLineId,
        actorId: actor.userId,
        reason,
      });

      res.status(200).json({
        success: true,
        message: 'Room line checked out successfully',
        booking_id: result.booking_id,
        line_id: result.line_id,
        room_id: result.room_id,
        room_number: result.room_number,
        room_condition: result.room_condition,
        checked_out_at: result.checked_out_at,
        checked_out_by: result.checked_out_by,
        remaining_active_lines: result.remaining_active_lines,
        is_finalized: result.is_finalized,
        invoice_id: result.invoice_id,
        invoice_number: result.invoice_number,
        issued_at: result.issued_at,
        provisional_statement_ref: result.provisional_statement_ref,
        receipt: result.receipt,
      });
    } catch (err: any) {
      handleCheckoutError(res, err, lineId);
    }
  };

  /**
   * GET /bookings/:bookingId/lines/:lineId/checkout
   *
   * Retrieves the current checkout status and receipt for a room line.
   */
  const getCheckoutStatusHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const bookingId = Array.isArray(req.params.bookingId)
        ? req.params.bookingId[0]
        : req.params.bookingId;
      const lineId = Array.isArray(req.params.lineId)
        ? req.params.lineId[0]
        : req.params.lineId;
      const actor = resolveActor(req);

      const access = await verifyStaffCheckoutAccess(db, bookingId, actor);
      if (!access.allowed) {
        res.status(access.statusCode).json({
          error: {
            code:
              access.statusCode === 401
                ? 'AUTHENTICATION_REQUIRED'
                : access.statusCode === 404
                ? 'BOOKING_NOT_FOUND'
                : 'FORBIDDEN',
            message: access.reason || 'Access denied',
          },
        });
        return;
      }

      const receipt = await getCheckedOutLineReceipt(db, lineId);
      if (!receipt) {
        res.status(404).json({
          error: {
            code: 'NOT_CHECKED_OUT',
            message: 'Room line is not currently checked out or does not exist',
          },
        });
        return;
      }

      res.status(200).json({
        success: true,
        receipt,
      });
    } catch (err: any) {
      const lineId = Array.isArray(req.params.lineId)
        ? req.params.lineId[0]
        : req.params.lineId;
      handleCheckoutError(res, err, lineId);
    }
  };

  return {
    postCheckoutHandler,
    getCheckoutStatusHandler,
  };
}

/**
 * Translates PostgreSQL errors into clean, structured HTTP responses
 * without leaking internal database stack traces.
 */
function handleCheckoutError(res: Response, err: any, lineId?: string): void {
  const msg = err.message || '';

  // 1. Repeated Checkout State Conflict (409 Conflict)
  if (msg.includes('already CHECKED_OUT')) {
    res.status(409).json({
      error: {
        code: 'LINE_ALREADY_CHECKED_OUT',
        message: msg,
        details: {
          line_id: lineId,
          status: 'CHECKED_OUT',
          is_terminal: true,
        },
      },
    });
    return;
  }

  // 2. Invoice Already Final (409 Conflict)
  if (err.code === '55000' || msg.includes('invoice is already FINAL')) {
    res.status(409).json({
      error: {
        code: 'INVOICE_ALREADY_FINAL',
        message: msg || 'Cannot checkout: invoice is already finalized.',
      },
    });
    return;
  }

  // 3. Positive Balance Due Gate (400 Bad Request)
  if (msg.includes('outstanding balance of LKR')) {
    res.status(400).json({
      error: {
        code: 'OUTSTANDING_BALANCE_DUE',
        message: msg,
      },
    });
    return;
  }

  // 4. Unrefunded Credit Gate (400 Bad Request)
  if (msg.includes('unrefunded credit balance of LKR')) {
    res.status(400).json({
      error: {
        code: 'UNREFUNDED_CREDIT_REMAINING',
        message: msg,
      },
    });
    return;
  }

  // 5. Line Not in Eligible Status (400 Bad Request)
  if (msg.includes('cannot be checked out (current status:') || msg.includes('must be CHECKED_IN')) {
    res.status(400).json({
      error: {
        code: 'INVALID_LINE_STATUS',
        message: msg,
      },
    });
    return;
  }

  // 6. Cross-booking Line Mismatch (400 Bad Request)
  if (msg.includes('does not belong to booking')) {
    res.status(400).json({
      error: {
        code: 'LINE_BOOKING_MISMATCH',
        message: msg,
      },
    });
    return;
  }

  // 7. Missing Open Assignment (400 Bad Request)
  if (msg.includes('has no open assignment')) {
    res.status(400).json({
      error: {
        code: 'NO_OPEN_ASSIGNMENT',
        message: msg,
      },
    });
    return;
  }

  // 8. Entity Not Found (404 Not Found)
  if (err.code === '02000' || msg.includes('does not exist')) {
    const code = msg.includes('room line')
      ? 'ROOM_LINE_NOT_FOUND'
      : msg.includes('invoice')
      ? 'INVOICE_NOT_FOUND'
      : msg.includes('room')
      ? 'ROOM_NOT_FOUND'
      : 'BOOKING_NOT_FOUND';
    res.status(404).json({
      error: {
        code,
        message: msg,
      },
    });
    return;
  }

  // 9. Foreign Key Violation (404 Not Found)
  if (err.code === '23503') {
    res.status(404).json({
      error: {
        code: 'ENTITY_NOT_FOUND',
        message: msg,
      },
    });
    return;
  }

  // 10. Generic / Internal Server Error (500)
  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred while processing checkout.',
    },
  });
}

export const defaultCheckoutControllers = createCheckoutControllers();
export const postCheckoutHandler = defaultCheckoutControllers.postCheckoutHandler;
export const getCheckoutStatusHandler = defaultCheckoutControllers.getCheckoutStatusHandler;
