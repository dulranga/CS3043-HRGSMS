import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import test from 'node:test';
import dotenv from 'dotenv';
import express from 'express';
import { Client, Pool } from 'pg';
import { SESSION_COOKIE_NAME, createAuth, hashPassword } from '../src/auth';
import { STAFF_ROLES, createAuthorization } from '../src/authorization';
import {
  LINK_CODE_TTL_SECONDS,
  REGISTRATION_FAILURE_LIMIT,
  createGuestRegistration,
  issueLinkCode,
  validateRegistrationInput,
  verifyLinkCode,
} from '../src/guestRegistration';
import { createAuthRouter } from '../src/routes/authRoutes';
import { createGuestRegistrationRouter } from '../src/routes/guestRegistrationRoutes';

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
const GUEST_ID = '01900000-0000-7000-8000-0000000000aa';
const OTHER_GUEST_ID = '01900000-0000-7000-8000-0000000000bb';

test('M1-S10 registration input validation', () => {
  const ok = validateRegistrationInput({
    username: ' new.guest ',
    password: PASSWORD,
    fullName: ' Nimal Perera ',
    email: ' Nimal@Example.COM ',
    phone: '077 123-4567',
    nic: ' 901234567v ',
  });
  assert.deepEqual(ok.value, {
    mode: 'NEW',
    username: 'new.guest',
    password: PASSWORD,
    fullName: 'Nimal Perera',
    email: 'nimal@example.com',
    phone: '0771234567',
    nic: '901234567V',
  });
  // A link code ignores any submitted profile details.
  assert.deepEqual(validateRegistrationInput({ username: 'abc', password: PASSWORD, linkCode: ' code ', fullName: 'X' }).value, {
    mode: 'LINK',
    username: 'abc',
    password: PASSWORD,
    linkCode: 'code',
  });
  const missingContact = validateRegistrationInput({ username: 'abc', password: PASSWORD, fullName: 'A' });
  assert.ok(missingContact.errors?.contact, 'FR-017 requires a contact method');
  assert.ok(validateRegistrationInput({ username: 'ab', password: PASSWORD, fullName: 'A', email: 'a@b.co' }).errors?.username);
  assert.ok(validateRegistrationInput({ username: 'has space', password: PASSWORD, fullName: 'A', email: 'a@b.co' }).errors?.username);
  assert.ok(validateRegistrationInput({ username: 'abc', password: PASSWORD, fullName: 'A', email: 'not-an-email' }).errors?.email);
  assert.ok(validateRegistrationInput({ username: 'abc', password: PASSWORD, fullName: 'A', phone: '12ab' }).errors?.phone);
  assert.ok(validateRegistrationInput({ username: 'abc', password: '', fullName: 'A', email: 'a@b.co' }).errors?.password);
  assert.ok(validateRegistrationInput({ username: 'abc', password: PASSWORD, email: 'a@b.co' }).errors?.fullName);
  assert.ok(validateRegistrationInput({ username: 'abc', password: PASSWORD, fullName: 3, email: 'a@b.co' }).errors?.fullName);
  assert.ok(validateRegistrationInput(null).errors);
  assert.ok(validateRegistrationInput([]).errors);
});

test('M1-S10 link codes are signed, guest-bound and expire', () => {
  const now = 1_800_000_000;
  const issued = issueLinkCode(SECRET, GUEST_ID, now);
  assert.match(issued.code, /^[A-Za-z0-9_-]+$/);
  assert.equal(issued.expiresAt, now + LINK_CODE_TTL_SECONDS);
  assert.deepEqual(verifyLinkCode(SECRET, issued.code, now + 10), {
    status: 'VALID',
    payload: { guestId: GUEST_ID, expiresAt: issued.expiresAt, codeId: issued.codeId },
  });
  // Pasted with spaces/newlines still works.
  const spaced = issued.code.replace(/(.{8})/g, '$1 ');
  assert.equal(verifyLinkCode(SECRET, spaced, now).status, 'VALID');
  assert.equal(verifyLinkCode(SECRET, issued.code, issued.expiresAt).status, 'EXPIRED');
  assert.equal(verifyLinkCode('another-secret-that-is-long-enough-000000', issued.code, now).status, 'INVALID');
  assert.equal(verifyLinkCode(SECRET, '', now).status, 'INVALID');
  assert.equal(verifyLinkCode(SECRET, 'not a code!', now).status, 'INVALID');
  assert.equal(verifyLinkCode(SECRET, issued.code.slice(0, -2), now).status, 'INVALID');

  // Re-targeting a code to another guest or extending it breaks the MAC.
  const raw = Buffer.from(issued.code, 'base64url');
  const retargeted = Buffer.from(raw);
  Buffer.from(OTHER_GUEST_ID.replace(/-/g, ''), 'hex').copy(retargeted, 1);
  assert.equal(verifyLinkCode(SECRET, retargeted.toString('base64url'), now).status, 'INVALID');
  const extended = Buffer.from(raw);
  extended.writeUInt32BE(issued.expiresAt + 86_400, 17);
  assert.equal(verifyLinkCode(SECRET, extended.toString('base64url'), now).status, 'INVALID');

  assert.notEqual(issueLinkCode(SECRET, GUEST_ID, now).code, issued.code, 'each code has its own nonce');
  assert.throws(() => issueLinkCode(SECRET, 'not-a-uuid', now));
  assert.throws(() => createGuestRegistration({ db: {} as never, secret: 'short' }));
});

