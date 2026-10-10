import { createHmac, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { CookieOptions, NextFunction, Request, Response } from 'express';
import type { Pool, PoolClient } from 'pg';
import { appendAudit } from './audit';
import { getSystemConfig } from './systemConfig';

// M1-S08 staff/online-guest authentication (SRS §4.1, FR-001/005/006/081,
// NFR-009/012/014). Sessions are stateless HMAC-signed cookies that carry only
// the account ID and timestamps; role, branch and guest scope are re-read from
// the database on every request so disabled accounts and role changes apply
// immediately. A password change invalidates existing cookies through a keyed
// fingerprint of the stored hash. Logout clears the browser cookie and is
// audited; a copied cookie stays usable until its idle/absolute expiry because
// no server-side session row exists.

type Queryable = Pick<PoolClient, 'query'>;
export type AuthDb = Queryable & Pick<Pool, 'connect'>;

export const SESSION_COOKIE_NAME = 'skynest_session';
export const SESSION_IDLE_CONFIG_KEY = 'session_idle_timeout_minutes';
export const DEFAULT_SESSION_IDLE_MINUTES = 30;
export const DEFAULT_SESSION_ABSOLUTE_HOURS = 12;
export const LOGIN_FAILURE_LIMIT = 5;
export const LOGIN_FAILURE_WINDOW_MINUTES = 15;
export const BCRYPT_COST = 12;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_BYTES = 72;
export const SYSTEM_PRINCIPAL_USER_ID = '01a0d81b-502c-7c85-95b8-401c6323f1db';

const SESSION_SECRET_MIN_LENGTH = 32;
const USERNAME_MAX_LENGTH = 255;
const LOGIN_PASSWORD_MAX_LENGTH = 1024;
const IDLE_CONFIG_CACHE_MS = 60_000;
const COOKIE_REFRESH_AFTER_SECONDS = 60;
// Compared against when the username is unknown so response timing does not
// reveal whether an account exists. Same cost as real hashes.
const DUMMY_PASSWORD_HASH = '$2b$12$rw.UwR1mlOuWfsofXwuPCOue51X5L/cSJHAHfOqmi.LafTXemny9C';

export type PrincipalKind = 'STAFF' | 'GUEST';

export interface AuthPrincipal {
  userId: string;
  username: string;
  kind: PrincipalKind;
  role?: string;
  branchId?: string;
  guestId?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthPrincipal;
    }
  }
}

export class PasswordPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PasswordPolicyError';
  }
}

// Strong one-way hash with a per-password salt (NFR-009). bcrypt ignores bytes
// beyond 72, so longer passwords are rejected rather than silently truncated.
export async function hashPassword(password: string, cost: number = BCRYPT_COST): Promise<string> {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    throw new PasswordPolicyError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    throw new PasswordPolicyError(`Password must be at most ${PASSWORD_MAX_BYTES} bytes.`);
  }
  return bcrypt.hash(password, cost);
}

interface AccountRow {
  user_id: string;
  username: string;
  password_hash: string | null;
  account_active: boolean;
  officer_id: string | null;
  officer_active: boolean | null;
  branch_id: string | null;
  role_name: string | null;
  guest_id: string | null;
  guest_active: boolean | null;
}

const ACCOUNT_SELECT = `
  SELECT ua.user_id, ua.username, ua.password_hash, ua.active AS account_active,
         o.officer_id, o.active AS officer_active, o.branch_id, r.role_name,
         ga.guest_id, g.active AS guest_active
    FROM user_account ua
    LEFT JOIN officer o ON o.officer_id = ua.user_id
    LEFT JOIN role r ON r.role_id = o.role_id
    LEFT JOIN guest_account ga ON ga.user_id = ua.user_id
    LEFT JOIN guest g ON g.guest_id = ga.guest_id`;

async function findAccountByUsername(db: Queryable, username: string): Promise<AccountRow | null> {
  const result = await db.query<AccountRow>(`${ACCOUNT_SELECT} WHERE ua.username = $1`, [username]);
  return result.rows[0] ?? null;
}

async function findAccountById(db: Queryable, userId: string): Promise<AccountRow | null> {
  const result = await db.query<AccountRow>(`${ACCOUNT_SELECT} WHERE ua.user_id = $1`, [userId]);
  return result.rows[0] ?? null;
}

type AccountState =
  | { status: 'ACTIVE'; principal: AuthPrincipal }
  | { status: 'DISABLED' | 'NO_PROFILE' };

