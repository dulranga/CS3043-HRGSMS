import { RequestHandler, Router } from 'express';
import {
  createInvoiceControllers,
  defaultControllers,
} from '../controllers/invoiceController';
import { DbClient } from '../services/invoiceService';

export interface InvoiceRouteAuthorization {
  authenticate?: RequestHandler;
  authorizeBooking?: RequestHandler;
}

export function createInvoiceRouter(
  authorization?: InvoiceRouteAuthorization,
  db?: DbClient,
): Router {
  const router = Router();
  const controllers = db ? createInvoiceControllers(db) : defaultControllers;

  const middlewares: RequestHandler[] = [];
  if (authorization?.authenticate) {
    middlewares.push(authorization.authenticate);
  }
  if (authorization?.authorizeBooking) {
    middlewares.push(authorization.authorizeBooking);
  }

  router.get(
    '/bookings/:bookingId/invoice',
    ...middlewares,
    controllers.getBookingInvoiceHandler,
  );

  router.get(
    '/bookings/:bookingId/payments',
    ...middlewares,
    controllers.getBookingPaymentsHandler,
  );

  router.get(
    '/invoices/:invoiceId',
    ...middlewares,
    controllers.getInvoiceByIdHandler,
  );

  return router;
}

const defaultInvoiceRouter = createInvoiceRouter();
export default defaultInvoiceRouter;
