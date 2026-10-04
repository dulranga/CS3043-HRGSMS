import { RequestHandler, Router } from 'express';
import { postCheckIn } from '../controllers/checkInController';

export function createCheckInRouter(requireStaff: RequestHandler): Router {
  const router = Router();
  router.post('/bookings/:bookingRef/lines/:lineId/checkin', requireStaff, postCheckIn);
  return router;
}
