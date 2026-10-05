import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { Pool, PoolClient } from 'pg';
import { appendAudit } from './audit';
import { PasswordPolicyError, SYSTEM_PRINCIPAL_USER_ID, hashPassword } from './auth';

// M1-S10 online guest registration and verified guest_account linking
// (SRS §4.1, FR-017/081/083, AT-15). Two paths:
//  - New guest: creates user_account + guest + guest_account together. It is
//    refused when the email, phone or NIC already belongs to a guest profile,
//    so nobody can create a duplicate of, or attach to, someone else's profile.
//  - Existing guest: requires a link code that FRONT_DESK issues after checking
//    the guest's identity in person or by phone. The code is HMAC-signed,
//    bound to one guest_id and expires; it is effectively single-use because
//    guest_account.guest_id is unique. Nothing about the code is stored.
// A registered account is never an officer (fresh user_account plus the
// m1_003 disjointness triggers), so a guest session gains no staff powers.

type Queryable = Pick<PoolClient, 'query'>;
export type RegistrationDb = Queryable & Pick<Pool, 'connect'>;

export const LINK_CODE_TTL_SECONDS = 24 * 60 * 60;
export const REGISTRATION_FAILURE_LIMIT = 10;
export const REGISTRATION_FAILURE_WINDOW_MINUTES = 15;

const SECRET_MIN_LENGTH = 32;
const LINK_CODE_VERSION = 1;
const NONCE_BYTES = 6;
const MAC_BYTES = 16;
const PAYLOAD_BYTES = 1 + 16 + 4 + NONCE_BYTES;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USERNAME_PATTERN = /^[A-Za-z0-9._@-]{3,64}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;
const PASSWORD_INPUT_MAX_LENGTH = 1024;
const NAME_MAX_LENGTH = 255;

// ---------------------------------------------------------------------------
// Link codes

export interface LinkCodePayload {
  guestId: string;
  expiresAt: number; // Unix seconds
  codeId: string; // hex nonce, recorded in audit evidence to trace issuance to use
}

function linkMac(secret: string, payload: Buffer): Buffer {
  return createHmac('sha256', secret)
    .update('skynest-guest-link.v1.')
    .update(payload)
    .digest()
    .subarray(0, MAC_BYTES);
}

export function issueLinkCode(secret: string, guestId: string, nowSeconds: number, ttlSeconds = LINK_CODE_TTL_SECONDS) {
  if (!UUID_PATTERN.test(guestId)) throw new Error('guestId must be a UUID.');
  const nonce = randomBytes(NONCE_BYTES);
  const expiresAt = nowSeconds + ttlSeconds;
  const payload = Buffer.alloc(PAYLOAD_BYTES);
  payload.writeUInt8(LINK_CODE_VERSION, 0);
  Buffer.from(guestId.replace(/-/g, ''), 'hex').copy(payload, 1);
  payload.writeUInt32BE(expiresAt, 17);
  nonce.copy(payload, 21);
  const code = Buffer.concat([payload, linkMac(secret, payload)]).toString('base64url');
  return { code, guestId: guestId.toLowerCase(), expiresAt, codeId: nonce.toString('hex') };
}

export type LinkCodeResult =
  | { status: 'VALID'; payload: LinkCodePayload }
  | { status: 'INVALID' | 'EXPIRED' };

export function verifyLinkCode(secret: string, code: string, nowSeconds: number): LinkCodeResult {
  const compact = code.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9_-]+$/.test(compact)) return { status: 'INVALID' };
  const raw = Buffer.from(compact, 'base64url');
  if (raw.length !== PAYLOAD_BYTES + MAC_BYTES) return { status: 'INVALID' };
  const payload = raw.subarray(0, PAYLOAD_BYTES);
  const mac = raw.subarray(PAYLOAD_BYTES);
  if (!timingSafeEqual(mac, linkMac(secret, payload))) return { status: 'INVALID' };
  if (payload.readUInt8(0) !== LINK_CODE_VERSION) return { status: 'INVALID' };
  const hex = payload.subarray(1, 17).toString('hex');
  const guestId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const expiresAt = payload.readUInt32BE(17);
  if (nowSeconds >= expiresAt) return { status: 'EXPIRED' };
  return { status: 'VALID', payload: { guestId, expiresAt, codeId: payload.subarray(21).toString('hex') } };
}

