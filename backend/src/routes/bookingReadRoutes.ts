import { RequestHandler, Router } from 'express';
import {
  BookingReadRequestContext,
  createBookingReadHandlers,
} from '../controllers/bookingReadController';

export interface BookingReadAuthorization {
  requireFrontDesk: RequestHandler;
}

// Member 1's session middleware supplies the authenticated staff role and
// assigned branch. The service applies that branch to every database read and
// returns not-found for both absent and out-of-branch booking identifiers.
export function createBookingReadRouter(
  authorization: BookingReadAuthorization,
  context: BookingReadRequestContext,
): Router {
  const router = Router();
  const handlers = createBookingReadHandlers(context);

  router.get('/bookings', authorization.requireFrontDesk, handlers.list);
  router.get('/bookings/:bookingId', authorization.requireFrontDesk, handlers.detail);

  return router;
}
