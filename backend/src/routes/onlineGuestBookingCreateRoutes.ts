import { RequestHandler, Router } from 'express';
import {
  OnlineGuestBookingRequestContext,
  createOnlineGuestBookingHandlers,
} from '../controllers/onlineGuestBookingCreateController';

export interface OnlineGuestBookingAuthorization {
  requireOnlineGuest: RequestHandler;
}

// Mount this factory at /api/guest after Member 1 supplies production session
// middleware. The database independently rechecks the authenticated user-to-
// guest_account link before confirmation.
export function createOnlineGuestBookingRouter(
  authorization: OnlineGuestBookingAuthorization,
  context: OnlineGuestBookingRequestContext,
): Router {
  const router = Router();
  const handlers = createOnlineGuestBookingHandlers(context);

  router.post('/bookings/quote', authorization.requireOnlineGuest, handlers.quote);
  router.post('/bookings', authorization.requireOnlineGuest, handlers.create);

  return router;
}
