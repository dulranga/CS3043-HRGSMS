import { Request, Response } from 'express';
import { pool } from '../db'; // Adjust to your pg pool path

import { sendCsvResponse } from '../utils/csvExport';

import {
  OccupancyReport,
  RevenueReport,
  GuestHistoryReport,
  ServiceUsageReport,
  AuditLogReport
} from '../models/report.model';

// 1. Current Occupancy (optional filter by branch_id)
export const getOccupancyReport = async (req: Request, res: Response) => {
  try {
    const { branch_id } = req.query;
    let query = 'SELECT * FROM view_current_occupancy WHERE 1=1';
    const params: unknown[] = [];

    if (branch_id) {
      params.push(branch_id);
      query += ` AND branch_id = $${params.length}`;
    }

    query += ' ORDER BY branch_name ASC';

    const { rows } = await pool.query<OccupancyReport>(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Occupancy Report Error:', err);
    res.status(500).json({ error: 'Failed to fetch occupancy report' });
  }
};

// 2. Monthly Revenue (filters by branch_id, year, or month range)
export const getRevenueReport = async (req: Request, res: Response) => {
  try {
    const { branch_id, year, start_date, end_date } = req.query;
    let query = 'SELECT * FROM view_monthly_branch_revenue WHERE 1=1';
    const params: unknown[] = [];

    if (branch_id) {
      params.push(branch_id);
      query += ` AND branch_id = $${params.length}`;
    }

    if (year) {
      params.push(year);
      query += ` AND EXTRACT(YEAR FROM revenue_month) = $${params.length}`;
    }

    if (start_date) {
      params.push(start_date);
      query += ` AND revenue_month >= $${params.length}::date`;
    }

    if (end_date) {
      params.push(end_date);
      query += ` AND revenue_month <= $${params.length}::date`;
    }

    query += ' ORDER BY revenue_month DESC, branch_name ASC';

    const { rows } = await pool.query<RevenueReport>(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Revenue Report Error:', err);
    res.status(500).json({ error: 'Failed to fetch revenue report' });
  }
};

// 3. Guest History (search by name/email/phone + filter by minimum stays)
export const getGuestHistoryReport = async (req: Request, res: Response) => {
  try {
    const { search, min_stays, limit = '50', offset = '0' } = req.query;
    let query = 'SELECT * FROM view_guest_history WHERE 1=1';
    const params: unknown[] = [];

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (full_name ILIKE $${params.length} OR email ILIKE $${params.length} OR phone ILIKE $${params.length})`;
    }

    if (min_stays) {
      params.push(Number(min_stays));
      query += ` AND total_stays >= $${params.length}`;
    }

    params.push(Number(limit));
    query += ` ORDER BY lifetime_expenditure DESC, total_stays DESC LIMIT $${params.length}`;

    params.push(Number(offset));
    query += ` OFFSET $${params.length}`;

    const { rows } = await pool.query<GuestHistoryReport>(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Guest History Report Error:', err);
    res.status(500).json({ error: 'Failed to fetch guest history report' });
  }
};

// 4. Service Usage Report (supports filtering by category & name search)
export const getServiceUsageReport = async (req: Request, res: Response) => {
  try {
    const { category, search } = req.query;
    let query = 'SELECT * FROM view_service_usage WHERE 1=1';
    const params: unknown[] = [];

    if (category) {
      params.push(category);
      query += ` AND category ILIKE $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      query += ` AND service_name ILIKE $${params.length}`;
    }

    query += ' ORDER BY total_revenue_generated DESC, total_orders DESC';

    const { rows } = await pool.query<ServiceUsageReport>(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Service Usage Report Error:', err);
    res.status(500).json({ error: 'Failed to fetch service usage report' });
  }
};

// 5. Top Services Report (Ranked by revenue or quantity)
export const getTopServicesReport = async (req: Request, res: Response) => {
  try {
    const { limit = '5', by = 'revenue' } = req.query;
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string, 10) || 5));

    // Sort either by revenue generated or quantity consumed
    const sortColumn = by === 'quantity' ? 'total_quantity_consumed' : 'total_revenue_generated';

    const query = `
      SELECT * 
      FROM view_service_usage 
      WHERE total_orders > 0
      ORDER BY ${sortColumn} DESC 
      LIMIT $1
    `;

    const { rows } = await pool.query<ServiceUsageReport>(query, [limitNum]);
    res.json(rows);
  } catch (err) {
    console.error('Top Services Report Error:', err);
    res.status(500).json({ error: 'Failed to fetch top services report' });
  }
};

