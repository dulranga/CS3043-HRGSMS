import { Router } from 'express';
import { listUsage, recordUsage, voidUsage } from '../controllers/serviceUsageController';

const router = Router();

router.post('/bookings/:bookingRef/service-usage', recordUsage);
router.get('/bookings/:bookingRef/service-usage', listUsage);
router.post('/bookings/:bookingRef/service-usage/:usageId/void', voidUsage);

export default router;