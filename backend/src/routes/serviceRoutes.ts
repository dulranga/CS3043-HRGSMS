import { RequestHandler, Router } from 'express';
import { listServices, createService, updateService } from '../controllers/serviceController';

export function createServiceRouter(authorization: {
  requireRead: RequestHandler;
  requireChainManager: RequestHandler;
}): Router {
  const router = Router();
  router.get('/', authorization.requireRead, listServices);
  router.post('/', authorization.requireChainManager, createService);
  router.put('/:serviceId', authorization.requireChainManager, updateService);
  return router;
}
