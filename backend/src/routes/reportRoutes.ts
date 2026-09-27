import { Router } from 'express';
import { getOccupancyReport, getRevenueReport } from '../controllers/reportController';

const router = Router();

router.get('/occupancy', getOccupancyReport);
router.get('/revenue', getRevenueReport);

export default router;