import { Request, Response } from 'express';
import {
  cancelRoomLine,
  cancelWholeBooking,
  getCancellationQuote,
  verifyCancellationAccess,
  DbClient,
} from '../services/cancellationService.js';
import { pool } from '../db.js';
import { resolveActor } from '../authorization';

function handleCancellationError(err: any, res: Response): void {
  const message = err?.message || String(err);
  const code = err?.code;

  if (code === '23514') {
    if (message.includes('cannot cancel whole booking')) {
      res.status(400).json({
        error: {
          code: 'NOT_ALL_LINES_ELIGIBLE',
          message: 'Whole-booking cancellation requires every room line to be eligible for cancellation',
          details: message,
        },
      });
      return;
    }

    if (message.includes('cutoff deadline') && message.includes('passed')) {
      res.status(400).json({
        error: {
          code: 'CANCELLATION_DEADLINE_PASSED',
          message: 'The cancellation deadline (no-show cutoff) has passed for this reservation',
          details: message,
        },
      });
      return;
    }

    if (message.includes('cannot be cancelled after check-in') || message.includes('CHECKED_IN')) {
      res.status(400).json({
        error: {
          code: 'CANNOT_CANCEL_CHECKED_IN',
          message: 'Checked-in room lines cannot be cancelled',
          details: message,
        },
      });
      return;
    }

    if (message.includes('is already CANCELLED')) {
      res.status(409).json({
        error: {
          code: 'LINE_ALREADY_CANCELLED',
          message: 'The room line is already cancelled',
          details: message,
        },
      });
      return;
    }

    if (message.includes('does not belong to booking')) {
      res.status(400).json({
        error: {
          code: 'LINE_BOOKING_MISMATCH',
          message: 'The room line does not belong to the specified booking',
          details: message,
        },
      });
      return;
    }

    if (message.includes('must be BOOKED') || message.includes('cannot be cancelled (current status:')) {
      res.status(400).json({
        error: {
          code: 'INVALID_LINE_STATUS',
          message: 'Only room lines in BOOKED status may be cancelled',
          details: message,
        },
      });
      return;
    }


    if (message.includes('no active booked lines to cancel')) {
      res.status(400).json({
        error: {
          code: 'NO_ACTIVE_BOOKED_LINES',
          message: 'The booking has no active booked lines to cancel',
          details: message,
        },
      });
      return;
    }

    res.status(400).json({
      error: {
        code: 'CANCELLATION_FAILED',
        message,
      },
    });
    return;
  }

  if (code === '02000') {
    if (message.includes('booking')) {
      res.status(404).json({
        error: {
          code: 'BOOKING_NOT_FOUND',
          message: 'The specified booking was not found',
        },
      });
      return;
    }
    if (message.includes('room line')) {
      res.status(404).json({
        error: {
          code: 'ROOM_LINE_NOT_FOUND',
          message: 'The specified room line was not found',
        },
      });
      return;
    }
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message,
      },
    });
    return;
  }

  if (code === '55000') {
    res.status(409).json({
      error: {
        code: 'INVOICE_ALREADY_FINAL',
        message: 'Cannot cancel reservation: the invoice is already in FINAL state',
      },
    });
    return;
  }

  console.error('[cancellationController] Unexpected error:', err);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected internal error occurred during cancellation',
    },
  });
}

