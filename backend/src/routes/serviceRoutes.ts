import express from 'express';
import { listServices, createService, updateService } from '../controllers/serviceController';

const router = express.Router();

router.get('/', listServices);
router.post('/', createService);
router.put('/:serviceId', updateService);

export default router;
