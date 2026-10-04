import { Request, Response } from 'express';
import { pool as db } from '../db';

function readActorUserId(req: Request): string | null {
  const rawUserId =
    req.headers['x-user-id'] ??
    req.headers['x-userId'] ??
    req.query.userId ??
    req.query.user_id ??
    req.body?.userId ??
    req.body?.user_id ??
    req.body?.actorUserId ??
    req.body?.recorded_by;

  if (Array.isArray(rawUserId)) {
    return rawUserId[0]?.toString().trim() || null;
  }

  if (typeof rawUserId === 'string') {
    return rawUserId.trim() || null;
  }

  return null;
}

async function getActorRoleName(userId: string | null): Promise<string | null> {
  if (!userId) {
    return null;
  }

  const result = await db.query(
    `SELECT r.role_name
     FROM officer o
     JOIN role r ON r.role_id = o.role_id
     WHERE o.officer_id = $1::uuid`,
    [userId],
  );

  return result.rows[0]?.role_name ?? null;
}

function parsePrice(value: unknown): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = typeof value === 'string' ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

function normaliseText(value: unknown, fieldName: string): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (fieldName === 'name' || fieldName === 'category') {
    return trimmed;
  }

  return trimmed;
}

function validateServiceInput(input: Record<string, unknown>, partial = false): { name?: string; category?: string; current_price?: number; active?: boolean } {
  const result: { name?: string; category?: string; current_price?: number; active?: boolean } = {};

  if ('name' in input || !partial) {
    const name = normaliseText(input.name, 'name');
    if (name === null) {
      throw new Error('Service name is required.');
    }
    result.name = name;
  }

  if ('category' in input || !partial) {
    const category = normaliseText(input.category, 'category');
    if (category === null) {
      throw new Error('Service category is required.');
    }
    result.category = category;
  }

  if ('current_price' in input || !partial) {
    const price = parsePrice(input.current_price ?? input.price);
    if (price === null) {
      throw new Error('Service price must be a non-negative number.');
    }
    result.current_price = price;
  }

  if ('active' in input || !partial) {
    if (typeof input.active === 'string') {
      const activeValue = input.active.trim().toLowerCase();
      if (activeValue !== 'true' && activeValue !== 'false') {
        throw new Error('Service active flag must be a boolean.');
      }
      result.active = activeValue === 'true';
    } else if (typeof input.active === 'boolean') {
      result.active = input.active;
    } else if (!partial && input.active !== undefined) {
      throw new Error('Service active flag must be a boolean.');
    }
  }

  return result;
}

async function ensureChainManager(req: Request): Promise<void> {
  const userId = readActorUserId(req);
  const roleName = await getActorRoleName(userId);

  if (roleName !== 'CHAIN_MANAGER') {
    throw new Error('Only CHAIN_MANAGER may change the service catalogue.');
  }
}

export const listServices = async (req: Request, res: Response): Promise<void> => {
  try {
    const activeParam = req.query?.active;
    const params: unknown[] = [];
    let sql = 'SELECT service_id, name, category, current_price, active, created_at, updated_at FROM service';

    if (activeParam !== undefined) {
      const filter = String(activeParam).trim().toLowerCase();
      if (filter === 'true' || filter === 'false') {
        sql += ' WHERE active = $1';
        params.push(filter === 'true');
      }
    }

    sql += ' ORDER BY name ASC';

    const result = await db.query(sql, params);
    res.status(200).json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Unable to load catalogue.' });
  }
};

export const createService = async (req: Request, res: Response): Promise<void> => {
  try {
    await ensureChainManager(req);

    const payload = validateServiceInput(req.body || {});
    const result = await db.query(
      `INSERT INTO service (name, category, current_price, active)
       VALUES ($1, $2, $3, $4)
       RETURNING service_id, name, category, current_price, active, created_at, updated_at`,
      [payload.name, payload.category, payload.current_price, payload.active ?? true],
    );

    res.status(201).json({ service: result.rows[0] });
  } catch (error: any) {
    const status = error.message === 'Only CHAIN_MANAGER may change the service catalogue.' ? 403 : 400;
    res.status(status).json({ error: error.message || 'Failed to create service.' });
  }
};

export const updateService = async (req: Request, res: Response): Promise<void> => {
  try {
    await ensureChainManager(req);

    const serviceId = req.params.serviceId;
    if (!serviceId) {
      res.status(400).json({ error: 'Service ID is required.' });
      return;
    }

    const existing = await db.query('SELECT service_id FROM service WHERE service_id = $1::uuid', [serviceId]);
    if (!existing.rows.length) {
      res.status(404).json({ error: 'Service not found.' });
      return;
    }

    const payload = validateServiceInput(req.body || {}, true);
    const assignments: string[] = [];
    const values: unknown[] = [];
    let index = 1;

    if (payload.name !== undefined) {
      assignments.push(`name = $${index}`);
      values.push(payload.name);
      index += 1;
    }

    if (payload.category !== undefined) {
      assignments.push(`category = $${index}`);
      values.push(payload.category);
      index += 1;
    }

    if (payload.current_price !== undefined) {
      assignments.push(`current_price = $${index}`);
      values.push(payload.current_price);
      index += 1;
    }

    if (payload.active !== undefined) {
      assignments.push(`active = $${index}`);
      values.push(payload.active);
      index += 1;
    }

    if (!assignments.length) {
      res.status(400).json({ error: 'No valid service fields were supplied to update.' });
      return;
    }

    assignments.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(serviceId);

    const result = await db.query(
      `UPDATE service
       SET ${assignments.join(', ')}
       WHERE service_id = $${index}
       RETURNING service_id, name, category, current_price, active, created_at, updated_at`,
      values,
    );

    res.status(200).json({ service: result.rows[0] });
  } catch (error: any) {
    const status = error.message === 'Only CHAIN_MANAGER may change the service catalogue.' ? 403 : 400;
    res.status(status).json({ error: error.message || 'Failed to update service.' });
  }
};

export default {
  listServices,
  createService,
  updateService,
};
