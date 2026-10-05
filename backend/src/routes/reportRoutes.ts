import { Router } from "express";
import {
  getOccupancyReport,
  getBillingReport,
  getRevenueReport,
  getGuestHistoryReport,
  getServiceUsageReport,
  getTopServicesReport,
  getAuditLogsReport,
  exportReportCsv,
  exportOccupancyReportCsv,
  exportRevenueReportCsv,
  exportGuestHistoryReportCsv,
  exportServiceUsageReportCsv,
  exportAuditLogsReportCsv,
} from "../controllers/reportController";

const router = Router();

// REPORT DATA ENDPOINTS

router.get("/occupancy", getOccupancyReport);
router.get("/billing", getBillingReport);
router.get("/revenue", getRevenueReport);
router.get("/guest-history", getGuestHistoryReport);
router.get("/service-usage", getServiceUsageReport);
router.get("/service-usage/top", getTopServicesReport);
router.get("/preference/trends", getTopServicesReport); // Alias matching plan specification
router.get("/audit-logs", getAuditLogsReport);

// SPECIFIC CSV EXPORT ENDPOINTS


router.get("/occupancy/export", exportOccupancyReportCsv);
router.get("/revenue/export", exportRevenueReportCsv);
router.get("/guest-history/export", exportGuestHistoryReportCsv);
router.get("/service-usage/export", exportServiceUsageReportCsv);
router.get("/audit-logs/export", exportAuditLogsReportCsv);

// GENERIC CSV EXPORT (Must come AFTER specific routes above)
router.get("/:name/export", exportReportCsv);

export default router;