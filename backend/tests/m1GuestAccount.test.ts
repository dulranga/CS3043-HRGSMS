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
import { createAuthorization } from '../src/authorization';
import { maskNic } from '../src/guestIdentity';
import { createGuestAccount, validateGuestAccountWriteInput } from '../src/guestAccount';
import { createAuthRouter } from '../src/routes/authRoutes';
import { createGuestAccountRouter } from '../src/routes/guestAccountRoutes';
import { createGuestRegistrationFromEnv } from '../src/guestRegistration';
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

test('M1-S12 online guest own-profile validation', () => {
  // Partial updates: only provided fields are included.
  assert.deepEqual(validateGuestAccountWriteInput({ fullName: 'A B', email: 'a@b.co' }).value?.fields, {
    fullName: 'A B',
    email: 'a@b.co',
  });
  // Explicit null clears a field; other fields are included.
  const val = validateGuestAccountWriteInput({ email: null, phone: '0779998888', nic: 'ABC123V' }).value?.fields;
  assert.equal(val?.email, null);
  assert.equal(val?.phone, '0779998888');
  assert.equal(val?.nic, 'ABC123V');
  // No fields provided is an error.
  assert.ok(validateGuestAccountWriteInput({}).errors?.body);
  // fullName cannot be cleared (required for updates too).
  assert.ok(validateGuestAccountWriteInput({ fullName: null }).errors?.fullName);
  // Invalid email.
  assert.ok(validateGuestAccountWriteInput({ email: 'x' }).errors?.email);
  // Body must be a JSON object.
  assert.ok(validateGuestAccountWriteInput([]).errors?.body);
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

test('M1-S12 online guest own-profile with access control and duplicates', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const schema = `m1_ga_${randomBytes(8).toString('hex')}`;
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

    // Create three guests: one with an online account, two walk-ins.
    const guest1 = (await admin.query(
      `INSERT INTO guest (full_name, email, phone, nic) VALUES ('Guest One', 'guest1@example.com', '0771234567', '901234567V') RETURNING guest_id`,
    )).rows[0].guest_id;
    const user1 = (await admin.query(
      'INSERT INTO user_account (username, password_hash) VALUES ($1, $2) RETURNING user_id',
      ['guest1', hash],
    )).rows[0].user_id;
    await admin.query('INSERT INTO guest_account (guest_id, user_id) VALUES ($1, $2)', [guest1, user1]);

    const guest2 = (await admin.query(
      `INSERT INTO guest (full_name, email, phone) VALUES ('Guest Two', 'guest2@example.com', '0779998888') RETURNING guest_id`,
    )).rows[0].guest_id;
    const user2 = (await admin.query(
      'INSERT INTO user_account (username, password_hash) VALUES ($1, $2) RETURNING user_id',
      ['guest2', hash],
    )).rows[0].user_id;
    await admin.query('INSERT INTO guest_account (guest_id, user_id) VALUES ($1, $2)', [guest2, user2]);

    // Create a staff account to test denials.
    const staffUser = (await admin.query(
      'INSERT INTO user_account (username, password_hash) VALUES ($1, $2) RETURNING user_id',
      ['staff', hash],
    )).rows[0].user_id;
    await admin.query(
      `INSERT INTO officer (officer_id, full_name, branch_id, role_id)
       SELECT $1, 'Officer', $2, role_id FROM role WHERE role_name = 'FRONT_DESK'`,
      [staffUser, branchId],
    );

    const auth = createAuth({ db: appPool, secret: SECRET, cookieSecure: false, idleMinutes: async () => 30 });
    const authorization = createAuthorization(auth.authenticate);
    const app = express();
    app.use(express.json());
    app.use('/api/auth', createAuthRouter(auth));
    app.use('/api', createGuestRegistrationRouter(createGuestRegistrationFromEnv(appPool), {
      requireLinkIssuer: authorization.staff('guest.link.issue'),
    }));
    app.use('/api/guest/profile', createGuestAccountRouter(createGuestAccount({ db: appPool }), {
      requireGuest: authorization.guest,
    }));
    const server = await listen(app);
    close = server.close;

    async function login(username: string) {
      const response = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: PASSWORD }),
      });
      assert.equal(response.status, 200, `login ${username}`);
      const header = response.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
      assert.ok(header);
      return header.split(';')[0];
    }
    async function api(
      pathname: string,
      { method = 'GET', body, cookie }: { method?: string; body?: unknown; cookie?: string } = {},
    ) {
      const headers: Record<string, string> = {};
      if (cookie) headers.cookie = cookie;
      if (body !== undefined) headers['content-type'] = 'application/json';
      const response = await fetch(`${server.baseUrl}${pathname}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      return { status: response.status, text, json: text ? JSON.parse(text) : null };
    }

    const audits = async (guestId: string) =>
      (await admin.query(
        "SELECT action, user_id, before_value, after_value FROM audit_log WHERE entity_name = 'guest' AND entity_id = $1 ORDER BY changed_at, audit_id",
        [guestId],
      )).rows;

    // 1. Anonymous and non-guest staff cannot access the profile endpoint.
    assert.equal((await api('/api/guest/profile')).status, 401);
    assert.equal((await api('/api/guest/profile', { method: 'PATCH', body: { fullName: 'Hacked' } })).status, 401);
    // Staff login (even FRONT_DESK) is denied.
    const staffCookie = await login('staff');
    assert.equal((await api('/api/guest/profile', { cookie: staffCookie })).json.error.code, 'FORBIDDEN');

    // 2. Read own profile: NIC is masked, all fields shown.
    const guest1Cookie = await login('guest1');
    const profile1 = await api('/api/guest/profile', { cookie: guest1Cookie });
    assert.equal(profile1.status, 200);
    assert.equal(profile1.json.data.fullName, 'Guest One');
    assert.equal(profile1.json.data.email, 'guest1@example.com');
    assert.equal(profile1.json.data.phone, '0771234567');
    assert.equal(profile1.json.data.maskedNic, '•••••567V');
    assert.equal(profile1.json.data.hasNic, true);
    assert.equal(profile1.json.data.active, true);
    assert.ok(!profile1.text.includes('901234567V'));
    assert.equal(profile1.json.data.guestId, guest1);
    assert.equal(profile1.json.data.createdAt.length > 0, true);

    // 3. Update own profile: validates fields, checks duplicates, audits only changed fields.
    const updated = await api('/api/guest/profile', {
      method: 'PATCH',
      cookie: guest1Cookie,
      body: { fullName: 'Guest One Updated', phone: '0779999999' },
    });
    assert.equal(updated.status, 200, updated.text);
    assert.equal(updated.json.data.fullName, 'Guest One Updated');
    assert.equal(updated.json.data.phone, '0779999999');
    const updateAudit = (await audits(guest1))[0];
    assert.equal(updateAudit.action, 'UPDATE');
    assert.deepEqual(JSON.parse(updateAudit.before_value), { fullName: 'Guest One', phone: '0771234567' });
    assert.deepEqual(JSON.parse(updateAudit.after_value), { fullName: 'Guest One Updated', phone: '0779999999' });

    // No-op update writes nothing.
    const auditCountBefore = (await audits(guest1)).length;
    const noop = await api('/api/guest/profile', {
      method: 'PATCH',
      cookie: guest1Cookie,
      body: { fullName: 'Guest One Updated' },
    });
    assert.equal(noop.status, 200);
    assert.equal((await audits(guest1)).length, auditCountBefore);

    // Cannot clear both email and phone.
    const noContact = await api('/api/guest/profile', {
      method: 'PATCH',
      cookie: guest1Cookie,
      body: { email: null, phone: null },
    });
    assert.equal(noContact.status, 400);
    assert.ok(noContact.json.error.fields.contact);

    // 4. Duplicate checks on update: NIC match is always refused.
    const nicDup = await api('/api/guest/profile', {
      method: 'PATCH',
      cookie: guest1Cookie,
      body: { nic: '901234567V' },
    });
    // No change, so no audit
    assert.equal(nicDup.status, 200);

    const guest2Cookie = await login('guest2');
    const nicDup2 = await api('/api/guest/profile', {
      method: 'PATCH',
      cookie: guest2Cookie,
      body: { nic: '901234567V' },
    });
    assert.equal(nicDup2.status, 400);
    assert.equal(nicDup2.json.error.code, 'GUEST_NIC_EXISTS');

    // Email/phone match is warned unless confirmed.
    const emailDup = await api('/api/guest/profile', {
      method: 'PATCH',
      cookie: guest2Cookie,
      body: { email: 'guest1@example.com' },
    });
    assert.equal(emailDup.status, 400);
    assert.equal(emailDup.json.error.code, 'POSSIBLE_DUPLICATE');

    // Confirmed duplicates (e.g. family sharing) are allowed.
    const confirmed = await api('/api/guest/profile', {
      method: 'PATCH',
      cookie: guest2Cookie,
      body: { email: 'guest1@example.com', confirmNotDuplicate: true },
    });
    assert.equal(confirmed.status, 200);

    // 5. Can clear NIC.
    const cleared = await api('/api/guest/profile', {
      method: 'PATCH',
      cookie: guest1Cookie,
      body: { nic: null },
    });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.json.data.maskedNic, null);
    assert.equal(cleared.json.data.hasNic, false);

    // 6. Deactivation happens at staff level (M1-S11) and breaks guest login.
    // Verify that a deactivated guest cannot authenticate.
    const guest3 = (await admin.query(
      `INSERT INTO guest (full_name, email) VALUES ('Guest Three', 'guest3@example.com') RETURNING guest_id`,
    )).rows[0].guest_id;
    const user3 = (await admin.query(
      'INSERT INTO user_account (username, password_hash) VALUES ($1, $2) RETURNING user_id',
      ['guest3', hash],
    )).rows[0].user_id;
    await admin.query('INSERT INTO guest_account (guest_id, user_id) VALUES ($1, $2)', [guest3, user3]);

    const guest3Cookie = await login('guest3');
    assert.ok(guest3Cookie);

    // Deactivate via direct update (simulating M1-S11).
    await admin.query('UPDATE guest SET active = false WHERE guest_id = $1', [guest3]);

    // Deactivated guest's existing cookie is invalidated by auth (guest.active is re-read per request).
    const profileAfterDeactivate = await api('/api/guest/profile', {
      method: 'PATCH',
      cookie: guest3Cookie,
      body: { fullName: 'Should Fail' },
    });
    // Auth denies deactivated guests on any request.
    assert.equal(profileAfterDeactivate.status, 401);

    // Future login for deactivated guest is denied by auth.
    const loginAfterDeactivate = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'guest3', password: PASSWORD }),
    });
    assert.equal(loginAfterDeactivate.status, 403, 'deactivated guest cannot login');
  } finally {
    await close?.();
    await appPool?.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    await admin.end();
  }
});
