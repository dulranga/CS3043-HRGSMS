import { Router } from 'express';
import { getActiveStay } from '../controllers/activeStayController';

const router = Router();

router.get('/stays/:bookingRef', getActiveStay);

export default router;