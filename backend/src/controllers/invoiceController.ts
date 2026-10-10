import { Request, Response } from 'express';
import { pool } from '../db';
import {
  ActorContext,
  DbClient,
  getBookingInvoiceDetail,
  getBookingPaymentHistory,
  verifyBookingAccess,
} from '../services/invoiceService';

import { resolveActor } from '../authorization';

// Re-exported so the checkout/payment controllers share the one actor seam.
export { resolveActor };

export function createInvoiceControllers(db: DbClient = pool) {
  const getBookingInvoiceHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const bookingId = Array.isArray(req.params.bookingId) ? req.params.bookingId[0] : req.params.bookingId;
      const actor = resolveActor(req);

      const access = await verifyBookingAccess(db, bookingId, actor);
      if (!access.allowed) {
        res.status(access.statusCode).json({
          error: {
            code: access.statusCode === 401 ? 'AUTHENTICATION_REQUIRED' : access.statusCode === 404 ? 'BOOKING_NOT_FOUND' : 'FORBIDDEN',
            message: access.reason || 'Access denied',
          },
        });
        return;
      }

      const invoice = await getBookingInvoiceDetail(db, bookingId);
      if (!invoice) {
        res.status(404).json({
          error: {
            code: 'INVOICE_NOT_FOUND',
            message: 'No invoice found for booking',
          },
        });
        return;
      }

      res.status(200).json(invoice);
    } catch (err: any) {
      res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Unable to load invoice details.',
        },
      });
    }
  };

  const getBookingPaymentsHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const bookingId = Array.isArray(req.params.bookingId) ? req.params.bookingId[0] : req.params.bookingId;
      const actor = resolveActor(req);

      const access = await verifyBookingAccess(db, bookingId, actor);
      if (!access.allowed) {
        res.status(access.statusCode).json({
          error: {
            code: access.statusCode === 401 ? 'AUTHENTICATION_REQUIRED' : access.statusCode === 404 ? 'BOOKING_NOT_FOUND' : 'FORBIDDEN',
            message: access.reason || 'Access denied',
          },
        });
        return;
      }

      const history = await getBookingPaymentHistory(db, bookingId);
      res.status(200).json(history);
    } catch (err: any) {
      res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Unable to load payment history.',
        },
      });
    }
  };

  const getInvoiceByIdHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const invoiceId = Array.isArray(req.params.invoiceId) ? req.params.invoiceId[0] : req.params.invoiceId;
      const actor = resolveActor(req);

      // Resolve bookingId from invoiceId
      const invCheck = await db.query<{ booking_id: string }>(
        'SELECT booking_id FROM invoice WHERE invoice_id = $1',
        [invoiceId],
      );

      if (invCheck.rows.length === 0) {
        res.status(404).json({
          error: {
            code: 'INVOICE_NOT_FOUND',
            message: 'Invoice not found',
          },
        });
        return;
      }

      const bookingId = invCheck.rows[0].booking_id;
      const access = await verifyBookingAccess(db, bookingId, actor);
      if (!access.allowed) {
        res.status(access.statusCode).json({
          error: {
            code: access.statusCode === 401 ? 'AUTHENTICATION_REQUIRED' : 'FORBIDDEN',
            message: access.reason || 'Access denied',
          },
        });
        return;
      }

      const invoice = await getBookingInvoiceDetail(db, bookingId);
      res.status(200).json(invoice);
    } catch (err: any) {
      res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Unable to load booking balance.',
        },
      });
    }
  };

  return {
    getBookingInvoiceHandler,
    getBookingPaymentsHandler,
    getInvoiceByIdHandler,
  };
}

export const defaultControllers = createInvoiceControllers();
export const getBookingInvoiceHandler = defaultControllers.getBookingInvoiceHandler;
export const getBookingPaymentsHandler = defaultControllers.getBookingPaymentsHandler;
export const getInvoiceByIdHandler = defaultControllers.getInvoiceByIdHandler;
