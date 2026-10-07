import { Router } from 'express';
import {
  createCancellationController,
  defaultCancellationController,
} from '../controllers/cancellationController.js';
import { DbClient } from '../services/cancellationService.js';

export function createCancellationRouter(db?: DbClient): Router {
  const router = Router();
  const controller = db
    ? createCancellationController(db)
    : defaultCancellationController;

  // Specific line cancellation
  router.post(
    '/bookings/:bookingId/lines/:lineId/cancel',
    controller.postCancelLineHandler,
  );

  // Cancellation quote inspection for specific line
  router.get(
    '/bookings/:bookingId/lines/:lineId/cancellation-quote',
    controller.getCancellationQuoteHandler,
  );

  // Whole booking cancellation or line cancellation via body
  router.post(
    '/bookings/:bookingId/cancel',
    controller.postCancelBookingHandler,
  );

  // Explicit whole booking cancellation alias
  router.post(
    '/bookings/:bookingId/cancel-all',
    controller.postCancelBookingHandler,
  );

  // Whole booking cancellation quote inspection
  router.get(
    '/bookings/:bookingId/cancellation-quote',
    controller.getCancellationQuoteHandler,
  );

  return router;
}

export const defaultCancellationRouter = createCancellationRouter();
export default defaultCancellationRouter;
