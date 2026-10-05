import { Request, Response } from "express";
import { pool } from "../db";
import { sendCsvResponse } from "../utils/csvExport";
import {
  OccupancyReport,
  BillingSummaryReport,
  RevenueReport,
  GuestHistoryReport,
  ServiceUsageReport,
  AuditLogReport,
} from "../models/report.model";

// 1. OCCUPANCY REPORT
export const getOccupancyReport = async (req: Request, res: Response) => {
  try {
    const { branch_id } = req.query;
    let query = "SELECT * FROM view_current_occupancy WHERE 1=1";
    const params: unknown[] = [];

    if (branch_id) {
      params.push(branch_id);
      query += ` AND branch_id = $${params.length}`;
    }
    query += " ORDER BY branch_name ASC";

    const { rows } = await pool.query<OccupancyReport>(query, params);
    res.json(rows);
  } catch (err) {
    console.error("Occupancy Report Error:", err);
    res.status(500).json({ error: "Failed to fetch occupancy report" });
  }
};

// 2. BILLING REPORT
export const getBillingReport = async (req: Request, res: Response) => {
  try {
    const { branch_id, booking_ref, invoice_status, limit = "50", offset = "0" } = req.query;

    let query = `
      SELECT
        v.booking_id, v.booking_ref, v.full_name, v.invoice_number,
        v.total_amount, v.invoice_status, v.paid_amount, v.refunded_amount,
        v.net_paid, v.balance
      FROM v_report_billing_summary v
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (branch_id) {
      params.push(branch_id);
      query += ` AND EXISTS (SELECT 1 FROM booking b WHERE b.booking_id = v.booking_id AND b.branch_id = $${params.length})`;
    }
    if (booking_ref) {
      params.push(`%${booking_ref}%`);
      query += ` AND v.booking_ref ILIKE $${params.length}`;
    }
    if (invoice_status) {
      params.push(invoice_status);
      query += ` AND v.invoice_status = $${params.length}`;
    }

    query += " ORDER BY v.booking_ref ASC";
    params.push(Math.min(100, Math.max(1, Number(limit) || 50)));
    query += ` LIMIT $${params.length}`;
    params.push(Math.max(0, Number(offset) || 0));
    query += ` OFFSET $${params.length}`;

    const { rows } = await pool.query(query, params);
    const transformedRows: BillingSummaryReport[] = rows.map((row: any) => ({
      booking_id: row.booking_id,
      booking_ref: row.booking_ref,
      full_name: row.full_name,
      invoice_number: row.invoice_number,
      total_amount: Number(row.total_amount || 0),
      invoice_status: row.invoice_status,
      paid_amount: Number(row.paid_amount || 0),
      refunded_amount: Number(row.refunded_amount || 0),
      net_paid: Number(row.net_paid || 0),
      balance: Number(row.balance || 0),
    }));

    res.json(transformedRows);
  } catch (err) {
    console.error("Billing Report Error:", err);
    res.status(500).json({
      error: "Failed to fetch billing report",
      details: err instanceof Error ? err.message : String(err),
    });
  }
};

// 3. REVENUE REPORT
export const getRevenueReport = async (req: Request, res: Response) => {
  try {
    const { branch_id, year, start_date, end_date } = req.query;
    let query = "SELECT * FROM view_monthly_branch_revenue WHERE 1=1";
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
    query += " ORDER BY revenue_month DESC, branch_name ASC";

    const { rows } = await pool.query<RevenueReport>(query, params);
    res.json(rows);
  } catch (err) {
    console.error("Revenue Report Error:", err);
    res.status(500).json({ error: "Failed to fetch revenue report" });
  }
};

// 4. GUEST HISTORY REPORT
export const getGuestHistoryReport = async (req: Request, res: Response) => {
  try {
    const { search, min_stays, limit = "50", offset = "0" } = req.query;
    let query = "SELECT * FROM view_guest_history WHERE 1=1";
    const params: unknown[] = [];

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (full_name ILIKE $${params.length} OR email ILIKE $${params.length} OR phone ILIKE $${params.length})`;
    }
    if (min_stays) {
      params.push(Number(min_stays));
      query += ` AND total_stays >= $${params.length}`;
    }
    query += " ORDER BY lifetime_expenditure DESC, total_stays DESC";

    params.push(Number(limit));
    query += ` LIMIT $${params.length}`;
    params.push(Number(offset));
    query += ` OFFSET $${params.length}`;

    const { rows } = await pool.query<GuestHistoryReport>(query, params);
    res.json(rows);
  } catch (err) {
    console.error("Guest History Report Error:", err);
    res.status(500).json({ error: "Failed to fetch guest history report" });
  }
};

