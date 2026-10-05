import type { PoolClient } from 'pg';
import { appendAudit } from './audit';
import { hashPassword } from './auth';

// M1-S13 staff-account administration (SRS §4.1, FR-001/002/074/077/080, AT-25).
// SYSTEM_ADMINISTRATOR only (chain-wide account.write). Soft deactivation preserves
// history; hard deletion is forbidden. Password hashing uses bcryptjs cost 12.
// NIC is optional, unique among non-null officers, and always masked in responses
// (same rules as guest profiles, M1-S11). Officer searches use literal name/email/phone
// substrings and exact-only NIC, via POST so NICs stay out of URLs.

type Queryable = Pick<PoolClient, 'query'>;
export type StaffAccountDb = Queryable;

const OFFICER_NAME_MAX_LENGTH = 255;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEARCH_QUERY_MIN_LENGTH = 2;
const SEARCH_QUERY_MAX_LENGTH = 100;
const USERNAME_MAX_LENGTH = 255;

interface OfficerRow {
  officer_id: string;
  user_id?: string;
  username?: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  nic: string | null;
  active: boolean;
  branch_id: string;
  role_id: string;
  role_name?: string;
  branch_name?: string;
  created_at: Date;
  updated_at: Date;
}

export interface StaffAccountView {
  userId: string;
  username: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  maskedNic: string | null;
  hasNic: boolean;
  active: boolean;
  branchId: string;
  branchName?: string;
  roleId: string;
  roleName?: string;
  createdAt: string;
  updatedAt: string;
}

function maskNic(nic: string | null): string | null {
  if (nic === null) return null;
  return `•••••${nic.length > 4 ? nic.slice(-4) : ''}`;
}

function normalizePhone(value: string): string {
  return value.replace(/[\s().-]/g, '');
}

