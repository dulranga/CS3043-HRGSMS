import { Request, Response } from 'express';
import {
  DbClient,
  ActorContext,
  verifyStaffNoShowAccess,
  markRoomLineNoShow,
  markBookingNoShow,
  getNoShowQuote,
} from '../services/noShowService.js';
import { pool } from '../db.js';

// req.user comes from Member 1's session middleware (Express augmentation in
// src/auth.ts); the request-header fallback exists only for the isolated
// no-show test adapters and is never trusted for production identity.
function resolveActor(req: Request): ActorContext {
  const headerUserId = req.headers['x-user-id'];
  const headerRole = req.headers['x-role'];
  const headerBranchId = req.headers['x-branch-id'];

  const userId = req.user?.userId || (Array.isArray(headerUserId) ? headerUserId[0] : headerUserId);
  const role = req.user?.role || (Array.isArray(headerRole) ? headerRole[0] : headerRole);
  const branchId = req.user?.branchId || (Array.isArray(headerBranchId) ? headerBranchId[0] : headerBranchId);

  return {
    userId: typeof userId === 'string' ? userId.trim() : undefined,
    role: typeof role === 'string' ? role.trim() : undefined,
    branchId: typeof branchId === 'string' ? branchId.trim() : undefined,
  };
}

function handleNoShowError(err: any, res: Response): void {
  const message = err?.message || String(err);
  const code = err?.code;

  if (code === '23514') {
    if (message.includes('before cutoff deadline') || message.includes('has not yet passed')) {
      res.status(400).json({
        error: {
          code: 'EARLY_NO_SHOW_NOT_ALLOWED',
          message: 'Cannot mark room line as NO_SHOW before the cutoff deadline (stay_start_date + grace_days at 00:00 Asia/Colombo)',
          details: message,
        },
      });
      return;
    }

    if (message.includes('cannot mark booking')) {
      res.status(400).json({
        error: {
          code: 'NOT_ALL_LINES_ELIGIBLE',
          message: 'All room lines must be BOOKED and past cutoff deadline to mark whole booking as NO_SHOW',
          details: message,
        },
      });
      return;
    }

    if (message.includes('after check-in') || message.includes('CHECKED_IN')) {
      res.status(400).json({
        error: {
          code: 'CANNOT_NO_SHOW_CHECKED_IN',
          message: 'Checked-in room lines cannot be marked as NO_SHOW',
          details: message,
        },
      });
      return;
    }

    if (message.includes('is already CANCELLED')) {
      res.status(400).json({
        error: {
          code: 'CANNOT_NO_SHOW_CANCELLED',
          message: 'Cancelled room lines cannot be marked as NO_SHOW',
          details: message,
        },
      });
      return;
    }

    if (message.includes('is already CHECKED_OUT')) {
      res.status(400).json({
        error: {
          code: 'CANNOT_NO_SHOW_CHECKED_OUT',
          message: 'Checked-out room lines cannot be marked as NO_SHOW',
          details: message,
        },
      });
      return;
    }

    if (message.includes('is already marked NO_SHOW') || message.includes('already NO_SHOW')) {
      res.status(409).json({
        error: {
          code: 'LINE_ALREADY_NO_SHOW',
          message: 'The room line is already marked as NO_SHOW',
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

    if (message.includes('must be BOOKED') || message.includes('current status:')) {
      res.status(400).json({
        error: {
          code: 'INVALID_LINE_STATUS',
          message: 'Only room lines in BOOKED status may be marked as NO_SHOW',
          details: message,
        },
      });
      return;
    }

    if (message.includes('no active booked lines')) {
      res.status(400).json({
        error: {
          code: 'NO_ACTIVE_BOOKED_LINES',
          message: 'The booking has no active booked lines to mark as NO_SHOW',
          details: message,
        },
      });
      return;
    }

    res.status(400).json({
      error: {
        code: 'NO_SHOW_FAILED',
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

  if (code === '55000' || message.includes('FINAL')) {
    res.status(409).json({
      error: {
        code: 'INVOICE_ALREADY_FINAL',
        message: 'Cannot mark NO_SHOW on a booking with a finalized invoice',
      },
    });
    return;
  }

  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred during no-show processing',
      details: message,
    },
  });
}

export function createNoShowController(db: DbClient = pool) {
  /**
   * POST /api/bookings/:bookingId/lines/:lineId/no-show
   * Marks a specific room line as NO_SHOW at or after cutoff deadline.
   */
  const postMarkLineNoShowHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const actor = resolveActor(req);
      const rawBookingId = Array.isArray(req.params.bookingId)
        ? req.params.bookingId[0]
        : req.params.bookingId;
      const lineId = Array.isArray(req.params.lineId)
        ? req.params.lineId[0]
        : req.params.lineId || req.body?.lineId || req.body?.line_id;

      if (!lineId || typeof lineId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lineId.trim())) {
        res.status(400).json({
          error: {
            code: 'INVALID_LINE_ID',
            message: 'A valid room line UUID is required for no-show transition',
          },
        });
        return;
      }

      const trimmedLineId = lineId.trim();

      // Authorization Guard
      const access = await verifyStaffNoShowAccess(db, rawBookingId, actor);
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

      // Check if line is already NO_SHOW for idempotent repeat handling
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

      if (existingLineRes.rows.length > 0 && existingLineRes.rows[0].status === 'NO_SHOW') {
        if (isIdempotentRequest) {
          const balRes = await db.query<{ balance: string }>(
            `SELECT fn_outstanding_balance($1) AS balance`,
            [bookingId],
          );
          const bal = Number(balRes.rows[0]?.balance || 0);
          res.status(200).json({
            success: true,
            repeated: true,
            no_show: {
              booking_id: bookingId,
              line_id: trimmedLineId,
              status: 'NO_SHOW',
              outstanding_balance: bal,
              is_credit: bal < 0,
              credit_amount: bal < 0 ? Math.abs(bal) : 0,
            },
          });
          return;
        } else {
          res.status(409).json({
            error: {
              code: 'LINE_ALREADY_NO_SHOW',
              message: 'This room line has already been marked as NO_SHOW',
            },
          });
          return;
        }
      }

      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : undefined;
      const markTime = typeof req.body?.markTime === 'string' ? req.body.markTime.trim() : undefined;

      const receipt = await markRoomLineNoShow(db, {
        bookingId,
        lineId: trimmedLineId,
        actorId: actor.userId!,
        reason,
        markTime,
      });

      res.status(200).json({
        success: true,
        no_show: receipt,
      });
    } catch (err) {
      handleNoShowError(err, res);
    }
  };

  /**
   * POST /api/bookings/:bookingId/no-show
   * Marks line (if lineId passed in body) or all eligible BOOKED lines past cutoff in booking as NO_SHOW.
   */
  const postMarkBookingNoShowHandler = async (req: Request, res: Response): Promise<void> => {
    const rawBookingId = Array.isArray(req.params.bookingId)
      ? req.params.bookingId[0]
      : req.params.bookingId;
    const bodyLineId = req.body?.lineId || req.body?.line_id;

    if (bodyLineId) {
      return postMarkLineNoShowHandler(req, res);
    }

    try {
      const actor = resolveActor(req);

      // Authorization Guard
      const access = await verifyStaffNoShowAccess(db, rawBookingId, actor);
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
      const markTime = typeof req.body?.markTime === 'string' ? req.body.markTime.trim() : undefined;

      const receipt = await markBookingNoShow(db, {
        bookingId,
        actorId: actor.userId!,
        reason,
        markTime,
      });

      res.status(200).json({
        success: true,
        no_show: receipt,
      });
    } catch (err) {
      handleNoShowError(err, res);
    }
  };

  /**
   * GET /api/bookings/:bookingId/lines/:lineId/no-show-quote
   * Inspects no-show cutoff eligibility and fee for a room line.
   */
  const getNoShowQuoteHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const actor = resolveActor(req);
      const rawBookingId = Array.isArray(req.params.bookingId)
        ? req.params.bookingId[0]
        : req.params.bookingId;
      const lineId = Array.isArray(req.params.lineId)
        ? req.params.lineId[0]
        : req.params.lineId;

      const access = await verifyStaffNoShowAccess(db, rawBookingId, actor);
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
      const quote = await getNoShowQuote(db, bookingId, lineId);

      res.status(200).json({
        success: true,
        quote,
      });
    } catch (err) {
      handleNoShowError(err, res);
    }
  };

  return {
    postMarkLineNoShowHandler,
    postMarkBookingNoShowHandler,
    getNoShowQuoteHandler,
  };
}

export const defaultNoShowController = createNoShowController();
