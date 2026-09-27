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