// 6. Staff Audit Logs (paginated + filter by entity_name, action, or date)
export const getAuditLogsReport = async (req: Request, res: Response) => {
  try {
    const { entity_name, action, staff_id, limit = '25', page = '1' } = req.query;
    let query = 'SELECT * FROM view_staff_activity_audit WHERE 1=1';
    const params: unknown[] = [];

    if (entity_name) {
      params.push(entity_name);
      query += ` AND entity_name = $${params.length}`;
    }

    if (action) {
      params.push(action);
      query += ` AND action = $${params.length}`;
    }

    if (staff_id) {
      params.push(staff_id);
      query += ` AND staff_id = $${params.length}`;
    }

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 25));
    const offset = (pageNum - 1) * limitNum;

    query += ' ORDER BY changed_at DESC';

    params.push(limitNum);
    query += ` LIMIT $${params.length}`;

    params.push(offset);
    query += ` OFFSET $${params.length}`;

    const { rows } = await pool.query<AuditLogReport>(query, params);
    res.json({
      page: pageNum,
      limit: limitNum,
      count: rows.length,
      data: rows,
    });
  } catch (err) {
    console.error('Audit Log Report Error:', err);
    res.status(500).json({ error: 'Failed to fetch audit log report' });
  }
};
// --- Export Occupancy to CSV ---
export const exportOccupancyReportCsv = async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query<OccupancyReport>(
      'SELECT * FROM view_current_occupancy ORDER BY branch_name ASC'
    );
    sendCsvResponse(res, `occupancy-report-${Date.now()}.csv`, rows as unknown as Record<string, unknown>[]);
  } catch (err) {
    console.error('Export Occupancy Error:', err);
    res.status(500).json({ error: 'Failed to export occupancy report' });
  }
};

// --- Export Revenue to CSV ---
export const exportRevenueReportCsv = async (req: Request, res: Response) => {
  try {
    const { branch_id, year } = req.query;
    let query = 'SELECT * FROM view_monthly_branch_revenue WHERE 1=1';
    const params: unknown[] = [];

    if (branch_id) {
      params.push(branch_id);
      query += ` AND branch_id = $${params.length}`;
    }
    if (year) {
      params.push(year);
      query += ` AND EXTRACT(YEAR FROM revenue_month) = $${params.length}`;
    }
    query += ' ORDER BY revenue_month DESC, branch_name ASC';

    const { rows } = await pool.query<RevenueReport>(query, params);
    sendCsvResponse(res, `revenue-report-${Date.now()}.csv`, rows as unknown as Record<string, unknown>[]);
  } catch (err) {
    console.error('Export Revenue Error:', err);
    res.status(500).json({ error: 'Failed to export revenue report' });
  }
};

// --- Export Guest History to CSV ---
export const exportGuestHistoryReportCsv = async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query<GuestHistoryReport>(
      'SELECT * FROM view_guest_history ORDER BY lifetime_expenditure DESC'
    );
    sendCsvResponse(res, `guest-history-${Date.now()}.csv`, rows as unknown as Record<string, unknown>[]);
  } catch (err) {
    console.error('Export Guest History Error:', err);
    res.status(500).json({ error: 'Failed to export guest history' });
  }
};