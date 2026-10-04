import { Request, Response } from 'express';
import { pool } from '../db.js';
import { resolveActor } from './invoiceController.js';
import { DbClient } from '../services/invoiceService.js';
import {
  generatePaymentReference,
  recordPayment,
  reversePayment,
  verifyStaffPaymentAccess,
  PaymentReceipt,
} from '../services/paymentService.js';
import { PaymentKind, PaymentMethod, PaymentStatus } from '../models/payment.js';

export function createPaymentControllers(db: DbClient = pool) {
  /**
   * POST /bookings/:bookingId/payments
   * Records a payment or refund against a booking with staff authorization and balance validation.
   */
  const postPaymentHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const bookingId = Array.isArray(req.params.bookingId)
        ? req.params.bookingId[0]
        : req.params.bookingId;
      const actor = resolveActor(req);

      // 1. Staff Authorization Guard
      const access = await verifyStaffPaymentAccess(db, bookingId, actor);
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

      // 2. Body Validation
      const {
        amount,
        method,
        kind = 'PAYMENT',
        reference,
        status = 'SUCCESSFUL',
        paidAt,
      } = req.body || {};

      if (amount === undefined || amount === null || amount === '') {
        res.status(400).json({
          error: {
            code: 'INVALID_AMOUNT',
            message: 'Payment amount is required',
          },
        });
        return;
      }

      const numAmount = Number(amount);
      if (isNaN(numAmount) || numAmount <= 0) {
        res.status(400).json({
          error: {
            code: 'INVALID_AMOUNT',
            message: 'Payment amount must be a positive number greater than zero',
          },
        });
        return;
      }

      const decimalPlaces = (String(amount).split('.')[1] || '').length;
      if (decimalPlaces > 2) {
        res.status(400).json({
          error: {
            code: 'INVALID_AMOUNT_PRECISION',
            message: 'Payment amount cannot have more than 2 decimal places',
          },
        });
        return;
      }

      if (!method || !['CASH', 'BANK_TRANSFER'].includes(method)) {
        res.status(400).json({
          error: {
            code: 'INVALID_PAYMENT_METHOD',
            message: 'Payment method must be CASH or BANK_TRANSFER',
          },
        });
        return;
      }

      if (!['PAYMENT', 'REFUND'].includes(kind)) {
        res.status(400).json({
          error: {
            code: 'INVALID_PAYMENT_KIND',
            message: 'Payment kind must be PAYMENT or REFUND',
          },
        });
        return;
      }

      if (!['SUCCESSFUL', 'FAILED'].includes(status)) {
        res.status(400).json({
          error: {
            code: 'INVALID_PAYMENT_STATUS',
            message: 'Initial payment status must be SUCCESSFUL or FAILED',
          },
        });
        return;
      }

      if (paidAt && isNaN(new Date(paidAt).getTime())) {
        res.status(400).json({
          error: {
            code: 'INVALID_DATE',
            message: 'paidAt must be a valid date timestamp',
          },
        });
        return;
      }

      // Generate or normalize reference
      let finalReference = (reference || '').trim();
      if (!finalReference) {
        finalReference = generatePaymentReference(kind as PaymentKind);
      }

      // 3. Post payment via locked transaction
      const result = await recordPayment(db, {
        bookingId,
        recordedBy: actor.userId,
        kind: kind as PaymentKind,
        amount: numAmount,
        method: method as PaymentMethod,
        reference: finalReference,
        status: status as PaymentStatus,
        paidAt,
      });

      const prevBalNum = Number(result.previous_balance);
      const newBalNum = Number(result.new_balance);

      const receipt: PaymentReceipt = {
        receipt_reference: result.reference,
        booking_id: result.booking_id,
        payment_id: result.payment_id,
        kind: result.kind,
        amount: Number(result.amount),
        method: result.method,
        status: result.status,
        paid_at: result.paid_at,
        recorded_at: result.recorded_at,
        recorded_by: result.recorded_by,
        previous_balance: prevBalNum,
        new_balance: newBalNum,
        is_credit: result.is_credit,
        credit_amount: Number(result.credit_amount),
        is_settled: newBalNum === 0,
      };

      res.status(201).json({
        ...result,
        amount: Number(result.amount),
        previous_balance: prevBalNum,
        new_balance: newBalNum,
        credit_amount: Number(result.credit_amount),
        receipt,
      });
    } catch (err: any) {
      handleDatabaseError(res, err);
    }
  };

  /**
   * POST /bookings/:bookingId/refunds
   * Dedicated convenience endpoint for staff-approved manual refunds.
   */
  const postRefundHandler = async (req: Request, res: Response): Promise<void> => {
    req.body = { ...req.body, kind: 'REFUND' };
    return postPaymentHandler(req, res);
  };

  /**
   * POST /payments/:paymentId/reverse
   * Reverses a previously SUCCESSFUL payment or refund and reopens the balance.
   */
  const reversePaymentHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const paymentId = Array.isArray(req.params.paymentId)
        ? req.params.paymentId[0]
        : req.params.paymentId;
      const actor = resolveActor(req);

      if (!actor.userId) {
        res.status(401).json({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Authentication required',
          },
        });
        return;
      }

      // Look up booking associated with this payment
      const pRes = await db.query<{ booking_id: string; status: string; reference: string }>(
        `SELECT booking_id, status, reference FROM payment WHERE payment_id = $1`,
        [paymentId],
      );

      if (pRes.rows.length === 0) {
        res.status(404).json({
          error: {
            code: 'PAYMENT_NOT_FOUND',
            message: 'Payment record not found',
          },
        });
        return;
      }

      const { booking_id, status, reference } = pRes.rows[0];

      // Staff access check on booking
      const access = await verifyStaffPaymentAccess(db, booking_id, actor);
      if (!access.allowed) {
        res.status(access.statusCode).json({
          error: {
            code: access.statusCode === 404 ? 'BOOKING_NOT_FOUND' : 'FORBIDDEN',
            message: access.reason || 'Access denied',
          },
        });
        return;
      }

      if (status !== 'SUCCESSFUL') {
        res.status(400).json({
          error: {
            code: 'INVALID_PAYMENT_STATE',
            message: `Only SUCCESSFUL payments can be reversed (current status: ${status})`,
          },
        });
        return;
      }

      const revResult = await reversePayment(db, paymentId, actor.userId);

      res.status(200).json({
        ...revResult,
        amount: Number(revResult.amount),
        previous_balance: Number(revResult.previous_balance),
        new_balance: Number(revResult.new_balance),
        reversal_receipt: {
          payment_id: revResult.payment_id,
          reference: revResult.reference,
          reversed_by: actor.userId,
          reversed_at: new Date().toISOString(),
          reopened_balance: Number(revResult.new_balance),
        },
      });
    } catch (err: any) {
      handleDatabaseError(res, err);
    }
  };

  return {
    postPaymentHandler,
    postRefundHandler,
    reversePaymentHandler,
  };
}

