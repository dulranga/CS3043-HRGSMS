import { RequestHandler, Router } from 'express';
import {
  BookingCreateRequestContext,
  createBookingCreateHandlers,
} from '../controllers/bookingCreateController';

export interface BookingCreateAuthorization {
  requireFrontDesk: RequestHandler;
}

// Member 1's authenticated session middleware supplies the actor, branch and
// FRONT_DESK authorization. The database transaction independently rechecks
// that actor's active role and branch before writing any booking records.
export function createBookingCreateRouter(
  authorization: BookingCreateAuthorization,
  context: BookingCreateRequestContext,
): Router {
  const router = Router();
  const handlers = createBookingCreateHandlers(context);

  router.post('/bookings/quote', authorization.requireFrontDesk, handlers.quote);
  router.post('/bookings', authorization.requireFrontDesk, handlers.create);

  return router;
}
