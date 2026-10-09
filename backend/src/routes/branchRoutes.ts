import { RequestHandler, Router } from 'express';
import type { BranchService } from '../branches';

// M1-S20 branch-record endpoints. Reads require branch.read (every staff role)
// and writes require branch.write (SYSTEM_ADMINISTRATOR), both chain-wide and
// injected by the caller. Deactivate/reactivate are explicit endpoints so a
// soft state change is always audited and cannot bypass Member 2's M2-S06
// current-assignment guard through a generic PATCH.
export function createBranchRouter(
  branches: BranchService,
  authorization: { requireRead: RequestHandler; requireWrite: RequestHandler },
): Router {
  const router = Router();

  router.get('/branches', authorization.requireRead, branches.list);
  router.get('/branches/:branchId', authorization.requireRead, branches.get);
  router.post('/branches', authorization.requireWrite, branches.create);
  router.patch('/branches/:branchId', authorization.requireWrite, branches.update);
  router.post('/branches/:branchId/deactivate', authorization.requireWrite, branches.deactivate);
  router.post('/branches/:branchId/reactivate', authorization.requireWrite, branches.reactivate);

  return router;
}