// 5. SERVICE USAGE REPORT
export const getServiceUsageReport = async (req: Request, res: Response) => {
  try {
    const { category, search } = req.query;
    let query = "SELECT * FROM view_service_usage WHERE 1=1";
    const params: unknown[] = [];

    if (category) {
      params.push(`%${category}%`);
      query += ` AND category ILIKE $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      query += ` AND service_name ILIKE $${params.length}`;
    }
    query += " ORDER BY total_revenue_generated DESC, total_orders DESC";

    const { rows } = await pool.query<ServiceUsageReport>(query, params);
    res.json(rows);
  } catch (err) {
    console.error("Service Usage Report Error:", err);
    res.status(500).json({ error: "Failed to fetch service usage report" });
  }
};

// 6. TOP SERVICES
export const getTopServicesReport = async (req: Request, res: Response) => {
  try {
    const { limit = "5", by = "revenue" } = req.query;
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string, 10) || 5));
    const sortColumn = by === "quantity" ? "total_quantity_consumed" : "total_revenue_generated";
    const query = `
      SELECT * FROM view_service_usage
      WHERE total_orders > 0
      ORDER BY ${sortColumn} DESC
      LIMIT $1
    `;

    const { rows } = await pool.query<ServiceUsageReport>(query, [limitNum]);
    res.json(rows);
  } catch (err) {
    console.error("Top Services Report Error:", err);
    res.status(500).json({ error: "Failed to fetch top services report" });
  }
};

// 7. AUDIT LOG REPORT
export const getAuditLogsReport = async (req: Request, res: Response) => {
  try {
    const { entity_name, action, staff_id, limit = "25", page = "1" } = req.query;
    let query = "SELECT * FROM view_staff_activity_audit WHERE 1=1";
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

    query += " ORDER BY changed_at DESC";
    params.push(limitNum);
    query += ` LIMIT $${params.length}`;
    params.push(offset);
    query += ` OFFSET $${params.length}`;

    const { rows } = await pool.query<AuditLogReport>(query, params);
    res.json({ page: pageNum, limit: limitNum, count: rows.length, data: rows });
  } catch (err) {
    console.error("Audit Log Report Error:", err);
    res.status(500).json({ error: "Failed to fetch audit log report" });
  }
};

// 8. GENERIC CSV EXPORT
export const exportReportCsv = async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const { branch_id, year, start_date, end_date, booking_ref, invoice_status, search, min_stays, category, entity_name, action, staff_id } = req.query;
    let query = "";
    let filename = "";
    const params: unknown[] = [];

    if (name === "occupancy") {
      query = "SELECT * FROM view_current_occupancy WHERE 1=1";
      if (branch_id) {
        params.push(branch_id);
        query += ` AND branch_id = $${params.length}`;
      }
      query += " ORDER BY branch_name ASC";
      filename = `occupancy-report-${Date.now()}.csv`;
    } else if (name === "billing") {
      query = `
        SELECT
          v.booking_id, v.booking_ref, v.full_name, v.invoice_number,
          v.total_amount, v.invoice_status, v.paid_amount, v.refunded_amount,
          v.net_paid, v.balance
        FROM v_report_billing_summary v
        WHERE 1=1
      `;
      if (branch_id) {
        params.push(branch_id);
        query += ` AND EXISTS (SELECT 1 FROM booking b WHERE b.booking_id = v.booking_id AND b.branch_id = $${params.length})`;
      }
      if (booking_ref) {
        params.push(`%${booking_ref}%`);
        query += ` AND v.booking_ref ILIKE $${params.length}`;
      }
      if (invoice_status) {
        params.push(invoice_status);
        query += ` AND v.invoice_status = $${params.length}`;
      }
      query += " ORDER BY v.booking_ref ASC";
      filename = `billing-report-${Date.now()}.csv`;
    } else if (name === "revenue") {
      query = "SELECT * FROM view_monthly_branch_revenue WHERE 1=1";
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
      query += " ORDER BY revenue_month DESC, branch_name ASC";
      filename = `revenue-report-${Date.now()}.csv`;
    } else if (name === "guest-history") {
      query = "SELECT * FROM view_guest_history WHERE 1=1";
      if (search) {
        params.push(`%${search}%`);
        query += ` AND (full_name ILIKE $${params.length} OR email ILIKE $${params.length} OR phone ILIKE $${params.length})`;
      }
      if (min_stays) {
        params.push(Number(min_stays));
        query += ` AND total_stays >= $${params.length}`;
      }
      query += " ORDER BY lifetime_expenditure DESC, total_stays DESC";
      filename = `guest-history-${Date.now()}.csv`;
    } else if (name === "service-usage") {
      query = "SELECT * FROM view_service_usage WHERE 1=1";
      if (category) {
        params.push(`%${category}%`);
        query += ` AND category ILIKE $${params.length}`;
      }
      if (search) {
        params.push(`%${search}%`);
        query += ` AND service_name ILIKE $${params.length}`;
      }
      query += " ORDER BY total_revenue_generated DESC, total_orders DESC";
      filename = `service-usage-${Date.now()}.csv`;
    } else if (name === "audit-logs") {
      query = "SELECT * FROM view_staff_activity_audit WHERE 1=1";
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
      query += " ORDER BY changed_at DESC LIMIT 1000";
      filename = `audit-logs-${Date.now()}.csv`;
    } else {
      res.status(404).json({ error: "Report not found" });
      return;
    }

    const { rows } = await pool.query(query, params);
    sendCsvResponse(res, filename, rows as unknown as Record<string, unknown>[]);
  } catch (err) {
    console.error("Export Report Error:", err);
    res.status(500).json({ error: "Failed to export report" });
  }
};

// 9. BACKWARD COMPATIBLE OCCUPANCY EXPORT
export const exportOccupancyReportCsv = async (req: Request, res: Response) => {
  try {
    const { branch_id } = req.query;
    let query = "SELECT * FROM view_current_occupancy WHERE 1=1";
    const params: unknown[] = [];

    if (branch_id) {
      params.push(branch_id);
      query += ` AND branch_id = $${params.length}`;
    }
    query += " ORDER BY branch_name ASC";

    const { rows } = await pool.query<OccupancyReport>(query, params);
    sendCsvResponse(res, `occupancy-report-${Date.now()}.csv`, rows as unknown as Record<string, unknown>[]);
  } catch (err) {
    console.error("Export Occupancy Error:", err);
    res.status(500).json({ error: "Failed to export occupancy report" });
  }
};

// 10. BACKWARD COMPATIBLE REVENUE EXPORT
export const exportRevenueReportCsv = async (req: Request, res: Response) => {
  try {
    const { branch_id, year, start_date, end_date } = req.query;
    let query = "SELECT * FROM view_monthly_branch_revenue WHERE 1=1";
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
    query += " ORDER BY revenue_month DESC, branch_name ASC";

    const { rows } = await pool.query<RevenueReport>(query, params);
    sendCsvResponse(res, `revenue-report-${Date.now()}.csv`, rows as unknown as Record<string, unknown>[]);
  } catch (err) {
    console.error("Export Revenue Error:", err);
    res.status(500).json({ error: "Failed to export revenue report" });
  }
};

// 11. BACKWARD COMPATIBLE GUEST HISTORY EXPORT
export const exportGuestHistoryReportCsv = async (req: Request, res: Response) => {
  try {
    const { search, min_stays } = req.query;
    let query = "SELECT * FROM view_guest_history WHERE 1=1";
    const params: unknown[] = [];

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (full_name ILIKE $${params.length} OR email ILIKE $${params.length} OR phone ILIKE $${params.length})`;
    }
    if (min_stays) {
      params.push(Number(min_stays));
      query += ` AND total_stays >= $${params.length}`;
    }
    query += " ORDER BY lifetime_expenditure DESC, total_stays DESC";

    const { rows } = await pool.query<GuestHistoryReport>(query, params);
    sendCsvResponse(res, `guest-history-${Date.now()}.csv`, rows as unknown as Record<string, unknown>[]);
  } catch (err) {
    console.error("Export Guest History Error:", err);
    res.status(500).json({ error: "Failed to export guest history" });
  }
};

