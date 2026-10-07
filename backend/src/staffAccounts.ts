import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import type { Pool, PoolClient } from 'pg';
import { appendAudit } from './audit';
import { PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH, hashPassword } from './auth';

// M1-S13 staff-account administration (SRS §4.10, FR-001/002/074/077/080,
// AT-25). Writes are SYSTEM_ADMINISTRATOR-only (account.write) and reads are
// SYSTEM_ADMINISTRATOR/AUDITOR (account.read), both chain-wide. Deactivation
// is a soft flag on both officer and user_account: no row is ever deleted, so
// every historical action keeps its actor (FR-074, TBD-11), and auth re-reads
// both flags per request, so a disabled officer's session dies immediately.
// NIC is optional, unique among non-null officers and always masked to its
// last four characters in responses; appendAudit redacts NIC and password
// values in audit evidence. Search mirrors M1-S11: a POST body keeps NICs out
// of URLs, text matches name/email/phone-digit substrings literally (AT-10)
// and a NIC matches exactly only, so officers cannot be enumerated by partial
// NIC. An administrator cannot disable their own account.

type Queryable = Pick<PoolClient, 'query'>;
export type StaffAccountDb = Queryable & Pick<Pool, 'connect'>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;
const NAME_MAX_LENGTH = 255;
const USERNAME_MAX_LENGTH = 255;
const SEARCH_QUERY_MIN_LENGTH = 2;
const SEARCH_QUERY_MAX_LENGTH = 100;
export const OFFICER_SEARCH_DEFAULT_LIMIT = 20;
export const OFFICER_SEARCH_MAX_LIMIT = 50;

// Key name avoids the word "password": appendAudit redacts any key containing
// it, which would turn this flag into noise.
const CREATE_KEYS = new Set(['fullName', 'username', 'email', 'phone', 'nic', 'branchId', 'roleId', 'password']);
const UPDATE_KEYS = new Set(['fullName', 'email', 'phone', 'nic', 'branchId', 'roleId', 'password']);
const SEARCH_KEYS = new Set(['query', 'nic', 'includeInactive', 'limit']);

interface OfficerRow {
  officer_id: string;
  username: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  nic: string | null;
  active: boolean;
  branch_id: string;
  branch_name: string;
  role_id: string;
  role_name: string;
  created_at: Date;
  updated_at: Date;
}

const OFFICER_COLUMNS = `o.officer_id, u.username, o.full_name, o.email, o.phone, o.nic, o.active,
       o.branch_id, b.name AS branch_name, o.role_id, r.role_name, o.created_at, o.updated_at`;
const OFFICER_FROM = `FROM officer o
       JOIN user_account u ON u.user_id = o.officer_id
       JOIN branch b ON b.branch_id = o.branch_id
       JOIN role r ON r.role_id = o.role_id`;

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
  branchName: string;
  roleId: string;
  roleName: string;
  createdAt: string;
  updatedAt: string;
}

// Only present in the create response when the administrator did not supply a
// password; never stored and never audited.
export type StaffAccountCreatedView = StaffAccountView & { temporaryPassword?: string };

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
    username: row.username,
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