export function createCancellationController(db: DbClient = pool) {
  /**
   * POST /api/bookings/:bookingId/lines/:lineId/cancel
   * Cancels a specific BOOKED room line.
   */
  const postCancelLineHandler = async (req: Request, res: Response): Promise<void> => {
    const rawBookingId = Array.isArray(req.params.bookingId)
      ? req.params.bookingId[0]
      : req.params.bookingId;
    const rawLineId = Array.isArray(req.params.lineId)
      ? req.params.lineId[0]
      : req.params.lineId;
    const lineId: string | undefined =
      rawLineId || req.body?.lineId || req.body?.line_id;

    try {
      const actor = resolveActor(req);

      if (!lineId || typeof lineId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lineId.trim())) {
        res.status(400).json({
          error: {
            code: 'INVALID_LINE_ID',
            message: 'A valid room line UUID is required for line cancellation',
          },
        });
        return;
      }

      const trimmedLineId = lineId.trim();

      // Authorization & Ownership Guard
      const access = await verifyCancellationAccess(db, rawBookingId, actor);
      if (!access.allowed) {
        res.status(access.statusCode || 403).json({
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

      const bookingId = access.bookingId || rawBookingId;

      // Check if line is already CANCELLED for idempotent repeat handling
      const isIdempotentRequest =
        req.query.idempotent === 'true' ||
        Boolean(req.headers['idempotency-key']);

      const existingLineRes = await db.query<{
        line_id: string;
        status: string;
      }>(
        `SELECT line_id, status FROM booking_room_line WHERE line_id = $1 AND booking_id = $2`,
        [trimmedLineId, bookingId],
      );

      if (existingLineRes.rows.length > 0 && existingLineRes.rows[0].status === 'CANCELLED') {
        if (isIdempotentRequest) {
          const balRes = await db.query<{ balance: string }>(
            `SELECT fn_outstanding_balance($1) AS balance`,
            [bookingId],
          );
          const bal = Number(balRes.rows[0]?.balance || 0);
          res.status(200).json({
            success: true,
            repeated: true,
            cancellation: {
              booking_id: bookingId,
              line_id: trimmedLineId,
              status: 'CANCELLED',
              outstanding_balance: bal,
              is_credit: bal < 0,
              credit_amount: bal < 0 ? Math.abs(bal) : 0,
            },
          });
          return;
        } else {
          res.status(409).json({
            error: {
              code: 'LINE_ALREADY_CANCELLED',
              message: 'This room line has already been cancelled',
            },
          });
          return;
        }
      }

      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : undefined;
      const cancelTime = typeof req.body?.cancelTime === 'string' ? req.body.cancelTime.trim() : undefined;

      const receipt = await cancelRoomLine(db, {
        bookingId,
        lineId: trimmedLineId,
        actorId: actor.userId!,
        reason,
        cancelTime,
      });

      res.status(200).json({
        success: true,
        cancellation: receipt,
      });
    } catch (err) {
      handleCancellationError(err, res);
    }
  };

  /**
   * POST /api/bookings/:bookingId/cancel
   * Cancels whole booking if all lines eligible, OR single line if lineId provided in body.
   */
  const postCancelBookingHandler = async (req: Request, res: Response): Promise<void> => {
    const rawBookingId = Array.isArray(req.params.bookingId)
      ? req.params.bookingId[0]
      : req.params.bookingId;
    const bodyLineId = req.body?.lineId || req.body?.line_id;

    if (bodyLineId) {
      return postCancelLineHandler(req, res);
    }

    try {
      const actor = resolveActor(req);

      // Authorization & Ownership Guard
      const access = await verifyCancellationAccess(db, rawBookingId, actor);
      if (!access.allowed) {
        res.status(access.statusCode || 403).json({
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

      const bookingId = access.bookingId || rawBookingId;
      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : undefined;
      const cancelTime = typeof req.body?.cancelTime === 'string' ? req.body.cancelTime.trim() : undefined;

      const receipt = await cancelWholeBooking(db, {
        bookingId,
        actorId: actor.userId!,
        reason,
        cancelTime,
      });

      res.status(200).json({
        success: true,
        cancellation: receipt,
      });
    } catch (err) {
      handleCancellationError(err, res);
    }
  };

  /**
   * GET /api/bookings/:bookingId/cancellation-quote
   * GET /api/bookings/:bookingId/lines/:lineId/cancellation-quote
   * Inspects cancellation eligibility and fee without mutating data.
   */
  const getCancellationQuoteHandler = async (req: Request, res: Response): Promise<void> => {
    const rawBookingId = Array.isArray(req.params.bookingId)
      ? req.params.bookingId[0]
      : req.params.bookingId;
    const rawLineId = Array.isArray(req.params.lineId)
      ? req.params.lineId[0]
      : req.params.lineId;

    try {
      const actor = resolveActor(req);
      const access = await verifyCancellationAccess(db, rawBookingId, actor);
      if (!access.allowed) {
        res.status(access.statusCode || 403).json({
          error: {
            code: access.statusCode === 401 ? 'AUTHENTICATION_REQUIRED' : 'FORBIDDEN',
            message: access.reason || 'Access denied',
          },
        });
        return;
      }

      const bookingId = access.bookingId || rawBookingId;
      const quote = await getCancellationQuote(db, bookingId, rawLineId);

      res.status(200).json({
        success: true,
        quote,
      });
    } catch (err) {
      handleCancellationError(err, res);
    }
  };

  return {
    postCancelLineHandler,
    postCancelBookingHandler,
    getCancellationQuoteHandler,
  };
}

export const defaultCancellationController = createCancellationController();
