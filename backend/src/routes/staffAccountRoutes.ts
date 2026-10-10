import { RequestHandler, Router } from 'express';
import type { StaffAccountService } from '../staffAccounts';

// M1-S13 staff-account endpoints. Reads require account.read
// (SYSTEM_ADMINISTRATOR/AUDITOR) and writes require account.write
// (SYSTEM_ADMINISTRATOR), both injected by the caller.
export function createStaffAccountRouter(
  officers: StaffAccountService,
  authorization: { requireRead: RequestHandler; requireWrite: RequestHandler },
): Router {
  const router = Router();

  router.post('/users/search', authorization.requireRead, officers.search);
  router.get('/users/:userId', authorization.requireRead, officers.get);
  router.post('/users', authorization.requireWrite, officers.create);
  router.patch('/users/:userId', authorization.requireWrite, officers.update);
  router.post('/users/:userId/disable', authorization.requireWrite, officers.disable);
  router.post('/users/:userId/reactivate', authorization.requireWrite, officers.reactivate);

  return router;
}
