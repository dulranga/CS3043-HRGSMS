import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import express from 'express';
import { Client, Pool } from 'pg';
import {
  AuthService,
  LOGIN_FAILURE_LIMIT,
  PasswordPolicyError,
  SESSION_COOKIE_NAME,
  SYSTEM_PRINCIPAL_USER_ID,
  createAuth,
  createAuthFromEnv,
  hashPassword,
  validateLoginInput,
} from '../src/auth';
import { createAuthRouter } from '../src/routes/authRoutes';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const migrationsDir = path.join(__dirname, '..', 'migrations');
const migrations = [
  'm1_001_create_branch_and_role.sql',
  'm1_002_create_user_account_and_officer.sql',
  'm1_003_create_guest_and_guest_account.sql',
  'm1_004_create_audit_log.sql',
  'm1_005_create_billing_policy.sql',
  'm1_006_create_system_config.sql',
  'm1_007_register_session_idle_timeout.sql',
].map((file) => readFileSync(path.join(migrationsDir, file), 'utf8'));

const SECRET = 'test-session-secret-0123456789-abcdefghijklmnop';
const PASSWORD = 'correct-horse-battery';

test('M1-S08 input validation and password hashing', async () => {
  assert.deepEqual(validateLoginInput({ username: '  alice ', password: 'pw' }).value, {
    username: 'alice',
    password: 'pw',
  });
  assert.ok(validateLoginInput({}).errors?.username);
  assert.ok(validateLoginInput({ username: 'a', password: '' }).errors?.password);
  assert.ok(validateLoginInput({ username: 'a'.repeat(256), password: 'x' }).errors?.username);
  assert.ok(validateLoginInput({ username: 1, password: ['x'] }).errors?.password);
  assert.ok(validateLoginInput(null).errors);

  const first = await hashPassword(PASSWORD, 4);
  const second = await hashPassword(PASSWORD, 4);
  assert.notEqual(first, second, 'each hash uses its own salt');
  assert.match(first, /^\$2[aby]\$04\$/);
  assert.ok(!first.includes(PASSWORD));
  assert.equal(await bcrypt.compare(PASSWORD, first), true);
  assert.equal(await bcrypt.compare('wrong-password', first), false);
  await assert.rejects(hashPassword('short', 4), PasswordPolicyError);
  await assert.rejects(hashPassword('x'.repeat(73), 4), PasswordPolicyError);

  const fakeDb = { query: async () => ({ rows: [] }), connect: async () => { throw new Error('unused'); } } as never;
  assert.throws(() => createAuth({ db: fakeDb, secret: 'too-short' }), /SESSION_SECRET/);
  assert.throws(() => createAuthFromEnv(fakeDb, {}), /SESSION_SECRET/);
  assert.throws(
    () => createAuthFromEnv(fakeDb, { SESSION_SECRET: SECRET, NODE_ENV: 'production', SESSION_COOKIE_SECURE: 'false' }),
    /production/,
  );
  assert.throws(() => createAuthFromEnv(fakeDb, { SESSION_SECRET: SECRET, SESSION_ABSOLUTE_HOURS: '0' }), /ABSOLUTE/);
  assert.doesNotThrow(() => createAuthFromEnv(fakeDb, { SESSION_SECRET: SECRET, SESSION_COOKIE_SECURE: 'false' }));
});

test('M1-S08 database failure creates no session and leaks no internals', async () => {
  const failingDb = {
    query: async () => { throw new Error('relation "user_account" does not exist'); },
    connect: async () => { throw new Error('connect ECONNREFUSED 10.0.0.1:5432'); },
  } as never;
  const { baseUrl, close } = await startApp(createAuth({ db: failingDb, secret: SECRET, idleMinutes: async () => 30 }));
  try {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'anyone', password: PASSWORD }),
    });
    assert.equal(response.status, 500);
    assert.equal(response.headers.getSetCookie().length, 0);
    const text = await response.text();
    assert.doesNotMatch(text, /ECONNREFUSED|relation|stack/i);
  } finally {
    await close();
  }
});

async function startApp(auth: AuthService) {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', createAuthRouter(auth));
  app.get('/api/protected', auth.authenticate, (req, res) => {
    res.json({ user: req.user });
  });
  const server: Server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function sessionCookie(response: globalThis.Response): string | null {
  const header = response.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!header) return null;
  return header.split(';')[0].slice(SESSION_COOKIE_NAME.length + 1);
}

