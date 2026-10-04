import { Router } from 'express';
import type { AuthService } from '../auth';

// M1-S08 session endpoints. Other routers consume auth.authenticate (and the
// M1-S09 authorization middleware) rather than trusting request headers.
export function createAuthRouter(auth: AuthService): Router {
  const router = Router();

  router.post('/login', auth.login);
  router.post('/logout', auth.logout);
  router.get('/session', auth.authenticate, auth.currentSession);

  return router;
}