// A staff session comes only from officer; a guest session only from
// guest_account, so a guest never gains officer scope (FR-081).
function evaluateAccount(account: AccountRow): AccountState {
  if (account.officer_id) {
    if (!account.account_active || account.officer_active !== true) return { status: 'DISABLED' };
    return {
      status: 'ACTIVE',
      principal: {
        userId: account.user_id,
        username: account.username,
        kind: 'STAFF',
        role: account.role_name ?? undefined,
        branchId: account.branch_id ?? undefined,
      },
    };
  }
  if (account.guest_id) {
    if (!account.account_active || account.guest_active !== true) return { status: 'DISABLED' };
    return {
      status: 'ACTIVE',
      principal: {
        userId: account.user_id,
        username: account.username,
        kind: 'GUEST',
        guestId: account.guest_id,
      },
    };
  }
  return { status: 'NO_PROFILE' };
}

interface SessionPayload {
  v: 1;
  sub: string;
  iat: number;
  seen: number;
  pwd: string;
}

function base64url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url');
}

function sign(secret: string, body: string): string {
  return createHmac('sha256', secret).update(`skynest-session.v1.${body}`).digest('base64url');
}

function passwordFingerprint(secret: string, passwordHash: string): string {
  return createHmac('sha256', secret).update(`pwd.${passwordHash}`).digest('base64url').slice(0, 22);
}

function encodeSession(secret: string, payload: SessionPayload): string {
  const body = base64url(JSON.stringify(payload));
  return `${body}.${sign(secret, body)}`;
}

function decodeSession(secret: string, token: string): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [body, signature] = parts;
  const expected = Buffer.from(sign(secret, body));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (
      payload?.v !== 1 ||
      typeof payload.sub !== 'string' ||
      !Number.isInteger(payload.iat) ||
      !Number.isInteger(payload.seen) ||
      typeof payload.pwd !== 'string'
    ) {
      return null;
    }
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      const value = part.slice(index + 1).trim();
      try {
        return decodeURIComponent(value);
      } catch {
        return null;
      }
    }
  }
  return null;
}

export interface LoginInput {
  username: string;
  password: string;
}

export function validateLoginInput(body: unknown): { value?: LoginInput; errors?: Record<string, string> } {
  const errors: Record<string, string> = {};
  const record = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const username = typeof record.username === 'string' ? record.username.trim() : '';
  const password = typeof record.password === 'string' ? record.password : '';
  if (!username) errors.username = 'is required';
  else if (username.length > USERNAME_MAX_LENGTH) errors.username = `must be at most ${USERNAME_MAX_LENGTH} characters`;
  if (!password) errors.password = 'is required';
  else if (password.length > LOGIN_PASSWORD_MAX_LENGTH) errors.password = `must be at most ${LOGIN_PASSWORD_MAX_LENGTH} characters`;
  if (Object.keys(errors).length > 0) return { errors };
  return { value: { username, password } };
}

export interface AuthOptions {
  db: AuthDb;
  secret: string;
  cookieSecure?: boolean;
  absoluteHours?: number;
  // Test seams; production uses the wall clock and system_config.
  now?: () => number;
  idleMinutes?: () => Promise<number>;
}

type SessionResult =
  | { status: 'VALID'; principal: AuthPrincipal; payload: SessionPayload; idleMinutes: number }
  | { status: 'MISSING' | 'INVALID' | 'EXPIRED' };

function sendError(res: Response, status: number, code: string, message: string, extra?: object) {
  res.status(status).json({ error: { code, message, ...extra } });
}

