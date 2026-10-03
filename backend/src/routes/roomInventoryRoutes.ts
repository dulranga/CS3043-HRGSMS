import { RequestHandler, Router } from 'express';
import {
  RoomInventoryRequestContext,
  createRoomInventoryHandlers,
} from '../controllers/roomInventoryController';

export interface RoomInventoryAuthorization {
  requireBranchRead: RequestHandler;
  requireBranchManager: RequestHandler;
}

// Member 1 supplies authenticated own-branch authorization and actor context.
// Member 3's future M3-S18 condition operation will add the audited physical-
// condition route; this router deliberately does not update operational_status.
export function createRoomInventoryRouter(
  authorization: RoomInventoryAuthorization,
  context: RoomInventoryRequestContext,
): Router {
  const router = Router();
  const handlers = createRoomInventoryHandlers(context);

  router.get('/rooms', authorization.requireBranchRead, handlers.listRooms);
  router.get('/rooms/:roomId', authorization.requireBranchRead, handlers.getRoom);
  router.post('/rooms', authorization.requireBranchManager, handlers.createRoom);
  router.patch('/rooms/:roomId', authorization.requireBranchManager, handlers.updateRoom);

  router.get('/rooms/:roomId/blocks', authorization.requireBranchRead, handlers.listBlocks);
  router.post('/rooms/:roomId/blocks', authorization.requireBranchManager, handlers.createBlock);
  router.patch('/room-blocks/:blockId', authorization.requireBranchManager, handlers.updateBlock);
  router.delete('/room-blocks/:blockId', authorization.requireBranchManager, handlers.deleteBlock);

  return router;
}
