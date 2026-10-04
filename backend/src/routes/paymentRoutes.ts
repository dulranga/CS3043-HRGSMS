import { RequestHandler, Router } from 'express';
import {
  createPaymentControllers,
  defaultPaymentControllers,
} from '../controllers/paymentController.js';
import { DbClient } from '../services/invoiceService.js';

export interface PaymentRouteAuthorization {
  authenticate?: RequestHandler;
  authorizeStaff?: RequestHandler;
}

export function createPaymentRouter(
  authorization?: PaymentRouteAuthorization,
  db?: DbClient,
): Router {
  const router = Router();
  const controllers = db ? createPaymentControllers(db) : defaultPaymentControllers;

  const middlewares: RequestHandler[] = [];
  if (authorization?.authenticate) {
    middlewares.push(authorization.authenticate);
  }
  if (authorization?.authorizeStaff) {
    middlewares.push(authorization.authorizeStaff);
  }

  // POST /bookings/:bookingId/payments
  router.post(
    '/bookings/:bookingId/payments',
    ...middlewares,
    controllers.postPaymentHandler,
  );

  // POST /bookings/:bookingId/refunds
  router.post(
    '/bookings/:bookingId/refunds',
    ...middlewares,
    controllers.postRefundHandler,
  );

  // POST /payments/:paymentId/reverse
  router.post(
    '/payments/:paymentId/reverse',
    ...middlewares,
    controllers.reversePaymentHandler,
  );

  return router;
}

const defaultPaymentRouter = createPaymentRouter();
export default defaultPaymentRouter;
