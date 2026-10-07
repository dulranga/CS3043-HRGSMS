import { RequestHandler, Router } from 'express';
import type { GuestRegistrationService } from '../guestRegistration';

// M1-S10 endpoints. Registration is public; issuing a link code requires an
// authenticated FRONT_DESK session (guest.link.issue), injected by the caller.
export function createGuestRegistrationRouter(
  registration: GuestRegistrationService,
  authorization: { requireLinkIssuer: RequestHandler },
): Router {
  const router = Router();

  router.post('/auth/register', registration.register);
  router.post('/guests/:guestId/link-code', authorization.requireLinkIssuer, registration.issueCode);

  return router;
}
