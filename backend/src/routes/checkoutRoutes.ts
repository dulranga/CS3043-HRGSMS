import { RequestHandler, Router } from 'express';
import {
  createCheckoutControllers,
  defaultCheckoutControllers,
} from '../controllers/checkoutController.js';
import { DbClient } from '../services/invoiceService.js';

export interface CheckoutRouteAuthorization {
  authenticate?: RequestHandler;
  authorizeStaff?: RequestHandler;
}

export function createCheckoutRouter(
  authorization?: CheckoutRouteAuthorization,
  db?: DbClient,
): Router {
  const router = Router();
  const controllers = db ? createCheckoutControllers(db) : defaultCheckoutControllers;

  const middlewares: RequestHandler[] = [];
  if (authorization?.authenticate) {
    middlewares.push(authorization.authenticate);
  }
  if (authorization?.authorizeStaff) {
    middlewares.push(authorization.authorizeStaff);
  }

  // POST /bookings/:bookingId/lines/:lineId/checkout
  router.post(
    '/bookings/:bookingId/lines/:lineId/checkout',
    ...middlewares,
    controllers.postCheckoutHandler,
  );

  // POST /bookings/:bookingId/checkout (with lineId in body)
  router.post(
    '/bookings/:bookingId/checkout',
    ...middlewares,
    controllers.postCheckoutHandler,
  );

  // GET /bookings/:bookingId/lines/:lineId/checkout
  router.get(
    '/bookings/:bookingId/lines/:lineId/checkout',
    ...middlewares,
    controllers.getCheckoutStatusHandler,
  );

  return router;
}

const defaultCheckoutRouter = createCheckoutRouter();
export default defaultCheckoutRouter;
