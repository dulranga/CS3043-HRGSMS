import type { Request, Response } from 'express';
import { pool } from '../db';
import { buildReportQuery, ReportFilterError } from '../reportQueries';
import { sendCsvResponse } from '../utils/csvExport';

function report(name: string, csv = false) {
  return async (req: Request, res: Response): Promise<void> => {
    res.set('Cache-Control', 'no-store');
    try {
      const query = buildReportQuery(name, req.query);
      if (!query) { res.status(404).json({ error: 'Report not found.' }); return; }
      const { rows } = await pool.query(query.sql, query.values);
      if (csv) sendCsvResponse(res, `${name}-${Date.now()}.csv`, rows);
      else if (name === 'audit-logs') res.json({ page: query.page, limit: query.limit, count: rows.length, data: rows });
      else res.json(rows);
    } catch (error) {
      res.status(error instanceof ReportFilterError ? 400 : 500).json({ error: error instanceof ReportFilterError ? error.message : 'Unable to load report.' });
    }
  };
}
export const getOccupancyReport = report('occupancy');
export const getBillingReport = report('billing');
export const getRevenueReport = report('revenue');
export const getGuestHistoryReport = report('guest-history');
export const getServiceUsageReport = report('service-usage');
export const getTopServicesReport = report('trends');
export const getAuditLogsReport = report('audit-logs');
export const exportOccupancyReportCsv = report('occupancy', true);
export const exportRevenueReportCsv = report('revenue', true);
export const exportGuestHistoryReportCsv = report('guest-history', true);
export const exportServiceUsageReportCsv = report('service-usage', true);
export const exportAuditLogsReportCsv = report('audit-logs', true);
export const exportReportCsv = (req: Request, res: Response) => report(String(req.params.name), true)(req, res);
