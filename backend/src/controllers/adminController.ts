import { Request, Response } from 'express';
import { pool as db } from '../db';


export const getSystemConfig = async (req: Request, res: Response) => {
  try {
    const result = await db.query('SELECT * FROM system_config');
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};


export const updateSystemConfig = async (req: Request, res: Response) => {
  const { key, value, userId } = req.body;
  try {
    await db.query(
      'UPDATE system_config SET config_value = $1, updated_at = NOW() WHERE config_key = $2',
      [value, key]
    );

    await db.query(
      `INSERT INTO audit_log (entity_name, entity_id, action, after_value, user_id)
       VALUES ('system_config', $1, 'UPDATE', $2, $3)`,
      [key, value, userId || null]
    );

    res.json({ message: 'Config updated and logged' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};


export const getAuditLogs = async (req: Request, res: Response) => {
  try {
    const result = await db.query('SELECT * FROM audit_log ORDER BY changed_at DESC LIMIT 50');
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};