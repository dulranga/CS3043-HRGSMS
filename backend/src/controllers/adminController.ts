import { Request, Response } from 'express';
import { pool } from '../db';

import {
  Branch,
  CreateBranchDTO,
  UpdateBranchDTO,
  SafeUserAccount,
  UpdateUserStatusDTO,
  AuditLog,
  SystemConfig,
  UpdateConfigDTO,
} from '../models/admin.model';

// 1. BRANCH CONTROLLERs

// Get all branches (optional filter by active status or search by name/city)
export const getAllBranches = async (req: Request, res: Response) => {
  try {
    const { active, search } = req.query;
    let query = 'SELECT branch_id, name, city, address, active, created_at, updated_at FROM branch WHERE 1=1';
    const params: unknown[] = [];

    if (active !== undefined) {
      params.push(active === 'true');
      query += ` AND active = $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (name ILIKE $${params.length} OR city ILIKE $${params.length})`;
    }

    query += ' ORDER BY name ASC';

    const { rows } = await pool.query<Branch>(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Get Branches Error:', err);
    res.status(500).json({ error: 'Failed to fetch branches' });
  }
};

// Create new branch
export const createBranch = async (req: Request, res: Response) => {
  try {
    const { name, city, address, active = true }: CreateBranchDTO = req.body;

    if (!name || !city) {
      return res.status(400).json({ error: 'Branch name and city are required' });
    }

    const query = `
      INSERT INTO branch (name, city, address, active)
      VALUES ($1, $2, $3, $4)
      RETURNING branch_id, name, city, address, active, created_at, updated_at
    `;

    const { rows } = await pool.query<Branch>(query, [name, city, address || null, active]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Create Branch Error:', err);
    res.status(500).json({ error: 'Failed to create branch' });
  }
};

// Update branch details or toggle active status
export const updateBranch = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, city, address, active }: UpdateBranchDTO = req.body;

    const query = `
      UPDATE branch
      SET
        name = COALESCE($1, name),
        city = COALESCE($2, city),
        address = COALESCE($3, address),
        active = COALESCE($4, active),
        updated_at = NOW()
      WHERE branch_id = $5
      RETURNING branch_id, name, city, address, active, created_at, updated_at
    `;

    const { rows } = await pool.query<Branch>(query, [name, city, address, active, id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Branch not found' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('Update Branch Error:', err);
    res.status(500).json({ error: 'Failed to update branch' });
  }
};

// 2. USER ACCOUNT CONTROLLERs

// Get all user accounts (excluding password_hash)
export const getAllUsers = async (req: Request, res: Response) => {
  try {
    const { active, search } = req.query;
    let query = `
      SELECT user_id, username, active, created_at, updated_at, last_login_at
      FROM user_account
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (active !== undefined) {
      params.push(active === 'true');
      query += ` AND active = $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      query += ` AND username ILIKE $${params.length}`;
    }

    query += ' ORDER BY created_at DESC';

    const { rows } = await pool.query<SafeUserAccount>(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Get Users Error:', err);
    res.status(500).json({ error: 'Failed to fetch user accounts' });
  }
};

// Toggle active status or update user account
export const updateUserStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { active }: UpdateUserStatusDTO = req.body;

    if (typeof active !== 'boolean') {
      return res.status(400).json({ error: 'Active boolean flag is required' });
    }

    const query = `
      UPDATE user_account
      SET active = $1, updated_at = NOW()
      WHERE user_id = $2
      RETURNING user_id, username, active, created_at, updated_at, last_login_at
    `;

    const { rows } = await pool.query<SafeUserAccount>(query, [active, id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'User account not found' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('Update User Status Error:', err);
    res.status(500).json({ error: 'Failed to update user status' });
  }
};


// 3. AUDIT REVIEW CONTROLLERS

// Paginated audit log retrieval with entity, action, date, and user filters
export const getAuditLogs = async (req: Request, res: Response) => {
  try {
    const {
      entity_name,
      action,
      user_id,
      start_date,
      end_date,
      limit = '25',
      page = '1',
    } = req.query;

    let query = `
      SELECT 
        a.audit_id,
        a.user_id,
        u.username,
        a.entity_name,
        a.entity_id,
        a.action,
        a.before_value,
        a.after_value,
        a.changed_at,
        a.ip_address
      FROM audit_log a
      LEFT JOIN user_account u ON a.user_id = u.user_id
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (entity_name) {
      params.push(entity_name);
      query += ` AND a.entity_name = $${params.length}`;
    }

    if (action) {
      params.push(action);
      query += ` AND a.action = $${params.length}`;
    }

    if (user_id) {
      params.push(user_id);
      query += ` AND a.user_id = $${params.length}`;
    }

    if (start_date) {
      params.push(start_date);
      query += ` AND a.changed_at >= $${params.length}::timestamptz`;
    }

    if (end_date) {
      params.push(end_date);
      query += ` AND a.changed_at <= $${params.length}::timestamptz`;
    }

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 25));
    const offset = (pageNum - 1) * limitNum;

    query += ' ORDER BY a.changed_at DESC';

    params.push(limitNum);
    query += ` LIMIT $${params.length}`;

    params.push(offset);
    query += ` OFFSET $${params.length}`;

    const { rows } = await pool.query<AuditLog>(query, params);

    res.json({
      page: pageNum,
      limit: limitNum,
      count: rows.length,
      data: rows,
    });
  } catch (err) {
    console.error('Get Audit Logs Error:', err);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
};


// 4. SYSTEM POLICY & CONFIG CONTROLLERS

// Get all system policies (tax_rate, cancellation_fee, etc.)
export const getAllConfigs = async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query<SystemConfig>(
      'SELECT config_key, config_value, effective_from, updated_by, updated_at FROM system_config ORDER BY config_key ASC'
    );
    res.json(rows);
  } catch (err) {
    console.error('Get Config Error:', err);
    res.status(500).json({ error: 'Failed to fetch system configurations' });
  }
};

// Update a specific policy rate or setting
export const updateConfig = async (req: Request, res: Response) => {
  try {
    const { key } = req.params;
    const { config_value, effective_from, updated_by }: UpdateConfigDTO = req.body;

    if (config_value === undefined || config_value === null) {
      return res.status(400).json({ error: 'config_value is required' });
    }

    const query = `
      UPDATE system_config
      SET
        config_value = $1,
        effective_from = COALESCE($2::date, CURRENT_DATE),
        updated_by = $3,
        updated_at = NOW()
      WHERE config_key = $4
      RETURNING config_key, config_value, effective_from, updated_by, updated_at
    `;

    const { rows } = await pool.query<SystemConfig>(query, [
      config_value,
      effective_from || null,
      updated_by || null,
      key,
    ]);

    if (rows.length === 0) {
      return res.status(404).json({ error: `Config key '${key}' not found` });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('Update Config Error:', err);
    res.status(500).json({ error: 'Failed to update system configuration' });
  }
};