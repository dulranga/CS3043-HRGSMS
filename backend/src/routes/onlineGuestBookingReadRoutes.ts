import { RequestHandler, Router } from 'express';
import {
  OnlineGuestBookingReadRequestContext,
  createOnlineGuestBookingReadHandlers,
} from '../controllers/onlineGuestBookingReadController';

export interface OnlineGuestBookingReadAuthorization {
  requireOnlineGuest: RequestHandler;
}

// Mount at /api/guest with Member 1's production session middleware. The
// service derives guest ownership from the authenticated user account for every
// list/detail request and conceals both absent and other-owner booking IDs.
export function createOnlineGuestBookingReadRouter(
  authorization: OnlineGuestBookingReadAuthorization,
  context: OnlineGuestBookingReadRequestContext,
): Router {
  const router = Router();
  const handlers = createOnlineGuestBookingReadHandlers(context);

  router.get('/bookings', authorization.requireOnlineGuest, handlers.list);
  router.get('/bookings/:bookingId', authorization.requireOnlineGuest, handlers.detail);

  return router;
}
