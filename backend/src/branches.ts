import type { Request, Response } from 'express';
import type { Pool, PoolClient } from 'pg';
import { appendAudit } from './audit';

// M1-S20 audited branch-record administration (SRS §4.3, FR-008, AT-25).
// Only SYSTEM_ADMINISTRATOR may create/edit/deactivate a branch (branch.write);
// every staff role may read the branch list (branch.read). Deactivation is a
// soft flag: the row is never deleted, so rooms, officers, bookings and audit
// evidence keep a valid branch FK (FR-008, FR-021). Member 2's M2-S06 trigger
// m2_guard_branch_deactivation rejects the deactivation while any room in the
// branch has a current BOOKED/CHECKED_IN assignment; that trigger and Member 2's
// booking validation both lock the branch row, so a concurrent booking can
// never slip past a deactivation (or vice versa) at any isolation level.

type Queryable = Pick<PoolClient, 'query'>;
export type BranchDb = Queryable & Pick<Pool, 'connect'>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_MAX_LENGTH = 255;
const ADDRESS_MAX_LENGTH = 65535;
const SEARCH_MAX_LENGTH = 100;
const REASON_MAX_LENGTH = 500;

const CREATE_KEYS = new Set(['name', 'city', 'address', 'active']);
const UPDATE_KEYS = new Set(['name', 'city', 'address']);
const DEACTIVATE_KEYS = new Set(['reason']);

const BRANCH_COLUMNS =
  'branch_id, name, city, address, active, created_at, updated_at';

