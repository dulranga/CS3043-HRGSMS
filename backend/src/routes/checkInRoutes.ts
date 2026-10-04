import { Router } from 'express';
import { postCheckIn } from '../controllers/checkInController';

const router = Router();

router.post('/bookings/:bookingRef/lines/:lineId/checkin', postCheckIn);

export default router;