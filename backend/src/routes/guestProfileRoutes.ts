import { RequestHandler, Router } from 'express';
import type { GuestProfileService } from '../guestProfiles';

// M1-S11 staff guest-profile endpoints. Every route requires an authenticated
// FRONT_DESK session (guest.manage), injected by the caller.
export function createGuestProfileRouter(
  guests: GuestProfileService,
  authorization: { requireGuestManager: RequestHandler },
): Router {
  const router = Router();
  const guard = authorization.requireGuestManager;

  router.post('/guests/search', guard, guests.search);
  router.post('/guests', guard, guests.create);
  router.get('/guests/:guestId', guard, guests.get);
  router.patch('/guests/:guestId', guard, guests.update);
  router.post('/guests/:guestId/deactivate', guard, guests.deactivate);
  router.post('/guests/:guestId/reactivate', guard, guests.reactivate);

  return router;
}
