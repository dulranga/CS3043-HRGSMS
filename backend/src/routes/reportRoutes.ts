import { Router } from 'express';
import {
  getOccupancyReport,
  getRevenueReport,
  getGuestHistoryReport,
  getServiceUsageReport,
  getAuditLogsReport,
} from '../controllers/reportController';


const router = Router();

router.get('/occupancy', getOccupancyReport);
router.get('/revenue', getRevenueReport);
router.get('/guest-history', getGuestHistoryReport);
router.get('/service-usage', getServiceUsageReport);
router.get('/audit-logs', getAuditLogsReport);

export default router;