export function createAuth(options: AuthOptions) {
  if (typeof options.secret !== 'string' || options.secret.length < SESSION_SECRET_MIN_LENGTH) {
    throw new Error(`SESSION_SECRET must be at least ${SESSION_SECRET_MIN_LENGTH} characters.`);
  }
  const { db, secret } = options;
  const cookieSecure = options.cookieSecure ?? true;
  const absoluteSeconds = Math.round((options.absoluteHours ?? DEFAULT_SESSION_ABSOLUTE_HOURS) * 3600);
  const nowSeconds = () => Math.floor((options.now ?? Date.now)() / 1000);

  let idleCache: { value: number; expires: number } | null = null;
  const readIdleMinutes =
    options.idleMinutes ??
    (async () => {
      const now = Date.now();
      if (idleCache && idleCache.expires > now) return idleCache.value;
      const entry = await getSystemConfig(db, SESSION_IDLE_CONFIG_KEY);
      const parsed = entry ? Number(entry.configValue) : NaN;
      const value =
        Number.isInteger(parsed) && parsed >= 1 && parsed <= 999 ? parsed : DEFAULT_SESSION_IDLE_MINUTES;
      idleCache = { value, expires: now + IDLE_CONFIG_CACHE_MS };
      return value;
    });

  function cookieOptions(maxAgeSeconds: number): CookieOptions {
    return {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: 'strict',
      path: '/',
      maxAge: Math.max(0, maxAgeSeconds) * 1000,
    };
  }

  function clearSessionCookie(res: Response) {
    res.clearCookie(SESSION_COOKIE_NAME, { httpOnly: true, secure: cookieSecure, sameSite: 'strict', path: '/' });
  }

  function issueCookie(res: Response, payload: SessionPayload, idleMinutes: number) {
    const remainingAbsolute = payload.iat + absoluteSeconds - payload.seen;
    const maxAge = Math.min(idleMinutes * 60, remainingAbsolute);
    res.cookie(SESSION_COOKIE_NAME, encodeSession(secret, payload), cookieOptions(maxAge));
  }

  async function resolveSession(req: Request): Promise<SessionResult> {
    const token = readCookie(req, SESSION_COOKIE_NAME);
    if (!token) return { status: 'MISSING' };
    const payload = decodeSession(secret, token);
    if (!payload) return { status: 'INVALID' };

    const now = nowSeconds();
    const idleMinutes = await readIdleMinutes();
    if (payload.seen > now + 60 || payload.iat > payload.seen) return { status: 'INVALID' };
    if (now - payload.seen > idleMinutes * 60 || now - payload.iat > absoluteSeconds) {
      return { status: 'EXPIRED' };
    }

    const account = await findAccountById(db, payload.sub);
    if (!account || !account.password_hash) return { status: 'INVALID' };
    if (passwordFingerprint(secret, account.password_hash) !== payload.pwd) return { status: 'INVALID' };
    const state = evaluateAccount(account);
    if (state.status !== 'ACTIVE') return { status: 'INVALID' };
    return { status: 'VALID', principal: state.principal, payload, idleMinutes };
  }

  // Requires a valid session, attaches req.user and slides the idle window.
  async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const session = await resolveSession(req);
      if (session.status !== 'VALID') {
        if (session.status !== 'MISSING') clearSessionCookie(res);
        if (session.status === 'EXPIRED') {
          sendError(res, 401, 'SESSION_EXPIRED', 'Your session has expired. Please sign in again.');
        } else {
          sendError(res, 401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.');
        }
        return;
      }
      const now = nowSeconds();
      if (now - session.payload.seen >= COOKIE_REFRESH_AFTER_SECONDS) {
        issueCookie(res, { ...session.payload, seen: now }, session.idleMinutes);
      }
      req.user = session.principal;
      next();
    } catch {
      sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred.');
    }
  }

  async function auditFailure(
    client: Queryable,
    entity: { entityName: string; entityId: string },
    reason: 'BAD_CREDENTIALS' | 'DISABLED' | 'NO_PROFILE' | 'THROTTLED',
    username: string,
    ipAddress: string | undefined,
  ) {
    await appendAudit(client, {
      userId: SYSTEM_PRINCIPAL_USER_ID,
      entityName: entity.entityName,
      entityId: entity.entityId,
      action: 'LOGIN',
      after: { outcome: 'FAILED', reason, username },
      ipAddress,
    });
  }

  async function login(req: Request, res: Response): Promise<void> {
    res.set('Cache-Control', 'no-store');
    const input = validateLoginInput(req.body);
    if (!input.value) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Username and password are required.', { fields: input.errors });
      return;
    }
    const { username, password } = input.value;
    const ipAddress = req.ip;

    let client: PoolClient | undefined;
    try {
      client = await db.connect();
      await client.query('BEGIN');
      const account = await findAccountByUsername(client, username);
      // Failures for a known account are keyed by its ID; unknown usernames are
      // keyed by the submitted name so guessing is throttled too.
      const entity = account
        ? { entityName: 'user_account', entityId: account.user_id }
        : { entityName: 'login_attempt', entityId: username };

      // Serialize attempts per key so concurrent guesses cannot exceed the limit.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `login:${entity.entityName}:${entity.entityId}`,
      ]);

      const failures = await client.query<{ failures: number }>(
        `SELECT count(*)::int AS failures
           FROM audit_log a
          WHERE a.action = 'LOGIN'
            AND a.entity_name = $1
            AND a.entity_id = $2
            AND a.changed_at > now() - make_interval(mins => $3)
            AND (CASE WHEN a.after_value IS JSON OBJECT
                      THEN a.after_value::jsonb ->> 'reason' END) = 'BAD_CREDENTIALS'
            AND a.changed_at > COALESCE((
                  SELECT max(s.changed_at)
                    FROM audit_log s
                   WHERE s.action = 'LOGIN'
                     AND s.entity_name = $1
                     AND s.entity_id = $2
                     AND (CASE WHEN s.after_value IS JSON OBJECT
                               THEN s.after_value::jsonb ->> 'outcome' END) = 'SUCCESS'
                ), '-infinity'::timestamptz)`,
        [entity.entityName, entity.entityId, LOGIN_FAILURE_WINDOW_MINUTES],
      );
      if (failures.rows[0].failures >= LOGIN_FAILURE_LIMIT) {
        await auditFailure(client, entity, 'THROTTLED', username, ipAddress);
        await client.query('COMMIT');
        res.set('Retry-After', String(LOGIN_FAILURE_WINDOW_MINUTES * 60));
        sendError(res, 429, 'TOO_MANY_ATTEMPTS', 'Too many failed sign-in attempts. Please try again later.');
        return;
      }

      const passwordMatches = await bcrypt.compare(password, account?.password_hash ?? DUMMY_PASSWORD_HASH);
      if (!account || !account.password_hash || !passwordMatches) {
        await auditFailure(client, entity, 'BAD_CREDENTIALS', username, ipAddress);
        await client.query('COMMIT');
        sendError(res, 401, 'INVALID_CREDENTIALS', 'Invalid username or password.');
        return;
      }

      const state = evaluateAccount(account);
      if (state.status !== 'ACTIVE') {
        await auditFailure(client, entity, state.status, username, ipAddress);
        await client.query('COMMIT');
        if (state.status === 'DISABLED') {
          sendError(res, 403, 'ACCOUNT_DISABLED', 'This account is disabled. Please contact an administrator.');
        } else {
          sendError(res, 401, 'INVALID_CREDENTIALS', 'Invalid username or password.');
        }
        return;
      }

      await client.query('UPDATE user_account SET last_login_at = clock_timestamp() WHERE user_id = $1', [
        account.user_id,
      ]);
      await appendAudit(client, {
        userId: account.user_id,
        entityName: 'user_account',
        entityId: account.user_id,
        action: 'LOGIN',
        after: { outcome: 'SUCCESS', kind: state.principal.kind, role: state.principal.role ?? null },
        ipAddress,
      });
      const idleMinutes = await readIdleMinutes();
      await client.query('COMMIT');

      // The cookie is issued only after the login evidence is committed.
      const now = nowSeconds();
      issueCookie(
        res,
        { v: 1, sub: account.user_id, iat: now, seen: now, pwd: passwordFingerprint(secret, account.password_hash) },
        idleMinutes,
      );
      res.status(200).json({ user: state.principal, idleTimeoutMinutes: idleMinutes });
    } catch {
      if (client) await client.query('ROLLBACK').catch(() => undefined);
      sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred.');
    } finally {
      client?.release();
    }
  }

  // Always clears the cookie; a valid session also records a LOGOUT audit row.
  async function logout(req: Request, res: Response): Promise<void> {
    res.set('Cache-Control', 'no-store');
    try {
      const session = await resolveSession(req);
      if (session.status === 'VALID') {
        await appendAudit(db, {
          userId: session.principal.userId,
          entityName: 'user_account',
          entityId: session.principal.userId,
          action: 'LOGOUT',
          after: { outcome: 'SUCCESS' },
          ipAddress: req.ip,
        });
      }
      clearSessionCookie(res);
      res.status(204).end();
    } catch {
      sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred.');
    }
  }

  async function currentSession(req: Request, res: Response): Promise<void> {
    res.set('Cache-Control', 'no-store');
    try {
      res.status(200).json({ user: req.user, idleTimeoutMinutes: await readIdleMinutes() });
    } catch {
      sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred.');
    }
  }

  return { authenticate, login, logout, currentSession };
}

export type AuthService = ReturnType<typeof createAuth>;

// Reads SESSION_SECRET (required, never committed; NFR-008),
// SESSION_COOKIE_SECURE (may be "false" only outside production for plain-HTTP
// local development) and SESSION_ABSOLUTE_HOURS.
export function createAuthFromEnv(db: AuthDb, env: NodeJS.ProcessEnv = process.env): AuthService {
  const production = env.NODE_ENV === 'production';
  const insecureCookie = env.SESSION_COOKIE_SECURE === 'false';
  if (insecureCookie && production) {
    throw new Error('SESSION_COOKIE_SECURE cannot be false in production.');
  }
  const absoluteHours = env.SESSION_ABSOLUTE_HOURS ? Number(env.SESSION_ABSOLUTE_HOURS) : undefined;
  if (absoluteHours !== undefined && !(absoluteHours > 0 && absoluteHours <= 168)) {
    throw new Error('SESSION_ABSOLUTE_HOURS must be greater than 0 and at most 168.');
  }
  return createAuth({
    db,
    secret: env.SESSION_SECRET ?? '',
    cookieSecure: !insecureCookie,
    absoluteHours,
  });
}
