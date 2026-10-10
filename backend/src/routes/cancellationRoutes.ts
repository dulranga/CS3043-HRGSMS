import { RequestHandler, Router } from 'express';
import {
  createCancellationController,
  defaultCancellationController,
} from '../controllers/cancellationController.js';
import { DbClient } from '../services/cancellationService.js';

export function createCancellationRouter(db?: DbClient, authorize?: RequestHandler): Router {
  const router = Router();
  const guards = authorize ? [authorize] : [];
  const controller = db
    ? createCancellationController(db)
    : defaultCancellationController;

  // Specific line cancellation
  router.post(
    '/bookings/:bookingId/lines/:lineId/cancel',
    ...guards,
    controller.postCancelLineHandler,
  );

  // Cancellation quote inspection for specific line
  router.get(
    '/bookings/:bookingId/lines/:lineId/cancellation-quote',
    ...guards,
    controller.getCancellationQuoteHandler,
  );

  // Whole booking cancellation or line cancellation via body
  router.post(
    '/bookings/:bookingId/cancel',
    ...guards,
    controller.postCancelBookingHandler,
  );

  // Explicit whole booking cancellation alias
  router.post(
    '/bookings/:bookingId/cancel-all',
    ...guards,
    controller.postCancelBookingHandler,
  );

  // Whole booking cancellation quote inspection
  router.get(
    '/bookings/:bookingId/cancellation-quote',
    ...guards,
    controller.getCancellationQuoteHandler,
  );

  return router;
}

export const defaultCancellationRouter = createCancellationRouter();
export default defaultCancellationRouter;