function cookieAttributes(response: globalThis.Response): string {
  return response.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`)) ?? '';
}

test('M1-S08 staff/guest login, logout, session expiry, throttling and audit', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const schema = `m1_auth_${randomBytes(8).toString('hex')}`;
  const admin = new Client({ connectionString: process.env.PG_URL });
  await admin.connect();
  let pool: Pool | undefined;
  const closers: Array<() => Promise<void>> = [];

  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET search_path TO "${schema}"`);
    for (const sql of migrations) {
      await admin.query(sql);
    }
    // A transaction-mode pooler (e.g. Neon "-pooler" hosts) rejects search_path
    // startup options and can move session-level SETs between server connections,
    // which would leak test writes into the shared schema. Use the direct endpoint
    // with the scratch schema pinned at connection startup.
    const directUrl = new URL(process.env.PG_URL);
    directUrl.hostname = directUrl.hostname.replace('-pooler.', '.');
    pool = new Pool({ connectionString: directUrl.toString(), options: `-c search_path=${schema}`, max: 12 });
    const pinned = await pool.query('SELECT current_schema() AS schema');
    assert.equal(pinned.rows[0].schema, schema, 'application pool must be isolated to the scratch schema');

    const hash = await hashPassword(PASSWORD, 4);
    const branch = (await admin.query('SELECT branch_id FROM branch ORDER BY name LIMIT 1')).rows[0].branch_id;

    async function createAccount(username: string, active = true, passwordHash: string | null = hash) {
      const result = await admin.query(
        'INSERT INTO user_account (username, password_hash, active) VALUES ($1, $2, $3) RETURNING user_id',
        [username, passwordHash, active],
      );
      return result.rows[0].user_id as string;
    }
    async function createStaff(username: string, role: string, { accountActive = true, officerActive = true } = {}) {
      const userId = await createAccount(username, accountActive);
      await admin.query(
        `INSERT INTO officer (officer_id, full_name, branch_id, role_id, active)
         SELECT $1, $2, $3, role_id, $5 FROM role WHERE role_name = $4`,
        [userId, `Officer ${username}`, branch, role, officerActive],
      );
      return userId;
    }
    async function createGuest(username: string, { accountActive = true, guestActive = true } = {}) {
      const userId = await createAccount(username, accountActive);
      const guest = await admin.query(
        'INSERT INTO guest (full_name, active) VALUES ($1, $2) RETURNING guest_id',
        [`Guest ${username}`, guestActive],
      );
      await admin.query('INSERT INTO guest_account (guest_id, user_id) VALUES ($1, $2)', [
        guest.rows[0].guest_id,
        userId,
      ]);
      return { userId, guestId: guest.rows[0].guest_id as string };
    }

    const frontDesk = await createStaff('fd.colombo', 'FRONT_DESK');
    const sysAdmin = await createStaff('sysadmin', 'SYSTEM_ADMINISTRATOR');
    const guest = await createGuest('guest.one');
    const disabledAccount = await createStaff('disabled.account', 'FRONT_DESK', { accountActive: false });
    await createStaff('disabled.officer', 'BRANCH_MANAGER', { officerActive: false });
    await createGuest('disabled.guest', { guestActive: false });
    const noProfile = await createAccount('no.profile');
    const midSession = await createStaff('mid.session', 'SERVICE_STAFF');
    const pwdChange = await createStaff('pwd.change', 'AUDITOR');
    const throttled = await createStaff('throttle.user', 'FRONT_DESK');
    await createStaff('reset.user', 'FRONT_DESK');
    const racer = await createStaff('race.user', 'FRONT_DESK');

    let clock = Date.parse('2026-10-04T08:00:00Z');
    const auth = createAuth({
      db: pool,
      secret: SECRET,
      now: () => clock,
      idleMinutes: async () => 30,
      absoluteHours: 1,
    });
    const app = await startApp(auth);
    closers.push(app.close);

    async function login(username: string, password = PASSWORD) {
      const response = await fetch(`${app.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      return { response, json: (await response.json()) as any };
    }
    async function call(base: string, pathname: string, cookie?: string | null, method = 'GET') {
      const response = await fetch(`${base}${pathname}`, {
        method,
        headers: cookie ? { cookie: `${SESSION_COOKIE_NAME}=${cookie}` } : {},
      });
      const text = await response.text();
      return { response, json: text ? JSON.parse(text) : null };
    }
    async function loginAudits(entityId: string) {
      const result = await admin.query(
        `SELECT user_id, action, after_value::jsonb AS after, ip_address
           FROM audit_log WHERE entity_id = $1 AND action IN ('LOGIN', 'LOGOUT') ORDER BY changed_at, audit_id`,
        [entityId],
      );
      return result.rows;
    }

    // Validation never touches the database or creates a session.
    const invalid = await login('', '');
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.json.error.code, 'VALIDATION_ERROR');
    assert.equal(sessionCookie(invalid.response), null);

    // Staff login: secure cookie, role/branch scope, last_login_at and audit.
    const staff = await login('fd.colombo');
    assert.equal(staff.response.status, 200);
    assert.deepEqual(staff.json.user, {
      userId: frontDesk,
      username: 'fd.colombo',
      kind: 'STAFF',
      role: 'FRONT_DESK',
      branchId: branch,
    });
    assert.equal(staff.response.headers.get('cache-control'), 'no-store');
    const attrs = cookieAttributes(staff.response);
    assert.match(attrs, /HttpOnly/);
    assert.match(attrs, /Secure/);
    assert.match(attrs, /SameSite=Strict/);
    assert.match(attrs, /Path=\//);
    assert.match(attrs, /Max-Age=1800/);
    const staffCookie = sessionCookie(staff.response);
    assert.ok(staffCookie);
    assert.ok(!staffCookie.includes('FRONT_DESK'), 'role is resolved server-side, not stored in the cookie');
    const lastLogin = await admin.query('SELECT last_login_at FROM user_account WHERE user_id = $1', [frontDesk]);
    assert.ok(lastLogin.rows[0].last_login_at);
    const staffAudit = await loginAudits(frontDesk);
    assert.equal(staffAudit.length, 1);
    assert.equal(staffAudit[0].user_id, frontDesk);
    assert.deepEqual(staffAudit[0].after, { outcome: 'SUCCESS', kind: 'STAFF', role: 'FRONT_DESK' });
    assert.ok(staffAudit[0].ip_address);

    const protectedOk = await call(app.baseUrl, '/api/protected', staffCookie);
    assert.equal(protectedOk.response.status, 200);
    assert.equal(protectedOk.json.user.role, 'FRONT_DESK');
    const session = await call(app.baseUrl, '/api/auth/session', staffCookie);
    assert.equal(session.response.status, 200);
    assert.equal(session.json.user.userId, frontDesk);
    assert.equal(session.json.idleTimeoutMinutes, 30);
    const anonymous = await call(app.baseUrl, '/api/protected');
    assert.equal(anonymous.response.status, 401);
    assert.equal(anonymous.json.error.code, 'AUTHENTICATION_REQUIRED');

    // Guest login gets guest ownership scope and never officer role/branch (FR-081).
    const guestLogin = await login('guest.one');
    assert.equal(guestLogin.response.status, 200);
    assert.deepEqual(guestLogin.json.user, {
      userId: guest.userId,
      username: 'guest.one',
      kind: 'GUEST',
      guestId: guest.guestId,
    });
    const guestSession = await call(app.baseUrl, '/api/protected', sessionCookie(guestLogin.response));
    assert.equal(guestSession.json.user.role, undefined);
    assert.equal(guestSession.json.user.branchId, undefined);

    // Wrong password and unknown username return the same generic failure.
    const wrong = await login('fd.colombo', 'not-the-password');
    const unknown = await login('nobody.here', 'not-the-password');
    for (const failed of [wrong, unknown]) {
      assert.equal(failed.response.status, 401);
      assert.deepEqual(failed.json, {
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' },
      });
      assert.equal(sessionCookie(failed.response), null);
    }
    const wrongAudit = (await loginAudits(frontDesk)).at(-1);
    assert.equal(wrongAudit.user_id, SYSTEM_PRINCIPAL_USER_ID);
    assert.deepEqual(wrongAudit.after, { outcome: 'FAILED', reason: 'BAD_CREDENTIALS', username: 'fd.colombo' });
    const unknownAudit = await admin.query(
      `SELECT entity_name, after_value::jsonb AS after FROM audit_log WHERE entity_id = 'nobody.here'`,
    );
    assert.equal(unknownAudit.rows[0].entity_name, 'login_attempt');
    assert.equal(unknownAudit.rows[0].after.reason, 'BAD_CREDENTIALS');
    const leaked = await admin.query(`SELECT count(*)::int AS n FROM audit_log WHERE after_value LIKE '%not-the-password%' OR after_value LIKE $1`, [`%${PASSWORD}%`]);
    assert.equal(leaked.rows[0].n, 0, 'passwords never reach the audit log');

    // The non-login system principal and profile-less accounts cannot sign in.
    const system = await login('system');
    assert.equal(system.response.status, 401);
    const orphan = await login('no.profile');
    assert.equal(orphan.response.status, 401);
    assert.equal((await loginAudits(noProfile)).at(-1).after.reason, 'NO_PROFILE');

    // Disabled accounts are denied (and logged) only after a correct password.
    const disabledWrong = await login('disabled.account', 'not-the-password');
    assert.equal(disabledWrong.response.status, 401);
    for (const username of ['disabled.account', 'disabled.officer', 'disabled.guest']) {
      const disabled = await login(username);
      assert.equal(disabled.response.status, 403, username);
      assert.equal(disabled.json.error.code, 'ACCOUNT_DISABLED');
      assert.equal(sessionCookie(disabled.response), null);
    }
    assert.equal((await loginAudits(disabledAccount)).at(-1).after.reason, 'DISABLED');

    // Disabling an account ends its existing session on the next request.
    const midCookie = sessionCookie((await login('mid.session')).response);
    assert.equal((await call(app.baseUrl, '/api/protected', midCookie)).response.status, 200);
    await admin.query('UPDATE officer SET active = false WHERE officer_id = $1', [midSession]);
    const afterDisable = await call(app.baseUrl, '/api/protected', midCookie);
    assert.equal(afterDisable.response.status, 401);
    assert.match(cookieAttributes(afterDisable.response), /Expires=Thu, 01 Jan 1970/);

    // A password change invalidates sessions issued under the old hash.
    const pwdCookie = sessionCookie((await login('pwd.change')).response);
    assert.equal((await call(app.baseUrl, '/api/protected', pwdCookie)).response.status, 200);
    await admin.query('UPDATE user_account SET password_hash = $1 WHERE user_id = $2', [
      await hashPassword('another-password', 4),
      pwdChange,
    ]);
    assert.equal((await call(app.baseUrl, '/api/protected', pwdCookie)).response.status, 401);

    // Tampered or foreign-secret cookies are rejected.
    const [body, signature] = staffCookie.split('.');
    const forgedBody = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), sub: sysAdmin }),
    ).toString('base64url');
    assert.equal((await call(app.baseUrl, '/api/protected', `${forgedBody}.${signature}`)).response.status, 401);
    assert.equal((await call(app.baseUrl, '/api/protected', `${body}.${'A'.repeat(signature.length)}`)).response.status, 401);
    assert.equal((await call(app.baseUrl, '/api/protected', 'garbage')).response.status, 401);

    // Idle expiry slides with activity; inactivity beyond 30 minutes expires.
    const startClock = clock;
    let cookie = sessionCookie((await login('fd.colombo')).response);
    clock += 29 * 60_000;
    let active = await call(app.baseUrl, '/api/protected', cookie);
    assert.equal(active.response.status, 200);
    cookie = sessionCookie(active.response) ?? cookie;
    clock += 29 * 60_000;
    active = await call(app.baseUrl, '/api/protected', cookie);
    assert.equal(active.response.status, 200, 'activity extends the idle window');
    cookie = sessionCookie(active.response) ?? cookie;
    clock += 31 * 60_000;
    const idleExpired = await call(app.baseUrl, '/api/protected', cookie);
    assert.equal(idleExpired.response.status, 401);
    assert.equal(idleExpired.json.error.code, 'SESSION_EXPIRED');
    assert.match(cookieAttributes(idleExpired.response), /Expires=Thu, 01 Jan 1970/);

    // The absolute lifetime (1 hour in this test) ends even an active session.
    cookie = sessionCookie((await login('fd.colombo')).response);
    for (let minutes = 0; minutes < 3; minutes += 1) {
      clock += 20 * 60_000;
      active = await call(app.baseUrl, '/api/protected', cookie);
      assert.equal(active.response.status, 200);
      cookie = sessionCookie(active.response) ?? cookie;
    }
    clock += 2 * 60_000;
    const absoluteExpired = await call(app.baseUrl, '/api/protected', cookie);
    assert.equal(absoluteExpired.json.error.code, 'SESSION_EXPIRED');
    clock = startClock;

    // Logout clears the cookie and records LOGOUT; anonymous logout is a no-op.
    const logoutCookie = sessionCookie((await login('guest.one')).response);
    const logout = await call(app.baseUrl, '/api/auth/logout', logoutCookie, 'POST');
    assert.equal(logout.response.status, 204);
    assert.match(cookieAttributes(logout.response), /Expires=Thu, 01 Jan 1970/);
    const guestAudit = await loginAudits(guest.userId);
    assert.equal(guestAudit.at(-1).action, 'LOGOUT');
    assert.equal(guestAudit.at(-1).user_id, guest.userId);
    const anonymousLogout = await call(app.baseUrl, '/api/auth/logout', null, 'POST');
    assert.equal(anonymousLogout.response.status, 204);
    assert.equal((await loginAudits(guest.userId)).length, guestAudit.length);

    // Throttling: after the limit even the correct password is refused (429).
    for (let i = 0; i < LOGIN_FAILURE_LIMIT; i += 1) {
      assert.equal((await login('throttle.user', 'not-the-password')).response.status, 401);
    }
    const blocked = await login('throttle.user');
    assert.equal(blocked.response.status, 429);
    assert.equal(blocked.json.error.code, 'TOO_MANY_ATTEMPTS');
    assert.equal(blocked.response.headers.get('retry-after'), '900');
    assert.equal(sessionCookie(blocked.response), null);
    assert.equal((await loginAudits(throttled)).at(-1).after.reason, 'THROTTLED');

    // A successful login resets the failure count.
    for (let i = 0; i < LOGIN_FAILURE_LIMIT - 1; i += 1) await login('reset.user', 'not-the-password');
    assert.equal((await login('reset.user')).response.status, 200);
    for (let i = 0; i < LOGIN_FAILURE_LIMIT - 1; i += 1) await login('reset.user', 'not-the-password');
    assert.equal((await login('reset.user')).response.status, 200);

    // Unknown usernames are throttled too.
    for (let i = 0; i < LOGIN_FAILURE_LIMIT; i += 1) await login('ghost.user', 'not-the-password');
    assert.equal((await login('ghost.user', 'not-the-password')).response.status, 429);

    // Concurrent guesses are serialized: exactly LIMIT are evaluated, the rest throttled.
    const racing = await Promise.all(
      Array.from({ length: LOGIN_FAILURE_LIMIT + 3 }, () => login('race.user', 'not-the-password')),
    );
    const statuses = racing.map((r) => r.response.status).sort();
    assert.deepEqual(statuses, [...Array(LOGIN_FAILURE_LIMIT).fill(401), 429, 429, 429]);
    const raceReasons = (await loginAudits(racer)).map((row) => row.after.reason).sort();
    assert.deepEqual(raceReasons, [...Array(LOGIN_FAILURE_LIMIT).fill('BAD_CREDENTIALS'), ...Array(3).fill('THROTTLED')]);

    // The idle period is configurable through system_config (FR-005).
    await assert.rejects(
      admin.query(
        `INSERT INTO system_config (config_key, config_value, effective_from, updated_by, updated_at)
         VALUES ('session_idle_timeout_minutes', '0', CURRENT_DATE, $1, now())`,
        [sysAdmin],
      ),
      (error: { code?: string }) => error.code === '23514',
    );
    await admin.query(
      `INSERT INTO system_config (config_key, config_value, effective_from, updated_by, updated_at)
       VALUES ('session_idle_timeout_minutes', '5', CURRENT_DATE, $1, now())`,
      [sysAdmin],
    );
    let configClock = Date.parse('2026-10-04T08:00:00Z');
    const configuredAuth = createAuth({ db: pool, secret: SECRET, now: () => configClock });
    const configuredApp = await startApp(configuredAuth);
    closers.push(configuredApp.close);
    const configuredLogin = await fetch(`${configuredApp.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'sysadmin', password: PASSWORD }),
    });
    assert.equal(configuredLogin.status, 200);
    assert.equal(((await configuredLogin.json()) as any).idleTimeoutMinutes, 5);
    assert.match(cookieAttributes(configuredLogin), /Max-Age=300/);
    const configuredCookie = sessionCookie(configuredLogin);
    configClock += 4 * 60_000;
    const withinIdle = await call(configuredApp.baseUrl, '/api/protected', configuredCookie);
    assert.equal(withinIdle.response.status, 200);
    configClock += 6 * 60_000;
    const configuredExpired = await call(configuredApp.baseUrl, '/api/protected', sessionCookie(withinIdle.response));
    assert.equal(configuredExpired.json.error.code, 'SESSION_EXPIRED');
  } finally {
    for (const close of closers) await close();
    await pool?.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});
