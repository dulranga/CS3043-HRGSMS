import { RequestHandler, Router } from 'express';
import { getActiveStay } from '../controllers/activeStayController';

export function createActiveStayRouter(requireRead: RequestHandler): Router {
  const router = Router();
  router.get('/stays/:bookingRef', requireRead, getActiveStay);
  return router;
}