// ---------------------------------------------------------------------------
// Input validation

interface AccountFields {
  username: string;
  password: string;
}

export type RegistrationInput =
  | ({ mode: 'LINK'; linkCode: string } & AccountFields)
  | ({
      mode: 'NEW';
      fullName: string;
      email: string | null;
      phone: string | null;
      nic: string | null;
    } & AccountFields);

function optionalString(record: Record<string, unknown>, key: string, errors: Record<string, string>): string | null {
  const value = record[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    errors[key] = 'must be a string';
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

// Phone numbers are compared and stored as digits with an optional leading +,
// so "077 123-4567" and "0771234567" are the same contact.
export function normalizePhone(value: string): string {
  return value.replace(/[\s().-]/g, '');
}

export function validateRegistrationInput(body: unknown): { value?: RegistrationInput; errors?: Record<string, string> } {
  const errors: Record<string, string> = {};
  const record = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>;

  const username = typeof record.username === 'string' ? record.username.trim() : '';
  if (!username) errors.username = 'is required';
  else if (!USERNAME_PATTERN.test(username)) {
    errors.username = 'must be 3-64 characters using letters, digits, ".", "_", "@" or "-"';
  }

  const password = typeof record.password === 'string' ? record.password : '';
  if (!password) errors.password = 'is required';
  else if (password.length > PASSWORD_INPUT_MAX_LENGTH) errors.password = 'is too long';

  const linkCode = optionalString(record, 'linkCode', errors);
  if (linkCode !== null) {
    if (Object.keys(errors).length > 0) return { errors };
    // Profile details come from the verified existing guest, never the request.
    return { value: { mode: 'LINK', username, password, linkCode } };
  }

  const fullName = optionalString(record, 'fullName', errors);
  if (!fullName && !errors.fullName) errors.fullName = 'is required';
  else if (fullName && fullName.length > NAME_MAX_LENGTH) errors.fullName = `must be at most ${NAME_MAX_LENGTH} characters`;

  const emailRaw = optionalString(record, 'email', errors);
  const email = emailRaw ? emailRaw.toLowerCase() : null;
  if (email && (email.length > NAME_MAX_LENGTH || !EMAIL_PATTERN.test(email))) errors.email = 'must be a valid email address';

  const phoneRaw = optionalString(record, 'phone', errors);
  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
  if (phone && !PHONE_PATTERN.test(phone)) errors.phone = 'must be 7-15 digits with an optional leading +';

  // FR-017: at least one usable contact method.
  if (!email && !phone && !errors.email && !errors.phone) errors.contact = 'an email address or phone number is required';

  // FR-018 leaves NIC format validation to a team decision; only normalize.
  const nicRaw = optionalString(record, 'nic', errors);
  const nic = nicRaw ? nicRaw.toUpperCase() : null;
  if (nic && nic.length > NAME_MAX_LENGTH) errors.nic = `must be at most ${NAME_MAX_LENGTH} characters`;

  if (Object.keys(errors).length > 0) return { errors };
  return { value: { mode: 'NEW', username, password, fullName: fullName as string, email, phone, nic } };
}

// ---------------------------------------------------------------------------
// Service

export interface GuestRegistrationOptions {
  db: RegistrationDb;
  secret: string;
  // Test seams.
  now?: () => number;
  bcryptCost?: number;
}

class RegistrationRejection extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly auditReason?: string,
  ) {
    super(message);
  }
}

const PROFILE_EXISTS_MESSAGE =
  'These details match an existing guest profile. Ask the front desk for a link code to connect it to an online account.';
const INVALID_CODE_MESSAGE = 'This link code is invalid or has expired. Ask the front desk for a new one.';

function sendError(res: Response, status: number, code: string, message: string, extra?: object) {
  res.status(status).json({ error: { code, message, ...extra } });
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const pg = error as { code?: string; constraint?: string };
  return pg?.code === '23505' && pg.constraint === constraint;
}

