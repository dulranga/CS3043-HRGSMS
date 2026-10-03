import { Router } from 'express';
import {
  getOccupancyReport,
  getRevenueReport,
  getGuestHistoryReport,
  getServiceUsageReport,
  getTopServicesReport,
  getAuditLogsReport,
  exportOccupancyReportCsv,
  exportRevenueReportCsv,
  exportGuestHistoryReportCsv,
} from '../controllers/reportController';

const router = Router();

router.get('/occupancy', getOccupancyReport);
router.get('/revenue', getRevenueReport);
router.get('/guest-history', getGuestHistoryReport);
router.get('/service-usage', getServiceUsageReport);
router.get('/service-usage/top', getTopServicesReport);
router.get('/audit-logs', getAuditLogsReport);

// CSV Export endpoints
router.get('/occupancy/export', exportOccupancyReportCsv);
router.get('/revenue/export', exportRevenueReportCsv);
router.get('/guest-history/export', exportGuestHistoryReportCsv);

export default router;