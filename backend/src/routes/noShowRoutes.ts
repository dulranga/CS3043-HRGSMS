import { Router } from 'express';
import {
  createNoShowController,
  defaultNoShowController,
} from '../controllers/noShowController.js';
import { DbClient } from '../services/noShowService.js';

export function createNoShowRouter(db?: DbClient): Router {
  const router = Router();
  const controller = db ? createNoShowController(db) : defaultNoShowController;

  // Specific line NO_SHOW transition
  router.post(
    '/bookings/:bookingId/lines/:lineId/no-show',
    controller.postMarkLineNoShowHandler,
  );

  // No-show cutoff and fee quote inspection for specific line
  router.get(
    '/bookings/:bookingId/lines/:lineId/no-show-quote',
    controller.getNoShowQuoteHandler,
  );

  // Booking-level NO_SHOW transition (or line specified in body)
  router.post(
    '/bookings/:bookingId/no-show',
    controller.postMarkBookingNoShowHandler,
  );

  // Whole booking no-show quote inspection
  router.get(
    '/bookings/:bookingId/no-show-quote',
    controller.getNoShowQuoteHandler,
  );

  return router;
}

export const noShowRouter = createNoShowRouter();
export default noShowRouter;