// 12. SERVICE USAGE EXPORT
export const exportServiceUsageReportCsv = async (req: Request, res: Response) => {
  try {
    const { category, search } = req.query;
    let query = "SELECT * FROM view_service_usage WHERE 1=1";
    const params: unknown[] = [];

    if (category) {
      params.push(`%${category}%`);
      query += ` AND category ILIKE $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      query += ` AND service_name ILIKE $${params.length}`;
    }
    query += " ORDER BY total_revenue_generated DESC, total_orders DESC";

    const { rows } = await pool.query<ServiceUsageReport>(query, params);
    sendCsvResponse(res, `service-usage-${Date.now()}.csv`, rows as unknown as Record<string, unknown>[]);
  } catch (err) {
    console.error("Export Service Usage Error:", err);
    res.status(500).json({ error: "Failed to export service usage report" });
  }
};

// 13. AUDIT LOG EXPORT
export const exportAuditLogsReportCsv = async (req: Request, res: Response) => {
  try {
    const { entity_name, action, staff_id } = req.query;
    let query = "SELECT * FROM view_staff_activity_audit WHERE 1=1";
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
    query += " ORDER BY changed_at DESC LIMIT 1000";

    const { rows } = await pool.query<AuditLogReport>(query, params);
    sendCsvResponse(res, `audit-logs-${Date.now()}.csv`, rows as unknown as Record<string, unknown>[]);
  } catch (err) {
    console.error("Export Audit Logs Error:", err);
    res.status(500).json({ error: "Failed to export audit logs" });
  }
};