interface BranchRow {
  branch_id: string;
  name: string;
  city: string;
  address: string | null;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface BranchView {
  branchId: string;
  name: string;
  city: string;
  address: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

function toView(row: BranchRow): BranchView {
  return {
    branchId: row.branch_id,
    name: row.name,
    city: row.city,
    address: row.address,
    active: row.active,
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

// Escapes LIKE metacharacters so a literal name/city substring search cannot be
// widened by `%`, `_` or backslash (AT-10).
function likeContains(value: string): string {
  return `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

// ---------------------------------------------------------------------------
// Input validation

export interface BranchCreateInput {
  name: string;
  city: string;
  address: string | null;
  active: boolean;
}

export function validateBranchCreateInput(body: unknown): {
  value?: BranchCreateInput;
  errors?: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  const record = asRecord(body ?? {});
  if (!record) return { errors: { body: 'must be a JSON object' } };
  rejectUnknown(record, CREATE_KEYS, errors);

  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (!name) errors.name = 'is required';
  else if (name.length > NAME_MAX_LENGTH) errors.name = `must be at most ${NAME_MAX_LENGTH} characters`;

  const city = typeof record.city === 'string' ? record.city.trim() : '';
  if (!city) errors.city = 'is required';
  else if (city.length > NAME_MAX_LENGTH) errors.city = `must be at most ${NAME_MAX_LENGTH} characters`;

  let address: string | null = null;
  if (record.address !== undefined && record.address !== null) {
    if (typeof record.address !== 'string') errors.address = 'must be a string or null';
    else {
      address = record.address.trim() || null;
      if (address && address.length > ADDRESS_MAX_LENGTH) {
        errors.address = `must be at most ${ADDRESS_MAX_LENGTH} characters`;
      }
    }
  }

  let active = true;
  if (record.active !== undefined) {
    if (typeof record.active !== 'boolean') errors.active = 'must be true or false';
    else active = record.active;
  }

  if (Object.keys(errors).length > 0) return { errors };
  return { value: { name, city, address, active } };
}

export interface BranchUpdateInput {
  name?: string;
  city?: string;
  address?: string | null;
}

export function validateBranchUpdateInput(body: unknown): {
  value?: BranchUpdateInput;
  errors?: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  const record = asRecord(body);
  if (!record) return { errors: { body: 'must be a JSON object' } };
  rejectUnknown(record, UPDATE_KEYS, errors);

  const value: BranchUpdateInput = {};
  if ('name' in record) {
    if (typeof record.name !== 'string' || !record.name.trim()) errors.name = 'cannot be cleared';
    else if (record.name.trim().length > NAME_MAX_LENGTH) errors.name = `must be at most ${NAME_MAX_LENGTH} characters`;
    else value.name = record.name.trim();
  }
  if ('city' in record) {
    if (typeof record.city !== 'string' || !record.city.trim()) errors.city = 'cannot be cleared';
    else if (record.city.trim().length > NAME_MAX_LENGTH) errors.city = `must be at most ${NAME_MAX_LENGTH} characters`;
    else value.city = record.city.trim();
  }
  if ('address' in record) {
    if (record.address === null) value.address = null;
    else if (typeof record.address !== 'string') errors.address = 'must be a string or null';
    else {
      const trimmed = record.address.trim() || null;
      if (trimmed && trimmed.length > ADDRESS_MAX_LENGTH) {
        errors.address = `must be at most ${ADDRESS_MAX_LENGTH} characters`;
      } else value.address = trimmed;
    }
  }

  if (Object.keys(value).length === 0 && Object.keys(errors).length === 0) {
    errors.body = 'provide at least one of name, city or address';
  }
  if (Object.keys(errors).length > 0) return { errors };
  return { value };
}

export interface BranchSearchInput {
  active: boolean | null;
  search: string | null;
}

export function validateBranchSearchInput(query: unknown): {
  value?: BranchSearchInput;
  errors?: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  const record = asRecord(query ?? {});
  if (!record) return { errors: { body: 'must be an object' } };

  let active: boolean | null = null;
  const rawActive = record.active;
  if (rawActive !== undefined && rawActive !== '') {
    if (rawActive === 'true') active = true;
    else if (rawActive === 'false') active = false;
    else errors.active = 'must be true or false';
  }

  let search: string | null = null;
  const rawSearch = record.search;
  if (rawSearch !== undefined) {
    if (typeof rawSearch !== 'string') errors.search = 'must be a string';
    else {
      search = rawSearch.trim() || null;
      if (search && search.length > SEARCH_MAX_LENGTH) {
        errors.search = `must be at most ${SEARCH_MAX_LENGTH} characters`;
      }
    }
  }

  if (Object.keys(errors).length > 0) return { errors };
  return { value: { active, search } };
}

// ---------------------------------------------------------------------------
// Service

class BranchRejection extends Error {
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

// m2_guard_branch_deactivation raises SQLSTATE 23514 when a room in the branch
// still holds a current BOOKED/CHECKED_IN assignment.
function isBranchDeactivationConflict(error: unknown): boolean {
  return (error as { code?: string })?.code === '23514';
}

function idParam(req: Request, key: string): string | null {
  const value = String(req.params[key] ?? '');
  return UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

export function createBranches({ db }: { db: BranchDb }) {
  // The response is sent only after COMMIT succeeds (FR-080).
  async function inTransaction(
    res: Response,
    work: (client: PoolClient) => Promise<{ status: number; data: BranchView }>,
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
      if (error instanceof BranchRejection) {
        sendError(res, error.status, error.code, error.message, error.extra);
      } else {
        sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred.');
      }
    } finally {
      client?.release();
    }
  }

  async function loadForUpdate(client: Queryable, branchId: string): Promise<BranchRow> {
    const result = await client.query<BranchRow>(
      `SELECT ${BRANCH_COLUMNS} FROM branch WHERE branch_id = $1 FOR UPDATE`,
      [branchId],
    );
    if (!result.rows[0]) throw new BranchRejection(404, 'BRANCH_NOT_FOUND', 'Branch not found.');
    return result.rows[0];
  }

  async function view(client: Queryable, branchId: string): Promise<BranchView> {
    const result = await client.query<BranchRow>(
      `SELECT ${BRANCH_COLUMNS} FROM branch WHERE branch_id = $1`,
      [branchId],
    );
    return toView(result.rows[0]);
  }

  // GET /api/branches
  async function list(req: Request, res: Response): Promise<void> {
    res.set('Cache-Control', 'no-store');
    const input = validateBranchSearchInput(req.query);
    if (!input.value) {
      validationError(res, input.errors ?? {});
      return;
    }
    const { active, search } = input.value;
    try {
      const result = await db.query<BranchRow>(
        `SELECT ${BRANCH_COLUMNS} FROM branch
          WHERE ($1::boolean IS NULL OR active = $1)
            AND ($2::text IS NULL OR name ILIKE $2 ESCAPE '\\' OR city ILIKE $2 ESCAPE '\\')
          ORDER BY name, branch_id`,
        [active, search ? likeContains(search) : null],
      );
      res.json({ data: result.rows.map(toView) });
    } catch {
      sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred.');
    }
  }

  // GET /api/branches/:branchId
  async function get(req: Request, res: Response): Promise<void> {
    res.set('Cache-Control', 'no-store');
    const branchId = idParam(req, 'branchId');
    if (!branchId) {
      sendError(res, 404, 'BRANCH_NOT_FOUND', 'Branch not found.');
      return;
    }
    try {
      const result = await db.query<BranchRow>(
        `SELECT ${BRANCH_COLUMNS} FROM branch WHERE branch_id = $1`,
        [branchId],
      );
      if (!result.rows[0]) sendError(res, 404, 'BRANCH_NOT_FOUND', 'Branch not found.');
      else res.json({ data: toView(result.rows[0]) });
    } catch {
      sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred.');
    }
  }

  // POST /api/branches
  async function create(req: Request, res: Response): Promise<void> {
    res.set('Cache-Control', 'no-store');
    const input = validateBranchCreateInput(req.body);
    if (!input.value) {
      validationError(res, input.errors ?? {});
      return;
    }
    const v = input.value;
    const actorId = req.user!.userId;
    await inTransaction(res, async (client) => {
      const inserted = await client.query<BranchRow>(
        `INSERT INTO branch (name, city, address, active)
         VALUES ($1, $2, $3, $4)
         RETURNING ${BRANCH_COLUMNS}`,
        [v.name, v.city, v.address, v.active],
      );
      const branchId = inserted.rows[0].branch_id;
      await appendAudit(client, {
        entityName: 'branch',
        entityId: branchId,
        action: 'CREATE',
        userId: actorId,
        after: { name: v.name, city: v.city, address: v.address, active: v.active },
      });
      return { status: 201, data: toView(inserted.rows[0]) };
    });
  }

  // PATCH /api/branches/:branchId
  async function update(req: Request, res: Response): Promise<void> {
    res.set('Cache-Control', 'no-store');
    const branchId = idParam(req, 'branchId');
    if (!branchId) {
      sendError(res, 404, 'BRANCH_NOT_FOUND', 'Branch not found.');
      return;
    }
    const input = validateBranchUpdateInput(req.body);
    if (!input.value) {
      validationError(res, input.errors ?? {});
      return;
    }
    const v = input.value;
    const actorId = req.user!.userId;
    await inTransaction(res, async (client) => {
      const current = await loadForUpdate(client, branchId);
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      const sets: string[] = [];
      const values: unknown[] = [];
      let param = 1;
      const diff = (column: string, key: string, currentValue: unknown, nextValue: unknown) => {
        if (nextValue !== undefined && nextValue !== currentValue) {
          before[key] = currentValue;
          after[key] = nextValue;
          sets.push(`${column} = $${param++}`);
          values.push(nextValue);
        }
      };
      diff('name', 'name', current.name, v.name);
      diff('city', 'city', current.city, v.city);
      diff('address', 'address', current.address, v.address);

      if (sets.length === 0) {
        // A no-op writes no row and no audit entry.
        return { status: 200, data: toView(current) };
      }
      sets.push('updated_at = now()');
      values.push(branchId);
      await client.query(`UPDATE branch SET ${sets.join(', ')} WHERE branch_id = $${param}`, values);
      await appendAudit(client, {
        entityName: 'branch',
        entityId: branchId,
        action: 'UPDATE',
        userId: actorId,
        before,
        after,
      });
      return { status: 200, data: await view(client, branchId) };
    });
  }

  // POST /api/branches/:branchId/deactivate
  async function deactivate(req: Request, res: Response): Promise<void> {
    res.set('Cache-Control', 'no-store');
    const branchId = idParam(req, 'branchId');
    if (!branchId) {
      sendError(res, 404, 'BRANCH_NOT_FOUND', 'Branch not found.');
      return;
    }
    const record = asRecord(req.body ?? {});
    if (!record) {
      validationError(res, { body: 'must be a JSON object' });
      return;
    }
    const errors: Record<string, string> = {};
    rejectUnknown(record, DEACTIVATE_KEYS, errors);
    let reason: string | null = null;
    if (record.reason !== undefined && record.reason !== null) {
      if (typeof record.reason !== 'string') errors.reason = 'must be a string or null';
      else {
        reason = record.reason.trim() || null;
        if (reason && reason.length > REASON_MAX_LENGTH) {
          errors.reason = `must be at most ${REASON_MAX_LENGTH} characters`;
        }
      }
    }
    if (Object.keys(errors).length > 0) {
      validationError(res, errors);
      return;
    }
    const actorId = req.user!.userId;
    await inTransaction(res, async (client) => {
      const current = await loadForUpdate(client, branchId);
      if (!current.active) {
        throw new BranchRejection(409, 'ALREADY_INACTIVE', 'This branch is already inactive.');
      }
      try {
        await client.query('UPDATE branch SET active = false, updated_at = now() WHERE branch_id = $1', [branchId]);
      } catch (error) {
        if (isBranchDeactivationConflict(error)) {
          throw new BranchRejection(
            409,
            'BRANCH_HAS_ACTIVE_ASSIGNMENTS',
            'This branch cannot be deactivated while a room has a current BOOKED or CHECKED_IN assignment.',
          );
        }
        throw error;
      }
      await appendAudit(client, {
        entityName: 'branch',
        entityId: branchId,
        action: 'DEACTIVATE',
        userId: actorId,
        before: { active: true },
        after: { active: false, ...(reason ? { reason } : {}) },
      });
      return { status: 200, data: await view(client, branchId) };
    });
  }

  // POST /api/branches/:branchId/reactivate
  async function reactivate(req: Request, res: Response): Promise<void> {
    res.set('Cache-Control', 'no-store');
    const branchId = idParam(req, 'branchId');
    if (!branchId) {
      sendError(res, 404, 'BRANCH_NOT_FOUND', 'Branch not found.');
      return;
    }
    const actorId = req.user!.userId;
    await inTransaction(res, async (client) => {
      const current = await loadForUpdate(client, branchId);
      if (current.active) {
        throw new BranchRejection(409, 'ALREADY_ACTIVE', 'This branch is already active.');
      }
      await client.query('UPDATE branch SET active = true, updated_at = now() WHERE branch_id = $1', [branchId]);
      await appendAudit(client, {
        entityName: 'branch',
        entityId: branchId,
        action: 'REACTIVATE',
        userId: actorId,
        before: { active: false },
        after: { active: true },
      });
      return { status: 200, data: await view(client, branchId) };
    });
  }

  return { list, get, create, update, deactivate, reactivate };
}

export type BranchService = ReturnType<typeof createBranches>;
