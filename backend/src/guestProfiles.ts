import type { Request, Response } from 'express';
import type { Pool, PoolClient } from 'pg';
import { appendAudit } from './audit';
import {
  GuestIdentityMatch,
  GuestProfileFields,
  findGuestIdentityMatches,
  lockGuestIdentities,
  maskNic,
  normalizePhone,
  parseGuestProfileFields,
} from './guestIdentity';

// M1-S11 staff guest-profile search/create/update/deactivate (SRS §4.2,
// FR-016..FR-019, FR-021/022, NFR-011, AT-10). FRONT_DESK only, chain-wide
// because guest has no branch FK (guest.manage). Every response masks NIC to
// its last four characters; a full NIC is accepted only for exact search, never
// partial, so it cannot be enumerated. Search uses POST so NICs stay out of URLs
// and access logs. Duplicate checks share the M1-S10 identity locks:
//  - a NIC match is always refused (guest_nic_unique);
//  - an email/phone match is refused with masked candidates unless the officer
//    confirms the new profile is a different person (confirmNotDuplicate).
// Deactivation is a soft flag that keeps all history (FR-022); it is refused
// while the guest has a BOOKED or CHECKED_IN room line and immediately disables
// a linked online login (auth re-reads guest.active per request).

type Queryable = Pick<PoolClient, 'query'>;
export type GuestProfileDb = Queryable & Pick<Pool, 'connect'>;

export const GUEST_SEARCH_DEFAULT_LIMIT = 20;
export const GUEST_SEARCH_MAX_LIMIT = 50;
const SEARCH_QUERY_MIN_LENGTH = 2;
const SEARCH_QUERY_MAX_LENGTH = 100;
const REASON_MAX_LENGTH = 255;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROFILE_KEYS = new Set(['fullName', 'email', 'phone', 'nic']);

interface GuestRow {
  guest_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  nic: string | null;
  active: boolean;
  has_online_account: boolean;
  created_at: Date;
  updated_at: Date;
}

const GUEST_COLUMNS = `g.guest_id, g.full_name, g.email, g.phone, g.nic, g.active,
       EXISTS (SELECT 1 FROM guest_account ga WHERE ga.guest_id = g.guest_id) AS has_online_account,
       g.created_at, g.updated_at`;

export interface GuestProfileView {
  guestId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  maskedNic: string | null;
  hasNic: boolean;
  active: boolean;
  hasOnlineAccount: boolean;
  createdAt: string;
  updatedAt: string;
}

