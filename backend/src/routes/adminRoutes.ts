import { Router } from 'express';
import { getSystemConfig, updateSystemConfig, getAuditLogs } from '../controllers/adminController';

const router = Router();

router.get('/config', getSystemConfig);
router.put('/config', updateSystemConfig);
router.get('/audit', getAuditLogs);

export default router;