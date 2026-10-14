import { Request, Response } from 'express';
import { pool } from '../db';
import { createBranches } from '../branches';
import { createStaffAccounts } from '../staffAccounts';
import { setSystemConfig, SystemConfigValidationError } from '../systemConfig';
import {
  BILLING_POLICY_TIME_ZONE,
  BillingPolicyValidationError,
  findEffectiveBillingPolicy,
  isProductionEnvironment,
  publishBillingPolicy,
} from '../billingPolicy';

import {
  Branch,
  SafeUserAccount,
  AuditLog,
  SystemConfig,
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

// Compatibility endpoints reuse the audited owner services and their guards.
const branchService = createBranches({ db: pool });
const staffService = createStaffAccounts({ db: pool });
export const createBranch = branchService.create;
export const updateBranch = async (req: Request, res: Response) => {
  req.params.branchId = req.params.id;
  if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'active')) {
    if (typeof req.body.active !== 'boolean' || Object.keys(req.body).some(key => key !== 'active' && key !== 'reason')) {
      res.status(400).json({ error: 'Change branch status separately from its details.' });
      return;
    }
    const active = req.body.active;
    req.body = req.body.reason === undefined ? {} : { reason: req.body.reason };
    await (active ? branchService.reactivate : branchService.deactivate)(req, res);
    return;
  }
  await branchService.update(req, res);
};

// 2. USER ACCOUNT CONTROLLERs

// Get all user accounts (excluding password_hash)
export const getAllUsers = async (req: Request, res: Response) => {
  try {
    const { active, search } = req.query;
    let query = `
      SELECT u.user_id, u.username, u.active, u.created_at, u.updated_at, u.last_login_at
      FROM user_account u JOIN officer o ON o.officer_id = u.user_id
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (active !== undefined) {
      params.push(active === 'true');
      query += ` AND u.active = $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      query += ` AND u.username ILIKE $${params.length}`;
    }

    query += ' ORDER BY u.created_at DESC';

    const { rows } = await pool.query<SafeUserAccount>(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Get Users Error:', err);
    res.status(500).json({ error: 'Failed to fetch user accounts' });
  }
};

export const updateUserStatus = async (req: Request, res: Response) => {
  if (typeof req.body?.active !== 'boolean' || Object.keys(req.body).some(key => key !== 'active')) {
    res.status(400).json({ error: 'Active boolean flag is required; other fields are not accepted.' });
    return;
  }
  const active = req.body.active;
  req.params.userId = req.params.id;
  req.body = {};
  await (active ? staffService.reactivate : staffService.disable)(req, res);
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

    if (entity_name !== undefined && typeof entity_name !== 'string') {
      res.status(400).json({ error: 'Entity filter must be a single text value.' });
      return;
    }
    if (typeof entity_name === 'string' && entity_name.trim()) {
      // Treat input as literal text, including underscores in table names.
      const entity = entity_name.trim().replace(/[\\%_]/g, '\\$&');
      params.push(`%${entity}%`);
      query += ` AND a.entity_name ILIKE $${params.length}`;
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

    query += ' ORDER BY a.changed_at DESC, a.audit_id DESC';

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

// Read registered, non-financial current-value settings.
export const getAllConfigs = async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query<SystemConfig>(
      `SELECT registered.config_key, current.config_value, current.effective_from, current.updated_by, current.updated_at
       FROM system_config_key_registry() registered
       LEFT JOIN system_config current ON current.config_key = registered.config_key
       ORDER BY registered.config_key`
    );
    res.json(rows);
  } catch (err) {
    console.error('Get Config Error:', err);
    res.status(500).json({ error: 'Failed to fetch system configurations' });
  }
};

// Read-only view of the billing policy version that new confirmations would use now.
export const getCurrentBillingPolicy = async (_req: Request, res: Response) => {
  try {
    const policy = await findEffectiveBillingPolicy(pool, { production: isProductionEnvironment() });
    res.json({ data: policy });
  } catch (err) {
    console.error('Get Billing Policy Error:', err);
    res.status(500).json({ error: 'Failed to fetch the billing policy' });
  }
};

const POLICY_FIELDS = [
  'taxPercent',
  'serviceChargePercent',
  'maxDiscountPercent',
  'cancellationFee',
  'noShowFee',
  'lateCheckoutFee',
  'noShowGraceDays',
] as const;

// "Updating" the policy publishes a new immutable version effective today
// (Asia/Colombo); bookings already confirmed keep their linked version.
export const publishCurrentBillingPolicy = async (req: Request, res: Response) => {
  const body = req.body ?? {};
  if (!req.user || typeof body !== 'object' || Object.keys(body).some((key) => !(POLICY_FIELDS as readonly string[]).includes(key))) {
    res.status(400).json({ error: `Provide only ${POLICY_FIELDS.join(', ')}; the effective date and publisher are server controlled.` });
    return;
  }
  const effectiveFrom = new Intl.DateTimeFormat('en-CA', { timeZone: BILLING_POLICY_TIME_ZONE }).format(new Date());
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const policy = await publishBillingPolicy(
      client,
      {
        effectiveFrom,
        taxPercent: body.taxPercent,
        serviceChargePercent: body.serviceChargePercent,
        maxDiscountPercent: body.maxDiscountPercent,
        cancellationFee: body.cancellationFee,
        noShowFee: body.noShowFee,
        lateCheckoutFee: body.lateCheckoutFee,
        noShowGraceDays: body.noShowGraceDays,
        isDemo: false,
      },
      req.user.userId,
      { production: isProductionEnvironment() },
    );
    await client.query('COMMIT');
    res.status(201).json({ data: policy });
  } catch (error) {
    await client?.query('ROLLBACK').catch(() => undefined);
    if (error instanceof BillingPolicyValidationError) {
      res.status(400).json({ error: 'Invalid billing policy.', fieldErrors: error.fieldErrors });
    } else {
      const code = (error as { code?: string }).code;
      if (code !== '42501' && code !== '23514') console.error('Publish Billing Policy Error:', error);
      res.status(code === '42501' ? 403 : code === '23514' ? 400 : 500).json({ error: 'Unable to publish the billing policy.' });
    }
  } finally {
    client?.release();
  }
};

// Financial rates are immutable billing_policy versions, not system_config.
export const updateConfig = async (req: Request, res: Response) => {
  if (!req.user || typeof req.body?.config_value !== 'string' || Object.keys(req.body).some(key => key !== 'config_value')) {
    res.status(400).json({ error: 'Provide config_value only; actor and activation date are server controlled.' });
    return;
  }
  const key = Array.isArray(req.params.key) ? req.params.key[0] : req.params.key;
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const entry = await setSystemConfig(client, key, req.body.config_value, req.user.userId);
    await client.query('COMMIT');
    res.json({ config_key: entry.configKey, config_value: entry.configValue, effective_from: entry.effectiveFrom, updated_by: entry.updatedBy, updated_at: entry.updatedAt });
  } catch (error) {
    await client?.query('ROLLBACK').catch(() => undefined);
    if (error instanceof SystemConfigValidationError) {
      res.status(400).json({ error: 'Invalid configuration.', fieldErrors: error.fieldErrors });
    } else {
      const code = (error as { code?: string }).code;
      res.status(code === '42501' ? 403 : code === '23514' || code === '23503' ? 400 : 500).json({ error: 'Unable to update this registered non-financial setting.' });
    }
  } finally {
    client?.release();
  }
};
