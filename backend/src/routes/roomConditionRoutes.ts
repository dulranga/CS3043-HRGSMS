import { RequestHandler, Router } from 'express';
import { patchRoomCondition } from '../controllers/roomConditionController';

// Member 2's room router deliberately leaves operational_status untouched and
// reserves this route for Member 3 (M3-S18). Member 1 supplies the authenticated
// actor and session authorization; the operation re-checks own-branch
// BRANCH_MANAGER/SERVICE_STAFF authority inside its own transaction.
export function createRoomConditionRouter(requireConditionAuthority: RequestHandler): Router {
  const router = Router();
  router.patch('/rooms/:roomId/condition', requireConditionAuthority, patchRoomCondition);
  return router;
}