export function createGuestRegistration(options: GuestRegistrationOptions) {
  if (typeof options.secret !== 'string' || options.secret.length < SECRET_MIN_LENGTH) {
    throw new Error(`SESSION_SECRET must be at least ${SECRET_MIN_LENGTH} characters.`);
  }
  const { db, secret } = options;
  const nowSeconds = () => Math.floor((options.now ?? Date.now)() / 1000);

  // Failed attempts (matching profile, bad/expired/used code) are audited per
  // client IP and limited so the 409 cannot be used to enumerate guests.
  async function lockAndCountFailures(client: Queryable, ipKey: string): Promise<number> {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`guest-registration:${ipKey}`]);
    const result = await client.query<{ failures: number }>(
      `SELECT count(*)::int AS failures
         FROM audit_log
        WHERE entity_name = 'guest_registration'
          AND entity_id = $1
          AND action = 'CREATE'
          AND changed_at > now() - make_interval(mins => $2)
          AND (CASE WHEN after_value IS JSON OBJECT THEN after_value::jsonb ->> 'outcome' END) = 'FAILED'
          AND (CASE WHEN after_value IS JSON OBJECT THEN after_value::jsonb ->> 'reason' END) <> 'THROTTLED'`,
      [ipKey, REGISTRATION_FAILURE_WINDOW_MINUTES],
    );
    return result.rows[0].failures;
  }

  async function auditFailure(client: Queryable, ipKey: string, reason: string, username: string, ip?: string) {
    await appendAudit(client, {
      userId: SYSTEM_PRINCIPAL_USER_ID,
      entityName: 'guest_registration',
      entityId: ipKey,
      action: 'CREATE',
      after: { outcome: 'FAILED', reason, username },
      ipAddress: ip,
    });
  }

  // Usernames are compared case-insensitively so "Alice" cannot impersonate "alice".
  async function createUserAccount(client: Queryable, username: string, passwordHash: string): Promise<string> {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`username:${username.toLowerCase()}`]);
    const taken = await client.query('SELECT 1 FROM user_account WHERE lower(username) = lower($1)', [username]);
    if (taken.rowCount) throw new RegistrationRejection(409, 'USERNAME_TAKEN', 'That username is already taken.');
    try {
      const inserted = await client.query<{ user_id: string }>(
        'INSERT INTO user_account (username, password_hash) VALUES ($1, $2) RETURNING user_id',
        [username, passwordHash],
      );
      return inserted.rows[0].user_id;
    } catch (error) {
      if (isUniqueViolation(error, 'user_account_username_unique')) {
        throw new RegistrationRejection(409, 'USERNAME_TAKEN', 'That username is already taken.');
      }
      throw error;
    }
  }

  async function linkAccount(client: Queryable, guestId: string, userId: string): Promise<string> {
    try {
      const link = await client.query<{ guest_account_id: string }>(
        'INSERT INTO guest_account (guest_id, user_id) VALUES ($1, $2) RETURNING guest_account_id',
        [guestId, userId],
      );
      return link.rows[0].guest_account_id;
    } catch (error) {
      if (isUniqueViolation(error, 'guest_account_guest_id_unique')) {
        throw new RegistrationRejection(409, 'LINK_CODE_USED', INVALID_CODE_MESSAGE, 'ALREADY_LINKED');
      }
      throw error;
    }
  }

  async function registerNew(client: Queryable, input: Extract<RegistrationInput, { mode: 'NEW' }>, passwordHash: string) {
    // Serialize registrations that share any identifier (sorted, so two
    // requests cannot deadlock), then refuse a match with an existing profile.
    const keys = [
      input.email && `email:${input.email}`,
      input.phone && `phone:${input.phone}`,
      input.nic && `nic:${input.nic}`,
    ]
      .filter((key): key is string => Boolean(key))
      .sort();
    for (const key of keys) {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`guest-identity:${key}`]);
    }
    const existing = await client.query(
      `SELECT 1 FROM guest
        WHERE ($1::text IS NOT NULL AND lower(btrim(email)) = $1)
           OR ($2::text IS NOT NULL AND regexp_replace(phone, '[\\s().-]', '', 'g') = $2)
           OR ($3::text IS NOT NULL AND nic = $3)
        LIMIT 1`,
      [input.email, input.phone, input.nic],
    );
    if (existing.rowCount) {
      throw new RegistrationRejection(409, 'PROFILE_EXISTS', PROFILE_EXISTS_MESSAGE, 'PROFILE_EXISTS');
    }

    const userId = await createUserAccount(client, input.username, passwordHash);
    const guest = await client.query<{ guest_id: string }>(
      'INSERT INTO guest (full_name, email, phone, nic) VALUES ($1, $2, $3, $4) RETURNING guest_id',
      [input.fullName, input.email, input.phone, input.nic],
    );
    const guestId = guest.rows[0].guest_id;
    const guestAccountId = await linkAccount(client, guestId, userId);
    return { userId, guestId, guestAccountId, guestCreated: true };
  }

  async function registerLink(client: Queryable, input: Extract<RegistrationInput, { mode: 'LINK' }>, passwordHash: string) {
    const verified = verifyLinkCode(secret, input.linkCode, nowSeconds());
    if (verified.status !== 'VALID') {
      throw new RegistrationRejection(400, 'INVALID_LINK_CODE', INVALID_CODE_MESSAGE, `CODE_${verified.status}`);
    }
    const { guestId, codeId } = verified.payload;
    const guest = await client.query<{ active: boolean; linked: boolean }>(
      `SELECT g.active, EXISTS (SELECT 1 FROM guest_account ga WHERE ga.guest_id = g.guest_id) AS linked
         FROM guest g WHERE g.guest_id = $1 FOR UPDATE`,
      [guestId],
    );
    const row = guest.rows[0];
    if (!row || !row.active) {
      throw new RegistrationRejection(400, 'INVALID_LINK_CODE', INVALID_CODE_MESSAGE, 'GUEST_UNAVAILABLE');
    }
    if (row.linked) throw new RegistrationRejection(409, 'LINK_CODE_USED', INVALID_CODE_MESSAGE, 'ALREADY_LINKED');

    const userId = await createUserAccount(client, input.username, passwordHash);
    const guestAccountId = await linkAccount(client, guestId, userId);
    return { userId, guestId, guestAccountId, guestCreated: false, codeId };
  }

  // POST /api/auth/register (public). The client signs in afterwards through
  // /api/auth/login, which keeps throttling and LOGIN audit in one place.
  async function register(req: Request, res: Response): Promise<void> {
    res.set('Cache-Control', 'no-store');
    const input = validateRegistrationInput(req.body);
    if (!input.value) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Please correct the highlighted fields.', { fields: input.errors });
      return;
    }
    const value = input.value;
    let passwordHash: string;
    try {
      passwordHash = await hashPassword(value.password, options.bcryptCost);
    } catch (error) {
      if (error instanceof PasswordPolicyError) {
        sendError(res, 400, 'VALIDATION_ERROR', 'Please correct the highlighted fields.', {
          fields: { password: error.message },
        });
        return;
      }
      sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred.');
      return;
    }

    const ip = req.ip;
    const ipKey = ip || 'unknown';
    let client: PoolClient | undefined;
    try {
      client = await db.connect();
      await client.query('BEGIN');
      if ((await lockAndCountFailures(client, ipKey)) >= REGISTRATION_FAILURE_LIMIT) {
        await auditFailure(client, ipKey, 'THROTTLED', value.username, ip);
        await client.query('COMMIT');
        res.set('Retry-After', String(REGISTRATION_FAILURE_WINDOW_MINUTES * 60));
        sendError(res, 429, 'TOO_MANY_ATTEMPTS', 'Too many unsuccessful attempts. Please try again later.');
        return;
      }

      await client.query('SAVEPOINT registration');
      let result: Awaited<ReturnType<typeof registerNew>> & { codeId?: string };
      try {
        result = value.mode === 'NEW'
          ? await registerNew(client, value, passwordHash)
          : await registerLink(client, value, passwordHash);
      } catch (error) {
        if (!(error instanceof RegistrationRejection)) throw error;
        await client.query('ROLLBACK TO SAVEPOINT registration');
        if (error.auditReason) await auditFailure(client, ipKey, error.auditReason, value.username, ip);
        await client.query('COMMIT');
        sendError(res, error.status, error.code, error.message);
        return;
      }

      const { userId, guestId, guestAccountId, guestCreated, codeId } = result;
      await appendAudit(client, {
        userId,
        entityName: 'user_account',
        entityId: userId,
        action: 'CREATE',
        after: { username: value.username, kind: 'GUEST' },
        ipAddress: ip,
      });
      if (guestCreated && value.mode === 'NEW') {
        await appendAudit(client, {
          userId,
          entityName: 'guest',
          entityId: guestId,
          action: 'CREATE',
          after: { fullName: value.fullName, email: value.email, phone: value.phone, nic: value.nic, source: 'ONLINE_REGISTRATION' },
          ipAddress: ip,
        });
      }
      await appendAudit(client, {
        userId,
        entityName: 'guest_account',
        entityId: guestAccountId,
        action: 'CREATE',
        after: { guestId, userId, verification: guestCreated ? 'NEW_PROFILE' : 'LINK_CODE', codeId: codeId ?? null },
        ipAddress: ip,
      });
      await client.query('COMMIT');
      res.status(201).json({
        data: { userId, username: value.username, guestId, linkedExistingProfile: !guestCreated },
      });
    } catch {
      if (client) await client.query('ROLLBACK').catch(() => undefined);
      sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred.');
    } finally {
      client?.release();
    }
  }

  // POST /api/guests/:guestId/link-code (FRONT_DESK, guest.link.issue). Staff
  // must check the guest's identity before handing over the code.
  async function issueCode(req: Request, res: Response): Promise<void> {
    res.set('Cache-Control', 'no-store');
    const guestId = String(req.params.guestId ?? '');
    if (!UUID_PATTERN.test(guestId)) {
      sendError(res, 404, 'GUEST_NOT_FOUND', 'Guest not found.');
      return;
    }
    const actorId = req.user?.userId;
    if (!actorId) {
      sendError(res, 401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.');
      return;
    }
    let client: PoolClient | undefined;
    try {
      client = await db.connect();
      await client.query('BEGIN');
      const guest = await client.query<{ active: boolean; linked: boolean }>(
        `SELECT g.active, EXISTS (SELECT 1 FROM guest_account ga WHERE ga.guest_id = g.guest_id) AS linked
           FROM guest g WHERE g.guest_id = $1 FOR SHARE`,
        [guestId],
      );
      const row = guest.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        sendError(res, 404, 'GUEST_NOT_FOUND', 'Guest not found.');
        return;
      }
      if (!row.active) {
        await client.query('ROLLBACK');
        sendError(res, 409, 'GUEST_INACTIVE', 'This guest profile is deactivated.');
        return;
      }
      if (row.linked) {
        await client.query('ROLLBACK');
        sendError(res, 409, 'GUEST_ALREADY_LINKED', 'This guest profile already has an online account.');
        return;
      }
      const issued = issueLinkCode(secret, guestId, nowSeconds());
      await appendAudit(client, {
        userId: actorId,
        entityName: 'guest_link_code',
        entityId: issued.guestId,
        action: 'CREATE',
        after: { guestId: issued.guestId, codeId: issued.codeId, expiresAt: new Date(issued.expiresAt * 1000).toISOString() },
        ipAddress: req.ip,
      });
      await client.query('COMMIT');
      res.status(201).json({
        data: { guestId: issued.guestId, linkCode: issued.code, expiresAt: new Date(issued.expiresAt * 1000).toISOString() },
      });
    } catch {
      if (client) await client.query('ROLLBACK').catch(() => undefined);
      sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred.');
    } finally {
      client?.release();
    }
  }

  return { register, issueCode };
}

export type GuestRegistrationService = ReturnType<typeof createGuestRegistration>;

export function createGuestRegistrationFromEnv(db: RegistrationDb, env: NodeJS.ProcessEnv = process.env) {
  return createGuestRegistration({ db, secret: env.SESSION_SECRET ?? '' });
}
