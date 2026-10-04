import { RequestHandler, Router } from 'express';
import {
  createAmenityHandler,
  createRoomTypeHandler,
  getAmenityHandler,
  getRoomTypeHandler,
  listAmenitiesHandler,
  listRoomTypesHandler,
  updateAmenityHandler,
  updateRoomTypeHandler,
} from '../controllers/catalogueController';

export interface CatalogueRouteAuthorization {
  requireRead: RequestHandler;
  requireChainManager: RequestHandler;
}

// Member 1's authenticated-session middleware supplies these two authorization
// handlers. Keeping them injected prevents this feature from trusting a spoofable
// request header or defining a competing login/session mechanism.
export function createCatalogueRouter(authorization: CatalogueRouteAuthorization): Router {
  const router = Router();

  router.get('/room-types', authorization.requireRead, listRoomTypesHandler);
  router.get('/room-types/:roomTypeId', authorization.requireRead, getRoomTypeHandler);
  router.post('/room-types', authorization.requireChainManager, createRoomTypeHandler);
  router.patch('/room-types/:roomTypeId', authorization.requireChainManager, updateRoomTypeHandler);

  router.get('/amenities', authorization.requireRead, listAmenitiesHandler);
  router.get('/amenities/:amenityId', authorization.requireRead, getAmenityHandler);
  router.post('/amenities', authorization.requireChainManager, createAmenityHandler);
  router.patch('/amenities/:amenityId', authorization.requireChainManager, updateAmenityHandler);

  return router;
}