async function listen(app: express.Express) {
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

test('M1-S10 online registration, verified linking and takeover protection (FR-081/083, AT-15)', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const schema = `m1_reg_${randomBytes(8).toString('hex')}`;
  // Session-scoped search_path must use the direct endpoint, not a
  // transaction-mode pooler (see the M1-S08 incident in member_work_log.md).
  const directUrl = new URL(process.env.PG_URL);
  directUrl.hostname = directUrl.hostname.replace('-pooler.', '.');
  const admin = new Client({ connectionString: directUrl.toString() });
  await admin.connect();
  let appPool: Pool | undefined;
  let close: (() => Promise<void>) | undefined;

  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET search_path TO "${schema}"`);
    assert.equal((await admin.query('SELECT current_schema() AS schema')).rows[0].schema, schema);
    for (const sql of migrations) await admin.query(sql);

    appPool = new Pool({ connectionString: directUrl.toString(), options: `-c search_path=${schema}`, max: 6 });
    assert.equal((await appPool.query('SELECT current_schema() AS schema')).rows[0].schema, schema);

    const branchId = (await admin.query("SELECT branch_id FROM branch WHERE name = 'Colombo'")).rows[0].branch_id;
    const hash = await hashPassword(PASSWORD, 4);
    for (const role of STAFF_ROLES) {
      const user = await admin.query(
        'INSERT INTO user_account (username, password_hash) VALUES ($1, $2) RETURNING user_id',
        [role.toLowerCase(), hash],
      );
      await admin.query(
        `INSERT INTO officer (officer_id, full_name, branch_id, role_id)
         SELECT $1, $2, $3, role_id FROM role WHERE role_name = $4`,
        [user.rows[0].user_id, `Officer ${role}`, branchId, role],
      );
    }
    // Walk-in guest created earlier by staff, with no online account.
    const existing = (await admin.query(
      `INSERT INTO guest (full_name, email, phone, nic)
       VALUES ('Kamala Silva', 'Kamala.Silva@Example.com', '+94 77 555 0101', '851234567V') RETURNING guest_id`,
    )).rows[0].guest_id as string;
    const inactive = (await admin.query(
      "INSERT INTO guest (full_name, email, active) VALUES ('Old Guest', 'old@example.com', false) RETURNING guest_id",
    )).rows[0].guest_id as string;

    let clock = Date.now();
    const auth = createAuth({ db: appPool, secret: SECRET, cookieSecure: false, idleMinutes: async () => 30 });
    const authorization = createAuthorization(auth.authenticate);
    const registration = createGuestRegistration({ db: appPool, secret: SECRET, now: () => clock, bcryptCost: 4 });
    const app = express();
    // Lets each scenario use its own client address for the failure throttle.
    app.set('trust proxy', true);
    app.use(express.json());
    app.use('/api/auth', createAuthRouter(auth));
    app.use('/api', createGuestRegistrationRouter(registration, {
      requireLinkIssuer: authorization.staff('guest.link.issue'),
    }));
    // A staff-only route, to prove a registered guest gains no officer power.
    app.get('/api/staff-only', authorization.staff('branch.read'), (_req, res) => { res.json({ ok: true }); });
    const server = await listen(app);
    close = server.close;

    async function api(pathname: string, { method = 'GET', body, cookie, ip = '10.0.0.1' }: {
      method?: string; body?: unknown; cookie?: string; ip?: string;
    } = {}) {
      const headers: Record<string, string> = { 'x-forwarded-for': ip };
      if (cookie) headers.cookie = cookie;
      if (body !== undefined) headers['content-type'] = 'application/json';
      const response = await fetch(`${server.baseUrl}${pathname}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      return { status: response.status, json: text ? JSON.parse(text) : null, headers: response.headers };
    }
    async function login(username: string, password = PASSWORD) {
      const response = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      assert.equal(response.status, 200, `login ${username}`);
      const header = response.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
      assert.ok(header);
      return { cookie: header.split(';')[0], user: (await response.json()).user };
    }
    const count = async (sql: string, params: unknown[] = []) => (await admin.query(sql, params)).rows[0].n as number;
    const accounts = () => count('SELECT count(*)::int AS n FROM user_account');
    const failures = (ip: string) => count(
      `SELECT count(*)::int AS n FROM audit_log
        WHERE entity_name = 'guest_registration' AND entity_id = $1 AND after_value::jsonb ->> 'outcome' = 'FAILED'`,
      [ip],
    );

    // 1. A brand-new guest registers, signs in and is a GUEST principal only.
    const created = await api('/api/auth/register', {
      method: 'POST',
      body: { username: 'Nimal.P', password: PASSWORD, fullName: 'Nimal Perera', email: 'nimal@example.com', phone: '077 123 4567', nic: '901234567v' },
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.equal(created.json.data.linkedExistingProfile, false);
    assert.equal(created.headers.get('cache-control'), 'no-store');
    assert.equal(created.headers.getSetCookie().length, 0, 'registration does not sign in by itself');
    const newGuest = await admin.query(
      `SELECT g.full_name, g.email, g.phone, g.nic, ga.user_id, ua.password_hash
         FROM guest g JOIN guest_account ga USING (guest_id) JOIN user_account ua ON ua.user_id = ga.user_id
        WHERE g.guest_id = $1`,
      [created.json.data.guestId],
    );
    assert.deepEqual(
      { ...newGuest.rows[0], password_hash: undefined },
      { full_name: 'Nimal Perera', email: 'nimal@example.com', phone: '0771234567', nic: '901234567V', user_id: created.json.data.userId, password_hash: undefined },
    );
    assert.match(newGuest.rows[0].password_hash, /^\$2[aby]\$/);
    const createAudits = await admin.query(
      `SELECT entity_name, user_id, after_value FROM audit_log WHERE action = 'CREATE' AND user_id = $1 ORDER BY entity_name`,
      [created.json.data.userId],
    );
    assert.deepEqual(createAudits.rows.map((r) => r.entity_name), ['guest', 'guest_account', 'user_account']);
    assert.ok(!createAudits.rows.some((r) => r.after_value.includes(PASSWORD) || r.after_value.includes('901234567V')), 'no password/NIC in audit');

    const nimal = await login('Nimal.P');
    assert.deepEqual(nimal.user, { userId: created.json.data.userId, username: 'Nimal.P', kind: 'GUEST', guestId: created.json.data.guestId });
    assert.equal((await api('/api/staff-only', { cookie: nimal.cookie })).status, 403, 'FR-081: guest session has no staff powers');
    assert.equal((await api(`/api/guests/${existing}/link-code`, { method: 'POST', cookie: nimal.cookie })).status, 403);
    await assert.rejects(
      admin.query(
        `INSERT INTO officer (officer_id, full_name, branch_id, role_id)
         SELECT $1, 'Escalated', $2, role_id FROM role WHERE role_name = 'SYSTEM_ADMINISTRATOR'`,
        [created.json.data.userId, branchId],
      ),
      (error: { code?: string }) => error.code === '23514',
      'a guest account can never become an officer',
    );

    // 2. Usernames are unique case-insensitively.
    const before = await accounts();
    const dupUser = await api('/api/auth/register', {
      method: 'POST',
      body: { username: 'nimal.p', password: PASSWORD, fullName: 'Someone Else', email: 'else@example.com' },
    });
    assert.equal(dupUser.status, 409);
    assert.equal(dupUser.json.error.code, 'USERNAME_TAKEN');
    const staffName = await api('/api/auth/register', {
      method: 'POST',
      body: { username: 'FRONT_DESK', password: PASSWORD, fullName: 'Spoof', email: 'spoof@example.com' },
    });
    assert.equal(staffName.json.error.code, 'USERNAME_TAKEN', 'cannot attach to a staff username');
    assert.equal(await accounts(), before);

    // 3. Details matching an existing profile are refused without a link code
    //    (email case, phone formatting and NIC case are all normalized).
    for (const [field, value] of [
      ['email', ' KAMALA.silva@example.COM '],
      ['phone', '+94775550101'],
      ['nic', '851234567v'],
    ] as const) {
      const body: Record<string, string> = { username: `claim.${field}`, password: PASSWORD, fullName: 'Kamala Silva', email: `x.${field}@example.org` };
      body[field] = value;
      const claim = await api('/api/auth/register', { method: 'POST', body, ip: '10.0.0.3' });
      assert.equal(claim.status, 409, field);
      assert.equal(claim.json.error.code, 'PROFILE_EXISTS', field);
      assert.match(claim.json.error.message, /link code/);
    }
    assert.equal(await accounts(), before, 'no account or link left behind');
    assert.equal(await count('SELECT count(*)::int AS n FROM guest_account WHERE guest_id = $1', [existing]), 0);
    assert.equal(await failures('10.0.0.3'), 3, 'refusals are audited');

    // 4. Only FRONT_DESK may issue a link code.
    assert.equal((await api(`/api/guests/${existing}/link-code`, { method: 'POST' })).status, 401);
    for (const role of STAFF_ROLES.filter((r) => r !== 'FRONT_DESK')) {
      const { cookie } = await login(role.toLowerCase());
      assert.equal((await api(`/api/guests/${existing}/link-code`, { method: 'POST', cookie })).status, 403, role);
    }
    const desk = await login('front_desk');
    assert.equal((await api('/api/guests/not-a-uuid/link-code', { method: 'POST', cookie: desk.cookie })).status, 404);
    assert.equal((await api(`/api/guests/${OTHER_GUEST_ID}/link-code`, { method: 'POST', cookie: desk.cookie })).status, 404);
    const inactiveCode = await api(`/api/guests/${inactive}/link-code`, { method: 'POST', cookie: desk.cookie });
    assert.equal(inactiveCode.json.error.code, 'GUEST_INACTIVE');
    const linkedCode = await api(`/api/guests/${created.json.data.guestId}/link-code`, { method: 'POST', cookie: desk.cookie });
    assert.equal(linkedCode.json.error.code, 'GUEST_ALREADY_LINKED');

    const issued = await api(`/api/guests/${existing}/link-code`, { method: 'POST', cookie: desk.cookie });
    assert.equal(issued.status, 201);
    assert.equal(issued.headers.get('cache-control'), 'no-store');
    const linkCode = issued.json.data.linkCode as string;
    const deskId = (await admin.query("SELECT user_id FROM user_account WHERE username = 'front_desk'")).rows[0].user_id;
    const issueAudit = await admin.query(
      "SELECT user_id, after_value FROM audit_log WHERE entity_name = 'guest_link_code' AND entity_id = $1",
      [existing],
    );
    assert.equal(issueAudit.rows.length, 1);
    assert.equal(issueAudit.rows[0].user_id, deskId);
    assert.ok(!issueAudit.rows[0].after_value.includes(linkCode), 'the code itself is never stored');

    // 5. Forged, re-targeted and expired codes fail without creating anything.
    const forged = issueLinkCode('attacker-secret-that-is-long-enough-00000', existing, Math.floor(clock / 1000)).code;
    const otherGuest = (await admin.query("INSERT INTO guest (full_name, phone) VALUES ('Third Guest', '0112223334') RETURNING guest_id")).rows[0].guest_id;
    const retargeted = Buffer.from(linkCode, 'base64url');
    Buffer.from(otherGuest.replace(/-/g, ''), 'hex').copy(retargeted, 1);
    for (const bad of [forged, retargeted.toString('base64url'), 'garbage']) {
      const attempt = await api('/api/auth/register', { method: 'POST', body: { username: 'thief', password: PASSWORD, linkCode: bad }, ip: '10.0.0.5' });
      assert.equal(attempt.status, 400);
      assert.equal(attempt.json.error.code, 'INVALID_LINK_CODE');
    }
    const savedClock = clock;
    clock += (LINK_CODE_TTL_SECONDS + 1) * 1000;
    const expired = await api('/api/auth/register', { method: 'POST', body: { username: 'late.kamala', password: PASSWORD, linkCode }, ip: '10.0.0.5' });
    assert.equal(expired.json.error.code, 'INVALID_LINK_CODE');
    clock = savedClock;
    const inactiveForged = issueLinkCode(SECRET, inactive, Math.floor(clock / 1000)).code;
    const inactiveClaim = await api('/api/auth/register', { method: 'POST', body: { username: 'old.guest', password: PASSWORD, linkCode: inactiveForged }, ip: '10.0.0.5' });
    assert.equal(inactiveClaim.json.error.code, 'INVALID_LINK_CODE', 'a deactivated guest cannot be linked');
    assert.equal(await accounts(), before);
    assert.equal(await failures('10.0.0.5'), 5);

    // 6. The genuine guest claims the profile with the code. Concurrent use of
    //    one code yields exactly one link; profile fields cannot be overwritten.
    // Different client addresses, so the per-client throttle lock does not serialize them.
    const raced = await Promise.all(['kamala.s', 'kamala.race'].map((username, index) =>
      api('/api/auth/register', {
        method: 'POST',
        body: { username, password: PASSWORD, linkCode: ` ${linkCode} `, fullName: 'Overwritten', email: 'attacker@example.com' },
        ip: `10.0.0.6${index}`,
      })));
    const winner = raced.find((r) => r.status === 201);
    const loser = raced.find((r) => r.status !== 201);
    assert.ok(winner && loser, JSON.stringify(raced.map((r) => r.json)));
    assert.equal(loser.status, 409);
    assert.equal(loser.json.error.code, 'LINK_CODE_USED');
    assert.equal(winner.json.data.guestId, existing);
    assert.equal(winner.json.data.linkedExistingProfile, true);
    assert.equal(await accounts(), before + 1, 'the losing request left no orphan account');
    const kamalaRow = (await admin.query('SELECT full_name, email FROM guest WHERE guest_id = $1', [existing])).rows[0];
    assert.deepEqual(kamalaRow, { full_name: 'Kamala Silva', email: 'Kamala.Silva@Example.com' });
    const linkAudit = await admin.query(
      "SELECT after_value FROM audit_log WHERE entity_name = 'guest_account' AND user_id = $1",
      [winner.json.data.userId],
    );
    assert.equal(
      JSON.parse(linkAudit.rows[0].after_value).codeId,
      JSON.parse(issueAudit.rows[0].after_value).codeId,
      'the link audit traces back to the issuing officer',
    );

    const kamala = await login(winner.json.data.username);
    assert.equal(kamala.user.kind, 'GUEST');
    assert.equal(kamala.user.guestId, existing);
    assert.equal((await api('/api/staff-only', { cookie: kamala.cookie })).status, 403);
    const reuse = await api('/api/auth/register', { method: 'POST', body: { username: 'kamala.again', password: PASSWORD, linkCode }, ip: '10.0.0.6' });
    assert.equal(reuse.json.error.code, 'LINK_CODE_USED', 'a used code cannot link a second account');
    assert.equal(await count('SELECT count(*)::int AS n FROM guest_account WHERE guest_id = $1', [existing]), 1);

    // 7. Repeated failures from one client are throttled, even with a valid request.
    for (let i = 0; i < REGISTRATION_FAILURE_LIMIT; i += 1) {
      const attempt = await api('/api/auth/register', { method: 'POST', body: { username: `probe${i}`, password: PASSWORD, linkCode: 'garbage' }, ip: '10.0.0.9' });
      assert.equal(attempt.status, 400);
    }
    const throttled = await api('/api/auth/register', {
      method: 'POST',
      body: { username: 'legit.later', password: PASSWORD, fullName: 'Legit', email: 'legit@example.com' },
      ip: '10.0.0.9',
    });
    assert.equal(throttled.status, 429);
    assert.equal(throttled.headers.get('retry-after'), '900');
    const otherClient = await api('/api/auth/register', {
      method: 'POST',
      body: { username: 'legit.later', password: PASSWORD, fullName: 'Legit', email: 'legit@example.com' },
      ip: '10.0.0.10',
    });
    assert.equal(otherClient.status, 201, 'the throttle is per client');

    // Short passwords are rejected by the shared policy.
    const weak = await api('/api/auth/register', { method: 'POST', body: { username: 'weak.pw', password: 'short', fullName: 'W', email: 'w@example.com' } });
    assert.equal(weak.status, 400);
    assert.ok(weak.json.error.fields.password);
  } finally {
    await close?.();
    await appPool?.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    await admin.end();
  }
});