// Escapes LIKE metacharacters so user text is matched literally (AT-10).
function likeContains(value: string): string {
  return `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function passwordError(value: unknown): string | null {
  if (typeof value !== 'string') return 'must be a string';
  if (value.length < PASSWORD_MIN_LENGTH) return `must be at least ${PASSWORD_MIN_LENGTH} characters`;
  if (Buffer.byteLength(value, 'utf8') > PASSWORD_MAX_BYTES) return `must be at most ${PASSWORD_MAX_BYTES} bytes`;
  return null;
}

// ---------------------------------------------------------------------------
// Input validation

export interface OfficerSearchInput {
  query: string | null;
  nic: string | null;
  includeInactive: boolean;
  limit: number;
}

export function validateOfficerSearchInput(body: unknown): {
  value?: OfficerSearchInput;
  errors?: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  const record = asRecord(body ?? {});
  if (!record) return { errors: { body: 'must be a JSON object' } };
  rejectUnknown(record, SEARCH_KEYS, errors);

  let query: string | null = null;
  if (record.query !== undefined && record.query !== null) {
    if (typeof record.query !== 'string') errors.query = 'must be a string';
    else {
      query = record.query.trim() || null;
      if (query && query.length < SEARCH_QUERY_MIN_LENGTH) errors.query = `must be at least ${SEARCH_QUERY_MIN_LENGTH} characters`;
      else if (query && query.length > SEARCH_QUERY_MAX_LENGTH) errors.query = `must be at most ${SEARCH_QUERY_MAX_LENGTH} characters`;
    }
  }
  let nic: string | null = null;
  if (record.nic !== undefined && record.nic !== null) {
    if (typeof record.nic !== 'string') errors.nic = 'must be a string';
    else nic = record.nic.trim().toUpperCase() || null;
  }
  if (!query && !nic && !errors.query && !errors.nic) errors.query = 'enter a name, email, phone or full NIC to search';

  let includeInactive = false;
  if (record.includeInactive !== undefined) {
    if (typeof record.includeInactive !== 'boolean') errors.includeInactive = 'must be true or false';
    else includeInactive = record.includeInactive;
  }
  let limit = OFFICER_SEARCH_DEFAULT_LIMIT;
  if (record.limit !== undefined) {
    if (!Number.isInteger(record.limit) || (record.limit as number) < 1 || (record.limit as number) > OFFICER_SEARCH_MAX_LIMIT) {
      errors.limit = `must be an integer from 1 to ${OFFICER_SEARCH_MAX_LIMIT}`;
    } else limit = record.limit as number;
  }
  if (Object.keys(errors).length > 0) return { errors };
  return { value: { query, nic, includeInactive, limit } };
}

export interface OfficerCreateInput {
  fullName: string;
  username: string;
  email: string | null;
  phone: string | null;
  nic: string | null;
  branchId: string;
  roleId: string;
  password: string | null;
}

export function validateOfficerCreateInput(body: unknown): {
  value?: OfficerCreateInput;
  errors?: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  const record = asRecord(body ?? {});
  if (!record) return { errors: { body: 'must be a JSON object' } };
  rejectUnknown(record, CREATE_KEYS, errors);

  const fullName = typeof record.fullName === 'string' ? record.fullName.trim() : '';
  if (!fullName) errors.fullName = 'is required';
  else if (fullName.length > NAME_MAX_LENGTH) errors.fullName = `must be at most ${NAME_MAX_LENGTH} characters`;

  const username = typeof record.username === 'string' ? record.username.trim().toLowerCase() : '';
  if (!username) errors.username = 'is required';
  else if (username.length > USERNAME_MAX_LENGTH) errors.username = `must be at most ${USERNAME_MAX_LENGTH} characters`;

  let email: string | null = null;
  if (record.email !== undefined && record.email !== null) {
    if (typeof record.email !== 'string') errors.email = 'must be a string';
    else {
      email = record.email.trim().toLowerCase() || null;
      if (email && !EMAIL_PATTERN.test(email)) errors.email = 'must be a valid email address';
    }
  }

  let phone: string | null = null;
  if (record.phone !== undefined && record.phone !== null) {
    if (typeof record.phone !== 'string') errors.phone = 'must be a string';
    else {
      phone = normalizePhone(record.phone) || null;
      if (phone && !PHONE_PATTERN.test(phone)) errors.phone = 'must be 7-15 digits with an optional leading +';
    }
  }

  let nic: string | null = null;
  if (record.nic !== undefined && record.nic !== null) {
    if (typeof record.nic !== 'string') errors.nic = 'must be a string';
    else {
      nic = record.nic.trim().toUpperCase() || null;
      if (nic && nic.length > NAME_MAX_LENGTH) errors.nic = `must be at most ${NAME_MAX_LENGTH} characters`;
    }
  }

  if (!UUID_PATTERN.test(String(record.branchId ?? ''))) errors.branchId = 'must be a valid branch UUID';
  if (!UUID_PATTERN.test(String(record.roleId ?? ''))) errors.roleId = 'must be a valid role UUID';

  let password: string | null = null;
  if (record.password !== undefined && record.password !== null) {
    const error = passwordError(record.password);
    if (error) errors.password = error;
    else password = record.password as string;
  }

  if (Object.keys(errors).length > 0) return { errors };
  return {
    value: {
      fullName,
      username,
      email,
      phone,
      nic,
      branchId: String(record.branchId),
      roleId: String(record.roleId),
      password,
    },
  };
}

export interface OfficerUpdateInput {
  fullName?: string;
  email?: string | null;
  phone?: string | null;
  nic?: string | null;
  branchId?: string;
  roleId?: string;
  password?: string;
}

export function validateOfficerUpdateInput(body: unknown): {
  value?: OfficerUpdateInput;
  errors?: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  const record = asRecord(body);
  if (!record) return { errors: { body: 'must be a JSON object' } };
  rejectUnknown(record, UPDATE_KEYS, errors);

  const value: OfficerUpdateInput = {};
  if ('fullName' in record) {
    if (typeof record.fullName !== 'string' || !record.fullName.trim()) errors.fullName = 'cannot be cleared';
    else if (record.fullName.trim().length > NAME_MAX_LENGTH) errors.fullName = `must be at most ${NAME_MAX_LENGTH} characters`;
    else value.fullName = record.fullName.trim();
  }
  if ('email' in record) {
    if (record.email === null) value.email = null;
    else if (typeof record.email !== 'string') errors.email = 'must be a string or null';
    else {
      const lowered = record.email.trim().toLowerCase() || null;
      if (lowered && !EMAIL_PATTERN.test(lowered)) errors.email = 'must be a valid email address';
      else value.email = lowered;
    }
  }
  if ('phone' in record) {
    if (record.phone === null) value.phone = null;
    else if (typeof record.phone !== 'string') errors.phone = 'must be a string or null';
    else {
      const normalized = normalizePhone(record.phone) || null;
      if (normalized && !PHONE_PATTERN.test(normalized)) errors.phone = 'must be 7-15 digits with an optional leading +';
      else value.phone = normalized;
    }
  }
  if ('nic' in record) {
    if (record.nic === null) value.nic = null;
    else if (typeof record.nic !== 'string') errors.nic = 'must be a string or null';
    else {
      const upper = record.nic.trim().toUpperCase() || null;
      if (upper && upper.length > NAME_MAX_LENGTH) errors.nic = `must be at most ${NAME_MAX_LENGTH} characters`;
      else value.nic = upper;
    }
  }
  if ('branchId' in record) {
    if (!UUID_PATTERN.test(String(record.branchId ?? ''))) errors.branchId = 'must be a valid branch UUID';
    else value.branchId = String(record.branchId);
  }
  if ('roleId' in record) {
    if (!UUID_PATTERN.test(String(record.roleId ?? ''))) errors.roleId = 'must be a valid role UUID';
    else value.roleId = String(record.roleId);
  }
  if ('password' in record) {
    const error = passwordError(record.password);
    if (error) errors.password = error;
    else value.password = record.password as string;
  }

  if (Object.keys(value).length === 0 && Object.keys(errors).length === 0) {
    errors.body = 'provide at least one of fullName, email, phone, nic, branchId, roleId or password';
  }
  if (Object.keys(errors).length > 0) return { errors };
  return { value };
}

// ---------------------------------------------------------------------------
// Service

class StaffRejection extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra?: object,
  ) {
    super(message);
  }
}

function sendError(res: Response, status: number, code: string, message: string, extra?: object) {
  res.status(status).json({ error: { code, message, ...extra } });
}

function validationError(res: Response, fields: Record<string, string>) {
  sendError(res, 400, 'VALIDATION_ERROR', 'Please correct the highlighted fields.', { fields });
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const pg = error as { code?: string; constraint?: string };
  return pg?.code === '23505' && pg.constraint === constraint;
}

function idParam(req: Request, key: string): string | null {
  const value = String(req.params[key] ?? '');
  return UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

export function createStaffAccounts({ db }: { db: StaffAccountDb }) {
  // The response is sent only after COMMIT succeeds (FR-080).
  async function inTransaction(
    res: Response,
    work: (client: PoolClient) => Promise<{ status: number; data: StaffAccountView | StaffAccountCreatedView }>,
  ): Promise<void> {
    let client: PoolClient | undefined;
    try {
      client = await db.connect();
      await client.query('BEGIN');
      const outcome = await work(client);
      await client.query('COMMIT');
      res.status(outcome.status).json({ data: outcome.data });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof StaffRejection) {
        sendError(res, error.status, error.code, error.message, error.extra);
      } else if (isUniqueViolation(error, 'user_account_username_unique')) {
        sendError(res, 409, 'USERNAME_EXISTS', 'That username is already in use.');
      } else if (isUniqueViolation(error, 'officer_nic_unique')) {
        sendError(res, 409, 'NIC_EXISTS', 'Another officer already has this NIC.');
      } else {
        sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred.');
      }
    } finally {
      client?.release();
    }
  }

  // Locks the officer identity space so concurrent creates/updates of the
  // same username or NIC serialize; the unique indexes are the final guard.
  async function lockOfficerIdentities(client: Queryable, identity: { username?: string; nic?: string | null }) {
    const keys = [
      identity.username ? `officer-username:${identity.username}` : null,
      identity.nic ? `officer-nic:${identity.nic}` : null,
    ]
      .filter((key): key is string => key !== null)
      .sort();
    for (const key of keys) {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
    }
  }

  async function loadForUpdate(client: Queryable, officerId: string): Promise<OfficerRow> {
    const result = await client.query<OfficerRow>(
      `SELECT ${OFFICER_COLUMNS} ${OFFICER_FROM} WHERE o.officer_id = $1 FOR UPDATE OF o`,
      [officerId],
    );
    if (!result.rows[0]) throw new StaffRejection(404, 'OFFICER_NOT_FOUND', 'Officer not found.');
    return result.rows[0];
  }

  async function refErrors(
    client: Queryable,
    branchId: string,
    roleId: string,
  ): Promise<Record<string, string>> {
    const result = await client.query<{ branch_ok: boolean; role_ok: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM branch WHERE branch_id = $1) AS branch_ok,
              EXISTS(SELECT 1 FROM role WHERE role_id = $2) AS role_ok`,
      [branchId, roleId],
    );
    const errors: Record<string, string> = {};
    if (!result.rows[0].branch_ok) errors.branchId = 'unknown branch';
    if (!result.rows[0].role_ok) errors.roleId = 'unknown role';
    return errors;
  }

  async function view(client: Queryable, officerId: string): Promise<StaffAccountView> {
    const result = await client.query<OfficerRow>(
      `SELECT ${OFFICER_COLUMNS} ${OFFICER_FROM} WHERE o.officer_id = $1`,
      [officerId],
    );
    return toView(result.rows[0]);
  }

  // POST /api/users/search
  async function search(req: Request, res: Response): Promise<void> {
    res.set('Cache-Control', 'no-store');
    const input = validateOfficerSearchInput(req.body);
    if (!input.value) {
      validationError(res, input.errors ?? {});
      return;
    }
    const { query, nic, includeInactive, limit } = input.value;
    const phoneDigits = query ? normalizePhone(query) : '';
    const phoneQuery = /^\+?[0-9]{4,}$/.test(phoneDigits) ? likeContains(phoneDigits) : null;
    try {
      const result = await db.query<OfficerRow>(
        `SELECT ${OFFICER_COLUMNS} ${OFFICER_FROM}
          WHERE ($1::boolean OR o.active)
            AND ($2::text IS NULL OR o.nic = $2)
            AND ($3::text IS NULL
                 OR o.full_name ILIKE $3 ESCAPE '\\'
                 OR lower(o.email) LIKE lower($3) ESCAPE '\\'
                 OR ($4::text IS NOT NULL AND regexp_replace(o.phone, '[\\s().-]', '', 'g') LIKE $4 ESCAPE '\\'))
          ORDER BY o.active DESC, o.full_name, o.officer_id
          LIMIT $5`,
        [includeInactive, nic, query ? likeContains(query) : null, phoneQuery, limit + 1],
      );
      res.json({
        data: result.rows.slice(0, limit).map(toView),
        meta: { limit, truncated: result.rows.length > limit },
      });
    } catch {
      sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred.');
    }
  }

  // GET /api/users/:userId
  async function get(req: Request, res: Response): Promise<void> {
    res.set('Cache-Control', 'no-store');
    const officerId = idParam(req, 'userId');
    if (!officerId) {
      sendError(res, 404, 'OFFICER_NOT_FOUND', 'Officer not found.');
      return;
    }
    try {
      const result = await db.query<OfficerRow>(`SELECT ${OFFICER_COLUMNS} ${OFFICER_FROM} WHERE o.officer_id = $1`, [officerId]);
      if (!result.rows[0]) sendError(res, 404, 'OFFICER_NOT_FOUND', 'Officer not found.');
      else res.json({ data: toView(result.rows[0]) });
    } catch {
      sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred.');
    }
  }

  // POST /api/users
  async function create(req: Request, res: Response): Promise<void> {
    res.set('Cache-Control', 'no-store');
    const input = validateOfficerCreateInput(req.body);
    if (!input.value) {
      validationError(res, input.errors ?? {});
      return;
    }
    const v = input.value;
    const actorId = req.user!.userId;
    // Issued only when the administrator did not supply a password; returned
    // once so it can be handed to the officer, never stored in plain text.
    const temporaryPassword = v.password ? null : `Skyn-${randomBytes(12).toString('base64url')}`;
    await inTransaction(res, async (client) => {
      await lockOfficerIdentities(client, { username: v.username, nic: v.nic });
      const taken = await client.query<{ username_taken: boolean; nic_taken: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM user_account WHERE lower(username) = $1) AS username_taken,
                EXISTS(SELECT 1 FROM officer WHERE nic = $2) AS nic_taken`,
        [v.username, v.nic],
      );
      if (taken.rows[0].username_taken) {
        throw new StaffRejection(409, 'USERNAME_EXISTS', 'That username is already in use.');
      }
      if (taken.rows[0].nic_taken) {
        throw new StaffRejection(409, 'NIC_EXISTS', 'Another officer already has this NIC.');
      }
      const errors = await refErrors(client, v.branchId, v.roleId);
      if (Object.keys(errors).length > 0) {
        throw new StaffRejection(400, 'VALIDATION_ERROR', 'Please correct the highlighted fields.', { fields: errors });
      }
      const passwordHash = await hashPassword(v.password ?? temporaryPassword!);
      const user = await client.query<{ user_id: string }>(
        'INSERT INTO user_account (username, password_hash, active) VALUES ($1, $2, true) RETURNING user_id',
        [v.username, passwordHash],
      );
      const officerId = user.rows[0].user_id;
      await client.query(
        `INSERT INTO officer (officer_id, full_name, email, phone, nic, active, branch_id, role_id)
         VALUES ($1, $2, $3, $4, $5, true, $6, $7)`,
        [officerId, v.fullName, v.email, v.phone, v.nic, v.branchId, v.roleId],
      );
      await appendAudit(client, {
        entityName: 'officer',
        entityId: officerId,
        action: 'CREATE',
        userId: actorId,
        after: {
          username: v.username,
          fullName: v.fullName,
          email: v.email,
          phone: v.phone,
          nic: v.nic,
          branchId: v.branchId,
          roleId: v.roleId,
          tempCredentialIssued: temporaryPassword !== null,
        },
      });
      const data: StaffAccountCreatedView = {
        ...(await view(client, officerId)),
        ...(temporaryPassword ? { temporaryPassword } : {}),
      };
      return { status: 201, data };
    });
  }

  // PATCH /api/users/:userId
  async function update(req: Request, res: Response): Promise<void> {
    res.set('Cache-Control', 'no-store');
    const officerId = idParam(req, 'userId');
    if (!officerId) {
      sendError(res, 404, 'OFFICER_NOT_FOUND', 'Officer not found.');
      return;
    }
    const input = validateOfficerUpdateInput(req.body);
    if (!input.value) {
      validationError(res, input.errors ?? {});
      return;
    }
    const v = input.value;
    const actorId = req.user!.userId;
    await inTransaction(res, async (client) => {
      const officer = await loadForUpdate(client, officerId);
      if (!officer.active) {
        throw new StaffRejection(409, 'OFFICER_INACTIVE', 'Reactivate this account before editing it.');
      }
      if (v.nic !== undefined && v.nic !== null && v.nic !== officer.nic) {
        await lockOfficerIdentities(client, { nic: v.nic });
        const clash = await client.query(
          'SELECT 1 FROM officer WHERE nic = $1 AND officer_id <> $2',
          [v.nic, officerId],
        );
        if (clash.rows.length > 0) throw new StaffRejection(409, 'NIC_EXISTS', 'Another officer already has this NIC.');
      }
      if (v.branchId !== undefined || v.roleId !== undefined) {
        const errors = await refErrors(client, v.branchId ?? officer.branch_id, v.roleId ?? officer.role_id);
        if (Object.keys(errors).length > 0) {
          throw new StaffRejection(400, 'VALIDATION_ERROR', 'Please correct the highlighted fields.', { fields: errors });
        }
      }

      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      const sets: string[] = [];
      const values: unknown[] = [];
      let param = 1;
      const diff = (column: string, key: string, current: unknown, next: unknown) => {
        if (next !== undefined && next !== current) {
          before[key] = current;
          after[key] = next;
          sets.push(`${column} = $${param++}`);
          values.push(next);
        }
      };
      diff('full_name', 'fullName', officer.full_name, v.fullName);
      diff('email', 'email', officer.email, v.email);
      diff('phone', 'phone', officer.phone, v.phone);
      diff('nic', 'nic', officer.nic, v.nic);
      diff('branch_id', 'branchId', officer.branch_id, v.branchId);
      diff('role_id', 'roleId', officer.role_id, v.roleId);

      let passwordHash: string | undefined;
      if (v.password !== undefined) {
        passwordHash = await hashPassword(v.password);
        after.password = '[REDACTED]';
      }

      if (sets.length === 0 && !passwordHash) {
        return { status: 200, data: toView(officer) };
      }

      if (passwordHash) {
        // The password fingerprint in existing sessions changes, so every
        // current cookie for this officer stops working immediately (M1-S08).
        await client.query('UPDATE user_account SET password_hash = $1, updated_at = now() WHERE user_id = $2', [
          passwordHash,
          officerId,
        ]);
      }
      if (sets.length > 0) {
        sets.push('updated_at = now()');
        values.push(officerId);
        await client.query(`UPDATE officer SET ${sets.join(', ')} WHERE officer_id = $${param}`, values);
      }
      if (Object.keys(after).length > 0) {
        await appendAudit(client, {
          entityName: 'officer',
          entityId: officerId,
          action: 'UPDATE',
          userId: actorId,
          before,
          after,
        });
      }
      return { status: 200, data: await view(client, officerId) };
    });
  }

  // POST /api/users/:userId/disable
  async function disable(req: Request, res: Response): Promise<void> {
    res.set('Cache-Control', 'no-store');
    const officerId = idParam(req, 'userId');
    if (!officerId) {
      sendError(res, 404, 'OFFICER_NOT_FOUND', 'Officer not found.');
      return;
    }
    const actorId = req.user!.userId;
    if (actorId === officerId) {
      sendError(res, 403, 'SELF_DISABLE_FORBIDDEN', 'You cannot disable your own account.');
      return;
    }
    await inTransaction(res, async (client) => {
      const officer = await loadForUpdate(client, officerId);
      if (!officer.active) {
        throw new StaffRejection(409, 'ALREADY_INACTIVE', 'This account is already disabled.');
      }
      await client.query('UPDATE officer SET active = false, updated_at = now() WHERE officer_id = $1', [officerId]);
      await client.query('UPDATE user_account SET active = false, updated_at = now() WHERE user_id = $1', [officerId]);
      await appendAudit(client, {
        entityName: 'officer',
        entityId: officerId,
        action: 'DEACTIVATE',
        userId: actorId,
        before: { active: true },
        after: { active: false },
      });
      return { status: 200, data: await view(client, officerId) };
    });
  }

  // POST /api/users/:userId/reactivate
  async function reactivate(req: Request, res: Response): Promise<void> {
    res.set('Cache-Control', 'no-store');
    const officerId = idParam(req, 'userId');
    if (!officerId) {
      sendError(res, 404, 'OFFICER_NOT_FOUND', 'Officer not found.');
      return;
    }
    const actorId = req.user!.userId;
    await inTransaction(res, async (client) => {
      const officer = await loadForUpdate(client, officerId);
      if (officer.active) {
        throw new StaffRejection(409, 'ALREADY_ACTIVE', 'This account is already active.');
      }
      await client.query('UPDATE officer SET active = true, updated_at = now() WHERE officer_id = $1', [officerId]);
      await client.query('UPDATE user_account SET active = true, updated_at = now() WHERE user_id = $1', [officerId]);
      await appendAudit(client, {
        entityName: 'officer',
        entityId: officerId,
        action: 'REACTIVATE',
        userId: actorId,
        before: { active: false },
        after: { active: true },
      });
      return { status: 200, data: await view(client, officerId) };
    });
  }

  return { search, get, create, update, disable, reactivate };
}

export type StaffAccountService = ReturnType<typeof createStaffAccounts>;