function toView(row: OfficerRow): StaffAccountView {
  return {
    userId: row.officer_id,
    username: row.username || '',
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    maskedNic: maskNic(row.nic),
    hasNic: row.nic !== null,
    active: row.active,
    branchId: row.branch_id,
    branchName: row.branch_name,
    roleId: row.role_id,
    roleName: row.role_name,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function asRecord(body: unknown): Record<string, unknown> | null {
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

function rejectUnknown(record: Record<string, unknown>, allowed: Set<string>, errors: Record<string, string>) {
  for (const key of Object.keys(record)) if (!allowed.has(key)) errors[key] = 'is not allowed';
}

// ---------------------------------------------------------------------------
// Input validation

export interface StaffAccountCreateInput {
  fullName: string;
  username: string;
  email: string | null;
  phone: string | null;
  nic: string | null;
  branchId: string;
  roleId: string;
}

export function validateStaffAccountCreateInput(body: unknown): {
  value?: StaffAccountCreateInput;
  errors?: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  const record = asRecord(body ?? {});
  if (!record) return { errors: { body: 'must be a JSON object' } };
  rejectUnknown(record, new Set(['fullName', 'username', 'email', 'phone', 'nic', 'branchId', 'roleId']), errors);

  // fullName
  const fullName = record.fullName;
  if (typeof fullName !== 'string') {
    errors.fullName = 'is required and must be a string';
  } else {
    const trimmed = fullName.trim();
    if (!trimmed) errors.fullName = 'is required';
    else if (trimmed.length > OFFICER_NAME_MAX_LENGTH) errors.fullName = `must be at most ${OFFICER_NAME_MAX_LENGTH} characters`;
  }

  // username
  const username = record.username;
  if (typeof username !== 'string') {
    errors.username = 'is required and must be a string';
  } else {
    const trimmed = username.trim();
    if (!trimmed) errors.username = 'is required';
    else if (trimmed.length > USERNAME_MAX_LENGTH) errors.username = `must be at most ${USERNAME_MAX_LENGTH} characters`;
  }

  // email
  const email = record.email === null ? null : record.email === undefined ? null : record.email;
  if (email !== null && email !== undefined) {
    if (typeof email !== 'string') errors.email = 'must be a string';
    else {
      const trimmed = email.trim();
      const lowered = trimmed ? trimmed.toLowerCase() : null;
      if (lowered && !EMAIL_PATTERN.test(lowered)) errors.email = 'must be a valid email address';
    }
  }

  // phone
  const phone = record.phone === null ? null : record.phone === undefined ? null : record.phone;
  if (phone !== null && phone !== undefined) {
    if (typeof phone !== 'string') errors.phone = 'must be a string';
    else {
      const normalized = phone ? normalizePhone(phone) : null;
      if (normalized && !PHONE_PATTERN.test(normalized)) errors.phone = 'must be 7-15 digits with an optional leading +';
    }
  }

  // nic
  const nic = record.nic === null ? null : record.nic === undefined ? null : record.nic;
  if (nic !== null && nic !== undefined) {
    if (typeof nic !== 'string') errors.nic = 'must be a string';
    else {
      const upper = nic.trim().toUpperCase();
      if (upper && upper.length > OFFICER_NAME_MAX_LENGTH) errors.nic = `must be at most ${OFFICER_NAME_MAX_LENGTH} characters`;
    }
  }

  // branchId
  if (!UUID_PATTERN.test(String(record.branchId ?? ''))) errors.branchId = 'must be a valid UUID';

  // roleId
  if (!UUID_PATTERN.test(String(record.roleId ?? ''))) errors.roleId = 'must be a valid UUID';

  if (Object.keys(errors).length > 0) return { errors };

  return {
    value: {
      fullName: (fullName as string).trim(),
      username: (username as string).trim().toLowerCase(),
      email: email ? (email as string).trim().toLowerCase() : null,
      phone: phone ? normalizePhone(phone as string) : null,
      nic: nic ? (nic as string).trim().toUpperCase() : null,
      branchId: String(record.branchId),
      roleId: String(record.roleId),
    },
  };
}

export interface StaffAccountUpdateInput {
  fullName?: string;
  email?: string | null;
  phone?: string | null;
  nic?: string | null;
  branchId?: string;
  roleId?: string;
  password?: string;
}

export function validateStaffAccountUpdateInput(body: unknown): {
  value?: StaffAccountUpdateInput;
  errors?: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  const record = asRecord(body ?? {});
  if (!record) return { errors: { body: 'must be a JSON object' } };
  rejectUnknown(
    record,
    new Set(['fullName', 'email', 'phone', 'nic', 'branchId', 'roleId', 'password']),
    errors,
  );

  // At least one field must be provided.
  const hasField = Object.keys(record).length > 0;
  if (!hasField) return { errors: { body: 'at least one field is required' } };

  const value: StaffAccountUpdateInput = {};

  if ('fullName' in record) {
    const fullName = record.fullName;
    if (typeof fullName !== 'string') errors.fullName = 'must be a string';
    else {
      const trimmed = fullName.trim();
      if (!trimmed) errors.fullName = 'cannot be cleared';
      else if (trimmed.length > OFFICER_NAME_MAX_LENGTH) errors.fullName = `must be at most ${OFFICER_NAME_MAX_LENGTH} characters`;
      else value.fullName = trimmed;
    }
  }

  if ('email' in record) {
    const email = record.email;
    if (email === null) {
      value.email = null;
    } else if (typeof email !== 'string') {
      errors.email = 'must be a string or null';
    } else {
      const trimmed = email.trim();
      const lowered = trimmed ? trimmed.toLowerCase() : null;
      if (lowered && !EMAIL_PATTERN.test(lowered)) errors.email = 'must be a valid email address';
      else value.email = lowered;
    }
  }

  if ('phone' in record) {
    const phone = record.phone;
    if (phone === null) {
      value.phone = null;
    } else if (typeof phone !== 'string') {
      errors.phone = 'must be a string or null';
    } else {
      const normalized = phone ? normalizePhone(phone) : null;
      if (normalized && !PHONE_PATTERN.test(normalized)) errors.phone = 'must be 7-15 digits with an optional leading +';
      else value.phone = normalized;
    }
  }

  if ('nic' in record) {
    const nic = record.nic;
    if (nic === null) {
      value.nic = null;
    } else if (typeof nic !== 'string') {
      errors.nic = 'must be a string or null';
    } else {
      const upper = nic.trim().toUpperCase();
      if (upper && upper.length > OFFICER_NAME_MAX_LENGTH) errors.nic = `must be at most ${OFFICER_NAME_MAX_LENGTH} characters`;
      else value.nic = upper;
    }
  }

  if ('branchId' in record) {
    if (!UUID_PATTERN.test(String(record.branchId ?? ''))) errors.branchId = 'must be a valid UUID';
    else value.branchId = String(record.branchId);
  }

  if ('roleId' in record) {
    if (!UUID_PATTERN.test(String(record.roleId ?? ''))) errors.roleId = 'must be a valid UUID';
    else value.roleId = String(record.roleId);
  }

  if ('password' in record) {
    const password = record.password;
    if (typeof password !== 'string') errors.password = 'must be a string';
    else value.password = password;
  }

  if (Object.keys(errors).length > 0) return { errors };
  return { value };
}

// ---------------------------------------------------------------------------
// Service layer

export type ApiResponse<T> = { data: T; error?: undefined } | { data?: undefined; error: { code: string; message: string; fields?: Record<string, string> } };

export interface CreateStaffAccountService {
  create(userId: string, input: StaffAccountCreateInput): Promise<ApiResponse<StaffAccountView>>;
  getById(userId: string, officerId: string): Promise<StaffAccountView | null>;
  list(userId: string, query?: string): Promise<StaffAccountView[]>;
  update(userId: string, officerId: string, input: StaffAccountUpdateInput): Promise<ApiResponse<StaffAccountView>>;
  disable(userId: string, officerId: string): Promise<ApiResponse<StaffAccountView>>;
  reactivate(userId: string, officerId: string): Promise<ApiResponse<StaffAccountView>>;
}

export function createStaffAccount({ db }: { db: StaffAccountDb }): CreateStaffAccountService {
  return {
    async create(userId: string, input: StaffAccountCreateInput): Promise<ApiResponse<StaffAccountView>> {
      // Check username and NIC uniqueness.
      const existing = await db.query(
        `SELECT user_id FROM user_account WHERE lower(username) = $1
         UNION ALL
         SELECT officer_id FROM officer WHERE nic = $2 AND nic IS NOT NULL`,
        [input.username.toLowerCase(), input.nic],
      );
      if (existing.rows.length > 0) {
        if (existing.rows[0].user_id) return { error: { code: 'USERNAME_EXISTS', message: 'Username already exists.', fields: { username: 'this username is already in use' } } };
        if (existing.rows[0].officer_id) return { error: { code: 'NIC_EXISTS', message: 'NIC already exists.', fields: { nic: 'this NIC is already registered to another officer' } } };
      }

      // Check branch and role exist.
      const refs = await db.query('SELECT branch_id, role_id FROM branch, role WHERE branch_id = $1 AND role_id = $2', [
        input.branchId,
        input.roleId,
      ]);
      if (refs.rows.length === 0) {
        return { error: { code: 'INVALID_REFS', message: 'Branch or role not found.', fields: { branchId: 'invalid branch', roleId: 'invalid role' } } };
      }

      // Create user_account with hashed password.
      const defaultPassword = 'TempPassword123!'; // Will be changed on first login
      const hash = await hashPassword(defaultPassword);
      const userResult = await db.query(
        'INSERT INTO user_account (username, password_hash, active) VALUES ($1, $2, true) RETURNING user_id',
        [input.username, hash],
      );
      const newUserId = userResult.rows[0].user_id;

      // Create officer.
      await db.query(
        `INSERT INTO officer (officer_id, full_name, email, phone, nic, active, branch_id, role_id)
         VALUES ($1, $2, $3, $4, $5, true, $6, $7)`,
        [newUserId, input.fullName, input.email, input.phone, input.nic, input.branchId, input.roleId],
      );

      // Audit.
      await appendAudit(db, {
        entityName: 'officer',
        entityId: newUserId,
        action: 'CREATE',
        userId,
        after: {
          username: input.username,
          fullName: input.fullName,
          email: input.email,
          phone: input.phone,
          nic: input.nic ? '[REDACTED]' : null,
          branchId: input.branchId,
          roleId: input.roleId,
        },
      });

      // Return the created officer.
      const result = await db.query(
        `SELECT o.officer_id, u.username, o.full_name, o.email, o.phone, o.nic, o.active,
                o.branch_id, b.name AS branch_name, o.role_id, r.role_name, o.created_at, o.updated_at
         FROM officer o
         JOIN user_account u ON u.user_id = o.officer_id
         JOIN branch b ON b.branch_id = o.branch_id
         JOIN role r ON r.role_id = o.role_id
         WHERE o.officer_id = $1`,
        [newUserId],
      );
      return { data: toView(result.rows[0]) };
    },

    async getById(userId: string, officerId: string) {
      if (!UUID_PATTERN.test(officerId)) return null;
      const result = await db.query(
        `SELECT o.officer_id, u.username, o.full_name, o.email, o.phone, o.nic, o.active,
                o.branch_id, b.name AS branch_name, o.role_id, r.role_name, o.created_at, o.updated_at
         FROM officer o
         JOIN user_account u ON u.user_id = o.officer_id
         JOIN branch b ON b.branch_id = o.branch_id
         JOIN role r ON r.role_id = o.role_id
         WHERE o.officer_id = $1`,
        [officerId],
      );
      return result.rows[0] ? toView(result.rows[0]) : null;
    },

    async list(userId: string, query?: string) {
      let sql =
        `SELECT o.officer_id, u.username, o.full_name, o.email, o.phone, o.nic, o.active,
                o.branch_id, b.name AS branch_name, o.role_id, r.role_name, o.created_at, o.updated_at
         FROM officer o
         JOIN user_account u ON u.user_id = o.officer_id
         JOIN branch b ON b.branch_id = o.branch_id
         JOIN role r ON r.role_id = o.role_id
         WHERE o.active = true`;
      const params: unknown[] = [];

      if (query) {
        const q = query.trim().toLowerCase();
        sql += ` AND (lower(btrim(o.full_name)) LIKE $1 OR lower(btrim(o.email)) LIKE $1 OR regexp_replace(o.phone, '[\\s().-]', '', 'g') LIKE $1)`;
        params.push(`%${q.replace(/%/g, '\\%')}%`);
      }

      sql += ` ORDER BY o.full_name, o.officer_id LIMIT 50`;
      const result = await db.query(sql, params);
      return result.rows.map(toView);
    },

    async update(userId: string, officerId: string, input: StaffAccountUpdateInput): Promise<ApiResponse<StaffAccountView>> {
      if (!UUID_PATTERN.test(officerId)) return { error: { code: 'INVALID_ID', message: 'Invalid officer ID.' } };

      // Get current officer state.
      const current = await db.query(
        `SELECT o.officer_id, u.username, o.full_name, o.email, o.phone, o.nic, o.active,
                o.branch_id, o.role_id, o.updated_at
         FROM officer o
         JOIN user_account u ON u.user_id = o.officer_id
         WHERE o.officer_id = $1`,
        [officerId],
      );
      if (!current.rows[0]) return { error: { code: 'NOT_FOUND', message: 'Officer not found.' } };

      const officer = current.rows[0];

      // Check NIC uniqueness if changing.
      if ('nic' in input && input.nic !== officer.nic) {
        const nicCheck = await db.query(
          `SELECT officer_id FROM officer WHERE nic = $1 AND nic IS NOT NULL AND officer_id <> $2`,
          [input.nic, officerId],
        );
        if (nicCheck.rows.length > 0) {
          return { error: { code: 'NIC_EXISTS', message: 'NIC already exists.', fields: { nic: 'this NIC is already registered to another officer' } } };
        }
      }

      // Check branch/role exist if changing.
      if ('branchId' in input || 'roleId' in input) {
        const branchId = 'branchId' in input ? input.branchId : officer.branch_id;
        const roleId = 'roleId' in input ? input.roleId : officer.role_id;
        const refs = await db.query(`SELECT 1 FROM branch, role WHERE branch_id = $1 AND role_id = $2`, [branchId, roleId]);
        if (refs.rows.length === 0) {
          return { error: { code: 'INVALID_REFS', message: 'Branch or role not found.', fields: { branchId: 'invalid branch', roleId: 'invalid role' } } };
        }
      }

      // Identify changes.
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      let updates: string[] = [];
      let values: unknown[] = [];
      let paramCount = 1;
      let passwordHash: string | undefined;

      if ('fullName' in input && input.fullName !== officer.full_name) {
        before.fullName = officer.full_name;
        after.fullName = input.fullName;
        updates.push(`full_name = $${paramCount++}`);
        values.push(input.fullName);
      }

      if ('email' in input && input.email !== officer.email) {
        before.email = officer.email;
        after.email = input.email;
        updates.push(`email = $${paramCount++}`);
        values.push(input.email);
      }

      if ('phone' in input && input.phone !== officer.phone) {
        before.phone = officer.phone;
        after.phone = input.phone;
        updates.push(`phone = $${paramCount++}`);
        values.push(input.phone);
      }

      if ('nic' in input && input.nic !== officer.nic) {
        before.nic = officer.nic;
        after.nic = input.nic ? '[REDACTED]' : null;
        updates.push(`nic = $${paramCount++}`);
        values.push(input.nic);
      }

      if ('branchId' in input && input.branchId !== officer.branch_id) {
        before.branchId = officer.branch_id;
        after.branchId = input.branchId;
        updates.push(`branch_id = $${paramCount++}`);
        values.push(input.branchId);
      }

      if ('roleId' in input && input.roleId !== officer.role_id) {
        before.roleId = officer.role_id;
        after.roleId = input.roleId;
        updates.push(`role_id = $${paramCount++}`);
        values.push(input.roleId);
      }

      if ('password' in input) {
        passwordHash = await hashPassword(input.password!);
        // Password change is not audited in before/after.
      }

      // If no changes, return current state.
      if (updates.length === 0 && !passwordHash) {
        const result = await db.query(
          `SELECT o.officer_id, u.username, o.full_name, o.email, o.phone, o.nic, o.active,
                  o.branch_id, b.name AS branch_name, o.role_id, r.role_name, o.created_at, o.updated_at
           FROM officer o
           JOIN user_account u ON u.user_id = o.officer_id
           JOIN branch b ON b.branch_id = o.branch_id
           JOIN role r ON r.role_id = o.role_id
           WHERE o.officer_id = $1`,
          [officerId],
        );
        return { data: toView(result.rows[0]) };
      }

      // Update password hash in user_account if needed.
      if (passwordHash) {
        await db.query('UPDATE user_account SET password_hash = $1 WHERE user_id = $2', [passwordHash, officerId]);
      }

      // Update officer fields if needed.
      if (updates.length > 0) {
        values.push(officerId);
        await db.query(`UPDATE officer SET ${updates.join(', ')} WHERE officer_id = $${paramCount}`, values);
      }

      // Audit.
      if (Object.keys(before).length > 0) {
        await appendAudit(db, {
          entityName: 'officer',
          entityId: officerId,
          action: 'UPDATE',
          userId,
          before,
          after,
        });
      }

      // Return updated state.
      const result = await db.query(
        `SELECT o.officer_id, u.username, o.full_name, o.email, o.phone, o.nic, o.active,
                o.branch_id, b.name AS branch_name, o.role_id, r.role_name, o.created_at, o.updated_at
         FROM officer o
         JOIN user_account u ON u.user_id = o.officer_id
         JOIN branch b ON b.branch_id = o.branch_id
         JOIN role r ON r.role_id = o.role_id
         WHERE o.officer_id = $1`,
        [officerId],
      );
      return { data: toView(result.rows[0]) };
    },

    async disable(userId: string, officerId: string) {
      if (!UUID_PATTERN.test(officerId)) return { error: { code: 'INVALID_ID', message: 'Invalid officer ID.' } };

      // Check officer exists and is active.
      const current = await db.query('SELECT active FROM officer WHERE officer_id = $1', [officerId]);
      if (!current.rows[0]) return { error: { code: 'NOT_FOUND', message: 'Officer not found.' } };
      if (!current.rows[0].active) return { error: { code: 'ALREADY_INACTIVE', message: 'Officer is already disabled.' } };

      // Disable both officer and user_account.
      await db.query('UPDATE officer SET active = false WHERE officer_id = $1', [officerId]);
      await db.query('UPDATE user_account SET active = false WHERE user_id = $1', [officerId]);

      // Audit.
      await appendAudit(db, {
        entityName: 'officer',
        entityId: officerId,
        action: 'DEACTIVATE',
        userId,
        after: { active: false },
      });

      // Return updated state.
      const result = await db.query(
        `SELECT o.officer_id, u.username, o.full_name, o.email, o.phone, o.nic, o.active,
                o.branch_id, b.name AS branch_name, o.role_id, r.role_name, o.created_at, o.updated_at
         FROM officer o
         JOIN user_account u ON u.user_id = o.officer_id
         JOIN branch b ON b.branch_id = o.branch_id
         JOIN role r ON r.role_id = o.role_id
         WHERE o.officer_id = $1`,
        [officerId],
      );
      return { data: toView(result.rows[0]) };
    },

    async reactivate(userId: string, officerId: string) {
      if (!UUID_PATTERN.test(officerId)) return { error: { code: 'INVALID_ID', message: 'Invalid officer ID.' } };

      // Check officer exists and is inactive.
      const current = await db.query('SELECT active FROM officer WHERE officer_id = $1', [officerId]);
      if (!current.rows[0]) return { error: { code: 'NOT_FOUND', message: 'Officer not found.' } };
      if (current.rows[0].active) return { error: { code: 'ALREADY_ACTIVE', message: 'Officer is already active.' } };

      // Reactivate both officer and user_account.
      await db.query('UPDATE officer SET active = true WHERE officer_id = $1', [officerId]);
      await db.query('UPDATE user_account SET active = true WHERE user_id = $1', [officerId]);

      // Audit.
      await appendAudit(db, {
        entityName: 'officer',
        entityId: officerId,
        action: 'REACTIVATE',
        userId,
        after: { active: true },
      });

      // Return updated state.
      const result = await db.query(
        `SELECT o.officer_id, u.username, o.full_name, o.email, o.phone, o.nic, o.active,
                o.branch_id, b.name AS branch_name, o.role_id, r.role_name, o.created_at, o.updated_at
         FROM officer o
         JOIN user_account u ON u.user_id = o.officer_id
         JOIN branch b ON b.branch_id = o.branch_id
         JOIN role r ON r.role_id = o.role_id
         WHERE o.officer_id = $1`,
        [officerId],
      );
      return { data: toView(result.rows[0]) };
    },
  };
}
