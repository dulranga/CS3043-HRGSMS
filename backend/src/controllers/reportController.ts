import { Request, Response } from 'express';
import { pool } from '../db';

// report occupancy

export const getOccupancyReport = async (_req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM view_current_occupancy');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch occupancy report' });
  }
};

//reports revenue
export const getRevenueReport = async (_req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM view_monthly_branch_revenue');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch revenue report' });
  }
};

// report guest history
export const getGuestHistoryReport = async (_req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM view_guest_history');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch guest history report' });
  }
};

// report service usage
export const getServiceUsageReport = async (_req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM view_service_usage');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch service usage report' });
  }
};

// report staff activity / audit logs
export const getAuditLogsReport = async (_req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM view_staff_activity_audit');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch audit log report' });
  }
};