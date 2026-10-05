import { Router } from 'express';
import { listUsage, recordUsage } from '../controllers/serviceUsageController';

const router = Router();

router.post('/bookings/:bookingRef/service-usage', recordUsage);
router.get('/bookings/:bookingRef/service-usage', listUsage);

export default router;