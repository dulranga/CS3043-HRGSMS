import { RequestHandler, Router } from 'express';
import {
  BookingModificationRequestContext,
  createBookingModificationHandlers,
} from '../controllers/bookingModificationController';

export interface BookingModificationAuthorization {
  requireFrontDesk: RequestHandler;
  requireReservationMoveStaff: RequestHandler;
}

// Member 1 supplies authenticated actor/branch context. Database routines also
// recheck the active role and branch; a non-zero checked-in move adjustment is
// accepted only from an active own-branch BRANCH_MANAGER actor.
export function createBookingModificationRouter(
  authorization: BookingModificationAuthorization,
  context: BookingModificationRequestContext,
): Router {
  const router = Router();
  const handlers = createBookingModificationHandlers(context);

  router.post('/bookings/:bookingId/lines', authorization.requireFrontDesk, handlers.add);
  router.patch('/bookings/:bookingId/lines/:lineId', authorization.requireFrontDesk, handlers.change);
  router.post(
    '/bookings/:bookingId/lines/:lineId/move',
    authorization.requireReservationMoveStaff,
    handlers.move,
  );

  return router;
}