function toView(row: GuestRow): GuestProfileView {
  return {
    guestId: row.guest_id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    maskedNic: maskNic(row.nic),
    hasNic: row.nic !== null,
    active: row.active,
    hasOnlineAccount: row.has_online_account,
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

export interface GuestSearchInput {
  query: string | null;
  nic: string | null;
  includeInactive: boolean;
  limit: number;
}

export function validateGuestSearchInput(body: unknown): { value?: GuestSearchInput; errors?: Record<string, string> } {
  const errors: Record<string, string> = {};
  const record = asRecord(body ?? {});
  if (!record) return { errors: { body: 'must be a JSON object' } };
  rejectUnknown(record, new Set(['query', 'nic', 'includeInactive', 'limit']), errors);

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
  let limit = GUEST_SEARCH_DEFAULT_LIMIT;
  if (record.limit !== undefined) {
    if (!Number.isInteger(record.limit) || (record.limit as number) < 1 || (record.limit as number) > GUEST_SEARCH_MAX_LIMIT) {
      errors.limit = `must be an integer from 1 to ${GUEST_SEARCH_MAX_LIMIT}`;
    } else limit = record.limit as number;
  }
  if (Object.keys(errors).length > 0) return { errors };
  return { value: { query, nic, includeInactive, limit } };
}

export interface GuestWriteInput {
  fields: Partial<GuestProfileFields>;
  confirmNotDuplicate: boolean;
}

export function validateGuestWriteInput(
  body: unknown,
  partial: boolean,
): { value?: GuestWriteInput; errors?: Record<string, string> } {
  const errors: Record<string, string> = {};
  const record = asRecord(body);
  if (!record) return { errors: { body: 'must be a JSON object' } };
  rejectUnknown(record, new Set([...PROFILE_KEYS, 'confirmNotDuplicate']), errors);
  const fields = parseGuestProfileFields(record, errors, partial);
  let confirmNotDuplicate = false;
  if (record.confirmNotDuplicate !== undefined) {
    if (typeof record.confirmNotDuplicate !== 'boolean') errors.confirmNotDuplicate = 'must be true or false';
    else confirmNotDuplicate = record.confirmNotDuplicate;
  }
  if (!partial && !fields.email && !fields.phone && !errors.email && !errors.phone) {
    errors.contact = 'an email address or phone number is required';
  }
  if (partial && Object.keys(fields).length === 0 && Object.keys(errors).length === 0) {
    errors.body = 'provide at least one of fullName, email, phone or nic';
  }
  if (Object.keys(errors).length > 0) return { errors };
  return { value: { fields, confirmNotDuplicate } };
}

// Escapes LIKE metacharacters so user text is matched literally (AT-10).
function likeContains(value: string): string {
  return `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

// ---------------------------------------------------------------------------
// Service

class GuestRejection extends Error {
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

function duplicateRejection(matches: GuestIdentityMatch[], confirmNotDuplicate: boolean): GuestRejection | null {
  const nicMatches = matches.filter((m) => m.matchedOn.includes('nic'));
  if (nicMatches.length > 0) {
    return new GuestRejection(409, 'GUEST_NIC_EXISTS', 'Another guest profile already has this NIC.', {
      candidates: nicMatches,
    });
  }
  if (matches.length > 0 && !confirmNotDuplicate) {
    return new GuestRejection(
      409,
      'POSSIBLE_DUPLICATE',
      'These details match an existing guest profile. Use that profile, or confirm this is a different person.',
      { candidates: matches },
    );
  }
  return null;
}

function isNicUniqueViolation(error: unknown): boolean {
  const pg = error as { code?: string; constraint?: string };
  return pg?.code === '23505' && pg.constraint === 'guest_nic_unique';
}

function guestIdParam(req: Request): string | null {
  const guestId = String(req.params.guestId ?? '');
  return UUID_PATTERN.test(guestId) ? guestId.toLowerCase() : null;
}

export function createGuestProfiles({ db }: { db: GuestProfileDb }) {
  // The response is sent only after COMMIT succeeds.
  async function inTransaction(
    res: Response,
    work: (client: PoolClient) => Promise<{ status: number; data: GuestProfileView }>,
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
      if (error instanceof GuestRejection) {
        sendError(res, error.status, error.code, error.message, error.extra);
      } else if (isNicUniqueViolation(error)) {
        sendError(res, 409, 'GUEST_NIC_EXISTS', 'Another guest profile already has this NIC.');
      } else {
        sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred.');
      }
    } finally {
      client?.release();
    }
  }

  async function loadForUpdate(client: Queryable, guestId: string): Promise<GuestRow> {
    // FOR UPDATE conflicts with the FOR KEY SHARE taken by booking creation,
    // so a deactivation and a new booking for the same guest are serialized.
    const result = await client.query<GuestRow>(
      `SELECT ${GUEST_COLUMNS} FROM guest g WHERE g.guest_id = $1 FOR UPDATE`,
      [guestId],
    );
    if (!result.rows[0]) throw new GuestRejection(404, 'GUEST_NOT_FOUND', 'Guest not found.');
    return result.rows[0];
  }

  // POST /api/guests/search
  async function search(req: Request, res: Response): Promise<void> {
    res.set('Cache-Control', 'no-store');
    const input = validateGuestSearchInput(req.body);
    if (!input.value) {
      validationError(res, input.errors ?? {});
      return;
    }
    const { query, nic, includeInactive, limit } = input.value;
    const phoneDigits = query ? normalizePhone(query) : '';
    const phoneQuery = /^\+?[0-9]{4,}$/.test(phoneDigits) ? likeContains(phoneDigits) : null;
    try {
      const result = await db.query<GuestRow>(
        `SELECT ${GUEST_COLUMNS}
           FROM guest g
          WHERE ($1::boolean OR g.active)
            AND ($2::text IS NULL OR g.nic = $2)
            AND ($3::text IS NULL
                 OR g.full_name ILIKE $3 ESCAPE '\\'
                 OR lower(g.email) LIKE lower($3) ESCAPE '\\'
                 OR ($4::text IS NOT NULL AND regexp_replace(g.phone, '[\\s().-]', '', 'g') LIKE $4 ESCAPE '\\'))
          ORDER BY g.active DESC, g.full_name, g.guest_id
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

  // GET /api/guests/:guestId
  async function get(req: Request, res: Response): Promise<void> {
    res.set('Cache-Control', 'no-store');
    const guestId = guestIdParam(req);
    if (!guestId) {
      sendError(res, 404, 'GUEST_NOT_FOUND', 'Guest not found.');
      return;
    }
    try {
      const result = await db.query<GuestRow>(`SELECT ${GUEST_COLUMNS} FROM guest g WHERE g.guest_id = $1`, [guestId]);
      if (!result.rows[0]) sendError(res, 404, 'GUEST_NOT_FOUND', 'Guest not found.');
      else res.json({ data: toView(result.rows[0]) });
    } catch {
      sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred.');
    }
  }

  // POST /api/guests
  async function create(req: Request, res: Response): Promise<void> {
    res.set('Cache-Control', 'no-store');
    const input = validateGuestWriteInput(req.body, false);
    if (!input.value) {
      validationError(res, input.errors ?? {});
      return;
    }
    const fields = input.value.fields as GuestProfileFields;
    const actorId = req.user!.userId;
    await inTransaction(res, async (client) => {
      await lockGuestIdentities(client, fields);
      const rejection = duplicateRejection(await findGuestIdentityMatches(client, fields), input.value!.confirmNotDuplicate);
      if (rejection) throw rejection;
      const inserted = await client.query<{ guest_id: string }>(
        'INSERT INTO guest (full_name, email, phone, nic) VALUES ($1, $2, $3, $4) RETURNING guest_id',
        [fields.fullName, fields.email, fields.phone, fields.nic],
      );
      const guestId = inserted.rows[0].guest_id;
      await appendAudit(client, {
        userId: actorId,
        entityName: 'guest',
        entityId: guestId,
        action: 'CREATE',
        after: { ...fields, source: 'STAFF', confirmedNotDuplicate: input.value!.confirmNotDuplicate },
        ipAddress: req.ip,
      });
      const row = await client.query<GuestRow>(`SELECT ${GUEST_COLUMNS} FROM guest g WHERE g.guest_id = $1`, [guestId]);
      return { status: 201, data: toView(row.rows[0]) };
    });
  }

  // PATCH /api/guests/:guestId. Only guest contact/identity fields change;
  // booking and invoice rows reference guest_id, so history is unaffected (FR-021).
  async function update(req: Request, res: Response): Promise<void> {
    res.set('Cache-Control', 'no-store');
    const guestId = guestIdParam(req);
    if (!guestId) {
      sendError(res, 404, 'GUEST_NOT_FOUND', 'Guest not found.');
      return;
    }
    const input = validateGuestWriteInput(req.body, true);
    if (!input.value) {
      validationError(res, input.errors ?? {});
      return;
    }
    const requested = input.value.fields;
    const actorId = req.user!.userId;
    await inTransaction(res, async (client) => {
      // Identity locks first, in the same order as create/registration.
      await lockGuestIdentities(client, requested);
      const current = await loadForUpdate(client, guestId);
      if (!current.active) {
        throw new GuestRejection(409, 'GUEST_INACTIVE', 'Reactivate this guest profile before editing it.');
      }
      const currentFields: GuestProfileFields = {
        fullName: current.full_name,
        email: current.email,
        phone: current.phone,
        nic: current.nic,
      };
      const changed = (Object.keys(requested) as (keyof GuestProfileFields)[]).filter(
        (key) => requested[key] !== currentFields[key],
      );
      if (changed.length === 0) return { status: 200, data: toView(current) };
      const next = { ...currentFields, ...requested };
      if (!next.email && !next.phone) {
        throw new GuestRejection(400, 'VALIDATION_ERROR', 'Please correct the highlighted fields.', {
          fields: { contact: 'an email address or phone number is required' },
        });
      }
      // Only identifiers that actually change are checked against other guests.
      const changedIdentity = {
        email: changed.includes('email') ? next.email : null,
        phone: changed.includes('phone') ? next.phone : null,
        nic: changed.includes('nic') ? next.nic : null,
      };
      const rejection = duplicateRejection(
        await findGuestIdentityMatches(client, changedIdentity, guestId),
        input.value!.confirmNotDuplicate,
      );
      if (rejection) throw rejection;

      const updated = await client.query<GuestRow>(
        `UPDATE guest g
            SET full_name = $2, email = $3, phone = $4, nic = $5, updated_at = CURRENT_TIMESTAMP
          WHERE g.guest_id = $1
      RETURNING ${GUEST_COLUMNS}`,
        [guestId, next.fullName, next.email, next.phone, next.nic],
      );
      const pick = (source: GuestProfileFields) => Object.fromEntries(changed.map((key) => [key, source[key]]));
      await appendAudit(client, {
        userId: actorId,
        entityName: 'guest',
        entityId: guestId,
        action: 'UPDATE',
        before: pick(currentFields),
        after: pick(next),
        ipAddress: req.ip,
      });
      return { status: 200, data: toView(updated.rows[0]) };
    });
  }

  function setActive(active: boolean) {
    // POST /api/guests/:guestId/deactivate and /reactivate, body { reason? }.
    return async (req: Request, res: Response): Promise<void> => {
      res.set('Cache-Control', 'no-store');
      const guestId = guestIdParam(req);
      if (!guestId) {
        sendError(res, 404, 'GUEST_NOT_FOUND', 'Guest not found.');
        return;
      }
      const errors: Record<string, string> = {};
      const record = asRecord(req.body ?? {});
      let reason: string | null = null;
      if (!record) errors.body = 'must be a JSON object';
      else {
        rejectUnknown(record, new Set(['reason']), errors);
        if (record.reason !== undefined && record.reason !== null) {
          if (typeof record.reason !== 'string') errors.reason = 'must be a string';
          else if (record.reason.trim().length > REASON_MAX_LENGTH) errors.reason = `must be at most ${REASON_MAX_LENGTH} characters`;
          else reason = record.reason.trim() || null;
        }
      }
      if (Object.keys(errors).length > 0) {
        validationError(res, errors);
        return;
      }
      const actorId = req.user!.userId;
      await inTransaction(res, async (client) => {
        const current = await loadForUpdate(client, guestId);
        if (current.active === active) {
          throw new GuestRejection(
            409,
            active ? 'GUEST_ALREADY_ACTIVE' : 'GUEST_ALREADY_INACTIVE',
            active ? 'This guest profile is already active.' : 'This guest profile is already deactivated.',
          );
        }
        if (!active) {
          const open = await client.query<{ n: number }>(
            `SELECT count(DISTINCT b.booking_id)::int AS n
               FROM booking b
               JOIN booking_room_line l ON l.booking_id = b.booking_id
              WHERE b.guest_id = $1 AND l.status IN ('BOOKED', 'CHECKED_IN')`,
            [guestId],
          );
          if (open.rows[0].n > 0) {
            throw new GuestRejection(
              409,
              'GUEST_HAS_OPEN_BOOKINGS',
              'This guest has upcoming or in-house bookings. Complete or cancel them before deactivating.',
              { openBookings: open.rows[0].n },
            );
          }
        }
        const updated = await client.query<GuestRow>(
          `UPDATE guest g SET active = $2, updated_at = CURRENT_TIMESTAMP
            WHERE g.guest_id = $1
        RETURNING ${GUEST_COLUMNS}`,
          [guestId, active],
        );
        await appendAudit(client, {
          userId: actorId,
          entityName: 'guest',
          entityId: guestId,
          action: active ? 'REACTIVATE' : 'DEACTIVATE',
          before: { active: !active },
          after: { active, reason },
          ipAddress: req.ip,
        });
        return { status: 200, data: toView(updated.rows[0]) };
      });
    };
  }

  return { search, get, create, update, deactivate: setActive(false), reactivate: setActive(true) };
}

export type GuestProfileService = ReturnType<typeof createGuestProfiles>;
