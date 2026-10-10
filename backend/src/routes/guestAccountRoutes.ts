import type { RequestHandler, Router } from 'express';
import express from 'express';
import {
  type CreateGuestAccountService,
  validateGuestAccountWriteInput,
} from '../guestAccount';

// M1-S12 online guest own-profile API routes. Routes are mounted under
// /api/guest/profile (singular) to distinguish from /api/guests (plural,
// staff). All routes require an authenticated guest session; the guard
// ensures req.user.kind === 'GUEST' and req.user.guestId is set.

export function createGuestAccountRouter(
  service: CreateGuestAccountService,
  options: { requireGuest: RequestHandler },
): Router {
  const router = express.Router();

  // GET /api/guest/profile — read own profile.
  router.get(
    '/',
    options.requireGuest,
    async (req, res) => {
      const guestId = req.user?.guestId;
      if (!guestId) {
        res.status(401).json({ error: { code: 'AUTHENTICATION_REQUIRED', message: 'Authentication is required.' } });
        return;
      }

      try {
        const profile = await service.getOwnProfile(guestId);
        if (!profile) {
          res.status(404).json({ error: { code: 'GUEST_NOT_FOUND', message: 'Guest profile not found.' } });
          return;
        }

        res.status(200).set('cache-control', 'no-store').json({ data: profile });
      } catch (error) {
        throw error;
      }
    },
  );

  // PATCH /api/guest/profile — update own profile.
  router.patch(
    '/',
    options.requireGuest,
    async (req, res) => {
      const guestId = req.user?.guestId;
      const userId = req.user?.userId;
      if (!guestId || !userId) {
        res.status(401).json({ error: { code: 'AUTHENTICATION_REQUIRED', message: 'Authentication is required.' } });
        return;
      }

      const validation = validateGuestAccountWriteInput(req.body);
      if (validation.errors) {
        res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Request body is invalid.', fields: validation.errors } });
        return;
      }

      const input = validation.value!;
      try {
        const result = await service.updateOwnProfile(guestId, userId, input);
        if (result.error) {
          const status = result.error.code === 'GUEST_NOT_FOUND' ? 404 : result.error.code === 'GUEST_INACTIVE' ? 409 : 400;
          res.status(status).json({ error: result.error });
          return;
        }

        res.status(200).set('cache-control', 'no-store').json({ data: result.data });
      } catch (error) {
        throw error;
      }
    },
  );

  return router;
}