function handleDatabaseError(res: Response, err: any): void {
  // PostgreSQL error handling
  if (err.code === '23514') {
    // Check violation
    const msg: string = err.message || '';
    if (msg.includes('exceeds current outstanding balance')) {
      res.status(400).json({
        error: {
          code: 'OVERPAYMENT_NOT_ALLOWED',
          message: msg,
        },
      });
      return;
    }
    if (msg.includes('no positive balance due')) {
      res.status(400).json({
        error: {
          code: 'NO_OUTSTANDING_BALANCE',
          message: msg,
        },
      });
      return;
    }
    if (msg.includes('exceeds available credit')) {
      res.status(400).json({
        error: {
          code: 'OVER_REFUND_NOT_ALLOWED',
          message: msg,
        },
      });
      return;
    }
    if (msg.includes('no credit balance to refund')) {
      res.status(400).json({
        error: {
          code: 'NO_CREDIT_TO_REFUND',
          message: msg,
        },
      });
      return;
    }
    res.status(400).json({
      error: {
        code: 'VALIDATION_FAILED',
        message: msg,
      },
    });
    return;
  }

  if (err.code === '23505') {
    // Unique violation (e.g. duplicate reference)
    res.status(409).json({
      error: {
        code: 'DUPLICATE_REFERENCE',
        message: 'Payment reference already exists. Please provide a unique reference.',
      },
    });
    return;
  }

  if (err.code === '55000') {
    // Object not in prerequisite state (e.g. FINAL invoice or invalid status transition)
    res.status(409).json({
      error: {
        code: 'INVOICE_FINAL',
        message: err.message || 'Operation prohibited in current invoice state.',
      },
    });
    return;
  }

  if (err.code === '02000') {
    // No data found
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: err.message || 'Requested entity not found',
      },
    });
    return;
  }

  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred while processing the transaction.',
    },
  });
}

export const defaultPaymentControllers = createPaymentControllers();
export const postPaymentHandler = defaultPaymentControllers.postPaymentHandler;
export const postRefundHandler = defaultPaymentControllers.postRefundHandler;
export const reversePaymentHandler = defaultPaymentControllers.reversePaymentHandler;
