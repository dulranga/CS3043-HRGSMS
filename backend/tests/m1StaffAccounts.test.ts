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
  OFFICER_SEARCH_DEFAULT_LIMIT,
  createStaffAccounts,
  validateOfficerCreateInput,
  validateOfficerSearchInput,
  validateOfficerUpdateInput,
} from '../src/staffAccounts';
import { createAuthRouter } from '../src/routes/authRoutes';
import { createStaffAccountRouter } from '../src/routes/staffAccountRoutes';

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
const UNKNOWN_OFFICER = '01900000-0000-7000-8000-0000000000ee';

test('M1-S13 officer search/create/update validation', () => {
  assert.deepEqual(validateOfficerSearchInput({ query: '  Per ' }).value, {
    query: 'Per',
    nic: null,
    includeInactive: false,
    limit: OFFICER_SEARCH_DEFAULT_LIMIT,
  });
  assert.equal(validateOfficerSearchInput({ nic: ' 851234567v ' }).value?.nic, '851234567V');
  assert.ok(validateOfficerSearchInput({}).errors?.query, 'a criterion is required');
  assert.ok(validateOfficerSearchInput({ query: 'a' }).errors?.query);
  assert.ok(validateOfficerSearchInput({ query: 'x'.repeat(101) }).errors?.query);
  assert.ok(validateOfficerSearchInput({ query: 'ab', limit: 0 }).errors?.limit);
  assert.ok(validateOfficerSearchInput({ query: 'ab', includeInactive: 'yes' }).errors?.includeInactive);
  assert.ok(validateOfficerSearchInput([]).errors?.body);

  const created = validateOfficerCreateInput({
    fullName: ' Nimal Perera ',
    username: ' Nimal.Perera ',
    email: ' Nimal@Example.COM ',
    phone: '(077) 123-4567',
    nic: ' 901234567v ',
    branchId: '01900000-0000-7000-8000-000000000001',
    roleId: '01900000-0000-7000-8000-000000000002',
  });
  assert.deepEqual(created.value, {
    fullName: 'Nimal Perera',
    username: 'nimal.perera',
    email: 'nimal@example.com',
    phone: '0771234567',
    nic: '901234567V',
    branchId: '01900000-0000-7000-8000-000000000001',
    roleId: '01900000-0000-7000-8000-000000000002',
    password: null,
  });
  assert.ok(validateOfficerCreateInput({ username: 'u', branchId: 'x', roleId: 'y' }).errors?.fullName);
  assert.ok(validateOfficerCreateInput({ fullName: 'A', branchId: 'x', roleId: 'y' }).errors?.username);
  assert.ok(validateOfficerCreateInput({ fullName: 'A', username: 'u', email: 'bad', branchId: 'b', roleId: 'r' }).errors?.email);
  assert.ok(validateOfficerCreateInput({ fullName: 'A', username: 'u', phone: '12', branchId: 'b', roleId: 'r' }).errors?.phone);
  assert.ok(validateOfficerCreateInput({ fullName: 'A', username: 'u', branchId: 'nope', roleId: 'r' }).errors?.branchId);
  assert.ok(validateOfficerCreateInput({ fullName: 'A', username: 'u', branchId: 'b', roleId: 'r', password: 'short' }).errors?.password);
  assert.ok(validateOfficerCreateInput({ fullName: 'A', username: 'u', branchId: 'b', roleId: 'r', guestId: 'x' }).errors?.guestId);
  assert.ok(validateOfficerCreateInput([]).errors?.body);

  assert.deepEqual(validateOfficerUpdateInput({ fullName: ' A ' }).value, { fullName: 'A' });
  assert.deepEqual(validateOfficerUpdateInput({ email: null, nic: ' 1v ' }).value, { email: null, nic: '1V' });
  assert.ok(validateOfficerUpdateInput({}).errors?.body, 'at least one field is required');
  assert.ok(validateOfficerUpdateInput({ fullName: null }).errors?.fullName);
  assert.ok(validateOfficerUpdateInput({ email: 'bad' }).errors?.email);
  assert.ok(validateOfficerUpdateInput({ branchId: 'x' }).errors?.branchId);
  assert.ok(validateOfficerUpdateInput({ password: 'short' }).errors?.password);
  assert.ok(validateOfficerUpdateInput({ username: 'hax' }).errors?.username, 'username is not editable');
  assert.ok(validateOfficerUpdateInput(null).errors?.body);
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

test('M1-S13 staff-account administration with permissions, masking and audit', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const schema = `m1_sa_${randomBytes(8).toString('hex')}`;
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

    const colomboId = (await admin.query("SELECT branch_id FROM branch WHERE name = 'Colombo'")).rows[0].branch_id;
    const kandyId = (await admin.query("SELECT branch_id FROM branch WHERE name = 'Kandy'")).rows[0].branch_id;
    const roleIds: Record<string, string> = {};
    for (const role of STAFF_ROLES) {
      roleIds[role] = (await admin.query('SELECT role_id FROM role WHERE role_name = $1', [role])).rows[0].role_id;
    }

    const hash = await hashPassword(PASSWORD, 4);
    const officerIds: Record<string, string> = {};
    for (const role of STAFF_ROLES) {
      const user = await admin.query(
        'INSERT INTO user_account (username, password_hash) VALUES ($1, $2) RETURNING user_id',
        [role.toLowerCase(), hash],
      );
      officerIds[role] = user.rows[0].user_id;
      await admin.query(
        `INSERT INTO officer (officer_id, full_name, email, phone, nic, branch_id, role_id)
         SELECT $1, $2, $3, $4, $5, $6, $7`,
        [user.rows[0].user_id, `Officer ${role}`, `${role.toLowerCase()}@skynest.example`, '0112000000', null, colomboId, roleIds[role]],
      );
    }
    // A search target with a legacy-formatted phone, mixed-case email and a NIC.
    const kamalaUser = await admin.query(
      'INSERT INTO user_account (username, password_hash) VALUES ($1, $2) RETURNING user_id',
      ['kamala', hash],
    );
    const kamala = kamalaUser.rows[0].user_id;
    await admin.query(
      `INSERT INTO officer (officer_id, full_name, email, phone, nic, branch_id, role_id)
       VALUES ($1, 'Kamala Officer', 'Kamala.Officer@Example.com', '+94 77 555 0101', '851234567V', $2, $3)`,
      [kamala, colomboId, roleIds.FRONT_DESK],
    );
    // An online guest never appears in officer results and cannot manage accounts.
    const onaGuest = (await admin.query(
      "INSERT INTO guest (full_name, email) VALUES ('Online Ona', 'ona@example.com') RETURNING guest_id",
    )).rows[0].guest_id;
    const onaUser = (await admin.query(
      'INSERT INTO user_account (username, password_hash) VALUES ($1, $2) RETURNING user_id',
      ['ona', hash],
    )).rows[0].user_id;
    await admin.query('INSERT INTO guest_account (guest_id, user_id) VALUES ($1, $2)', [onaGuest, onaUser]);

    const auth = createAuth({ db: appPool, secret: SECRET, cookieSecure: false, idleMinutes: async () => 30 });
    const authorization = createAuthorization(auth.authenticate);
    const app = express();
    app.use(express.json());
    app.use('/api/auth', createAuthRouter(auth));
    app.use('/api', createStaffAccountRouter(createStaffAccounts({ db: appPool }), {
      requireRead: authorization.staff('account.read'),
      requireWrite: authorization.staff('account.write'),
    }));
    const server = await listen(app);
    close = server.close;

    async function rawLogin(username: string, password: string) {
      return fetch(`${server.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
    }
    async function login(username: string, password = PASSWORD) {
      const response = await rawLogin(username, password);
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
      return { status: response.status, text, json: text ? JSON.parse(text) : null, headers: response.headers };
    }
    const audits = async (officerId: string) => (await admin.query(
      "SELECT action, user_id, before_value, after_value FROM audit_log WHERE entity_name = 'officer' AND entity_id = $1 ORDER BY changed_at, audit_id",
      [officerId],
    )).rows;
    const officerCount = async () =>
      (await admin.query('SELECT count(*)::int AS n FROM officer')).rows[0].n;
    const accountCount = async () =>
      (await admin.query('SELECT count(*)::int AS n FROM user_account')).rows[0].n;

    // 1. Only SYSTEM_ADMINISTRATOR writes; SYSTEM_ADMINISTRATOR/AUDITOR read.
    const routes: { method: string; path: string; body?: unknown }[] = [
      { method: 'POST', path: '/api/users/search', body: { query: 'Kamala' } },
      { method: 'POST', path: '/api/users', body: { fullName: 'X', username: 'x', branchId: colomboId, roleId: roleIds.FRONT_DESK } },
      { method: 'GET', path: `/api/users/${kamala}` },
      { method: 'PATCH', path: `/api/users/${kamala}`, body: { fullName: 'Hijacked' } },
      { method: 'POST', path: `/api/users/${kamala}/disable`, body: {} },
      { method: 'POST', path: `/api/users/${kamala}/reactivate`, body: {} },
    ];
    for (const route of routes) {
      assert.equal((await api(route.path, { method: route.method, body: route.body })).status, 401, `${route.path} anonymous`);
    }
    const officersBefore = await officerCount();
    const accountsBefore = await accountCount();
    const deniedStaff = ['front_desk', 'service_staff', 'branch_manager', 'chain_manager'];
    for (const username of deniedStaff) {
      const cookie = await login(username);
      for (const route of routes) {
        const result = await api(route.path, { method: route.method, body: route.body, cookie });
        assert.equal(result.status, 403, `${username} ${route.method} ${route.path}`);
      }
    }
    const guestCookie = await login('ona');
    for (const route of routes) {
      assert.equal((await api(route.path, { method: route.method, body: route.body, cookie: guestCookie })).status, 403);
    }
    // AUDITOR can read but never write.
    const auditorCookie = await login('auditor');
    assert.equal((await api('/api/users/search', { method: 'POST', cookie: auditorCookie, body: { query: 'Kamala' } })).status, 200);
    assert.equal((await api(`/api/users/${kamala}`, { cookie: auditorCookie })).status, 200);
    for (const route of [routes[1], routes[3], routes[4], routes[5]]) {
      assert.equal((await api(route.path, { method: route.method, body: route.body, cookie: auditorCookie })).status, 403);
    }
    assert.equal(await officerCount(), officersBefore, 'denied requests created nothing');
    assert.equal(await accountCount(), accountsBefore, 'denied requests created nothing');

    const adminCookie = await login('system_administrator');
    const adminId = officerIds.SYSTEM_ADMINISTRATOR;

    // 2. Search: literal substrings, exact-only NIC, masked output (AT-10).
    const byName = await api('/api/users/search', { method: 'POST', cookie: adminCookie, body: { query: 'kamal' } });
    assert.equal(byName.status, 200);
    assert.equal(byName.headers.get('cache-control'), 'no-store');
    assert.deepEqual(byName.json.data.map((o: { userId: string }) => o.userId), [kamala]);
    assert.equal(byName.json.data[0].maskedNic, '•••••567V');
    assert.equal(byName.json.data[0].hasNic, true);
    assert.equal(byName.json.data[0].username, 'kamala');
    assert.equal(byName.json.data[0].roleName, 'FRONT_DESK');
    assert.equal(byName.json.data[0].branchName, 'Colombo');
    assert.ok(!byName.text.includes('851234567V') && !('nic' in byName.json.data[0]), 'raw NIC never returned');
    assert.equal((await api('/api/users/search', { method: 'POST', cookie: adminCookie, body: { query: 'kamala.officer@' } })).json.data.length, 1);
    assert.equal((await api('/api/users/search', { method: 'POST', cookie: adminCookie, body: { query: '555-0101' } })).json.data.length, 1, 'legacy formatted phone matches digits');
    assert.equal((await api('/api/users/search', { method: 'POST', cookie: adminCookie, body: { nic: '851234567v' } })).json.data.length, 1);
    for (const probe of [{ nic: '851234567' }, { query: '4567V' }, { query: '85123456' }]) {
      const partial = await api('/api/users/search', { method: 'POST', cookie: adminCookie, body: probe });
      assert.equal(partial.json.data.length, 0, `partial NIC ${JSON.stringify(probe)} matches nothing`);
    }
    for (const query of ['%%', '__', "' OR '1'='1", "x'); DROP TABLE officer; --"]) {
      const result = await api('/api/users/search', { method: 'POST', cookie: adminCookie, body: { query } });
      assert.equal(result.status, 200, query);
      assert.equal(result.json.data.length, 0, query);
    }
    assert.equal(await officerCount(), officersBefore, 'injection attempts changed nothing');
    assert.equal((await api('/api/users/search', { method: 'POST', cookie: adminCookie, body: {} })).status, 400);
    // The non-login system principal has no officer row and is never reachable.
    assert.equal((await api('/api/users/not-a-uuid', { cookie: adminCookie })).status, 404);
    assert.equal((await api(`/api/users/${UNKNOWN_OFFICER}`, { cookie: adminCookie })).status, 404);
    assert.equal((await api('/api/users/01a0d81b-502c-7c85-95b8-401c6323f1db', { cookie: adminCookie })).status, 404);
    const detail = await api(`/api/users/${kamala}`, { cookie: adminCookie });
    assert.equal(detail.json.data.fullName, 'Kamala Officer');
    assert.ok(!detail.text.includes('851234567V'));

    // 3. Create: normalization, audit, temporary password, duplicates.
    const created = await api('/api/users', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        fullName: ' Nimal Perera ',
        username: ' Nimal.Perera ',
        email: ' Nimal@Example.COM ',
        phone: '077 123 4567',
        nic: ' 901234567v ',
        branchId: colomboId,
        roleId: roleIds.FRONT_DESK,
      },
    });
    assert.equal(created.status, 201, created.text);
    const nimal = created.json.data.userId as string;
    assert.equal(created.json.data.fullName, 'Nimal Perera');
    assert.equal(created.json.data.username, 'nimal.perera');
    assert.equal(created.json.data.email, 'nimal@example.com');
    assert.equal(created.json.data.phone, '0771234567');
    assert.equal(created.json.data.maskedNic, '•••••567V');
    assert.equal(created.json.data.roleName, 'FRONT_DESK');
    assert.equal(created.json.data.active, true);
    assert.ok(!created.text.includes('901234567V'), 'raw NIC never returned');
    const temporaryPassword = created.json.data.temporaryPassword;
    assert.ok(typeof temporaryPassword === 'string' && temporaryPassword.length >= 8, 'a temporary password is issued once');
    assert.equal((await admin.query('SELECT nic FROM officer WHERE officer_id = $1', [nimal])).rows[0].nic, '901234567V');
    const createAudit = await audits(nimal);
    assert.equal(createAudit.length, 1);
    assert.equal(createAudit[0].action, 'CREATE');
    assert.equal(createAudit[0].user_id, adminId);
    assert.ok(!createAudit[0].after_value.includes('901234567V'), 'NIC redacted in audit');
    assert.equal(JSON.parse(createAudit[0].after_value).tempCredentialIssued, true);
    const nimalCookie = await login('nimal.perera', temporaryPassword);
    assert.equal((await api('/api/auth/session', { cookie: nimalCookie })).status, 200);

    const withPassword = await api('/api/users', {
      method: 'POST',
      cookie: adminCookie,
      body: {
        fullName: 'Provided Officer',
        username: 'provided.officer',
        password: 'ProvidedPass123',
        branchId: colomboId,
        roleId: roleIds.SERVICE_STAFF,
      },
    });
    assert.equal(withPassword.status, 201, withPassword.text);
    assert.equal(withPassword.json.data.temporaryPassword, undefined, 'no temporary password when the admin supplies one');
    assert.equal(JSON.parse((await audits(withPassword.json.data.userId))[0].after_value).tempCredentialIssued, false);
    assert.equal((await rawLogin('provided.officer', 'ProvidedPass123')).status, 200);
    assert.equal((await rawLogin('provided.officer', 'wrong-password-1')).status, 401);

    assert.equal((await api('/api/users', {
      method: 'POST',
      cookie: adminCookie,
      body: { fullName: 'Impostor', username: 'NIMAL.PERERA', branchId: colomboId, roleId: roleIds.FRONT_DESK },
    })).json.error.code, 'USERNAME_EXISTS');
    assert.equal((await api('/api/users', {
      method: 'POST',
      cookie: adminCookie,
      body: { fullName: 'Impostor', username: 'imp.officer', nic: ' 851234567v', branchId: colomboId, roleId: roleIds.FRONT_DESK },
    })).json.error.code, 'NIC_EXISTS');
    const badBranch = await api('/api/users', {
      method: 'POST',
      cookie: adminCookie,
      body: { fullName: 'X', username: 'bad.branch', branchId: UNKNOWN_OFFICER, roleId: roleIds.FRONT_DESK },
    });
    assert.equal(badBranch.status, 400);
    assert.ok(badBranch.json.error.fields.branchId);
    const badRole = await api('/api/users', {
      method: 'POST',
      cookie: adminCookie,
      body: { fullName: 'X', username: 'bad.role', branchId: colomboId, roleId: UNKNOWN_OFFICER },
    });
    assert.equal(badRole.status, 400);
    assert.ok(badRole.json.error.fields.roleId);
    assert.ok((await api('/api/users', {
      method: 'POST',
      cookie: adminCookie,
      body: { username: 'no.name', branchId: colomboId, roleId: roleIds.FRONT_DESK },
    })).json.error.fields.fullName);
    assert.ok((await api('/api/users', {
      method: 'POST',
      cookie: adminCookie,
      body: { fullName: 'A', username: 'bad.email', email: 'bad', branchId: colomboId, roleId: roleIds.FRONT_DESK },
    })).json.error.fields.email);
    assert.equal(await officerCount(), officersBefore + 2, 'only the two successful creates added officers');

    // Concurrent creates of the same username: the identity lock lets one through.
    const raced = await Promise.all(['Race One', 'Race Two'].map((fullName) =>
      api('/api/users', {
        method: 'POST',
        cookie: adminCookie,
        body: { fullName, username: 'race.officer', branchId: colomboId, roleId: roleIds.FRONT_DESK },
      })));
    assert.deepEqual(raced.map((r) => r.status).sort(), [201, 409], JSON.stringify(raced.map((r) => r.json)));

    // 4. Update: changed fields only, NIC conflicts, role/branch reassignment.
    const patched = await api(`/api/users/${nimal}`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { phone: '0779998888', fullName: 'Nimal Perera' },
    });
    assert.equal(patched.status, 200, patched.text);
    assert.equal(patched.json.data.phone, '0779998888');
    const updateAudit = (await audits(nimal)).at(-1);
    assert.equal(updateAudit.action, 'UPDATE');
    assert.deepEqual(JSON.parse(updateAudit.before_value), { phone: '0771234567' }, 'only changed fields are audited');
    assert.deepEqual(JSON.parse(updateAudit.after_value), { phone: '0779998888' });

    const auditCount = (await audits(nimal)).length;
    const noop = await api(`/api/users/${nimal}`, { method: 'PATCH', cookie: adminCookie, body: { email: 'NIMAL@example.com' } });
    assert.equal(noop.status, 200);
    assert.equal((await audits(nimal)).length, auditCount, 'a no-op update writes no audit');

    assert.equal((await api(`/api/users/${nimal}`, { method: 'PATCH', cookie: adminCookie, body: { nic: '851234567V' } })).json.error.code, 'NIC_EXISTS');
    const reassigned = await api(`/api/users/${nimal}`, { method: 'PATCH', cookie: adminCookie, body: { roleId: roleIds.BRANCH_MANAGER } });
    assert.equal(reassigned.status, 200);
    assert.equal(reassigned.json.data.roleName, 'BRANCH_MANAGER');
    const roleAudit = (await audits(nimal)).at(-1);
    assert.equal(roleAudit.action, 'UPDATE');
    assert.equal(JSON.parse(roleAudit.before_value).roleId, roleIds.FRONT_DESK);
    assert.equal(JSON.parse(roleAudit.after_value).roleId, roleIds.BRANCH_MANAGER);
    const moved = await api(`/api/users/${nimal}`, { method: 'PATCH', cookie: adminCookie, body: { branchId: kandyId } });
    assert.equal(moved.status, 200);
    assert.equal(moved.json.data.branchName, 'Kandy');

    // A password reset invalidates the officer's existing cookie (M1-S08).
    const reset = await api(`/api/users/${nimal}`, { method: 'PATCH', cookie: adminCookie, body: { password: 'RotatedPass456' } });
    assert.equal(reset.status, 200, reset.text);
    const resetAudit = (await audits(nimal)).at(-1);
    assert.equal(resetAudit.action, 'UPDATE');
    assert.equal(JSON.parse(resetAudit.after_value).password, '[REDACTED]');
    assert.ok(!resetAudit.after_value.includes('RotatedPass456'), 'the raw password is never audited');
    assert.equal((await api('/api/auth/session', { cookie: nimalCookie })).status, 401, 'old cookie is dead');
    assert.equal((await rawLogin('nimal.perera', temporaryPassword)).status, 401, 'old password is dead');
    assert.equal((await rawLogin('nimal.perera', 'RotatedPass456')).status, 200, 'new password works');
    assert.equal((await api(`/api/users/${UNKNOWN_OFFICER}`, { method: 'PATCH', cookie: adminCookie, body: { fullName: 'Ghost' } })).status, 404);
    assert.equal((await api(`/api/users/${nimal}`, { method: 'PATCH', cookie: adminCookie, body: {} })).status, 400);
    assert.ok((await api(`/api/users/${nimal}`, { method: 'PATCH', cookie: adminCookie, body: { username: 'hax' } })).json.error.fields.username);

    // 5. Disable/reactivate: soft flag, immediate session death, no deletion.
    const kamalaCookie = await login('kamala');
    assert.equal((await api(`/api/users/${adminId}/disable`, { method: 'POST', cookie: adminCookie, body: {} })).json.error.code, 'SELF_DISABLE_FORBIDDEN');
    assert.equal((await audits(adminId)).length, 0, 'a refused self-disable writes no audit');

    const disabled = await api(`/api/users/${kamala}/disable`, { method: 'POST', cookie: adminCookie, body: {} });
    assert.equal(disabled.status, 200, disabled.text);
    assert.equal(disabled.json.data.active, false);
    const flags = (await admin.query(
      'SELECT o.active AS officer_active, u.active AS account_active FROM officer o JOIN user_account u ON u.user_id = o.officer_id WHERE o.officer_id = $1',
      [kamala],
    )).rows[0];
    assert.equal(flags.officer_active, false);
    assert.equal(flags.account_active, false);
    const disableAudit = (await audits(kamala)).at(-1);
    assert.equal(disableAudit.action, 'DEACTIVATE');
    assert.equal(disableAudit.user_id, adminId);
    assert.deepEqual(JSON.parse(disableAudit.before_value), { active: true });
    assert.deepEqual(JSON.parse(disableAudit.after_value), { active: false });
    assert.equal((await api('/api/auth/session', { cookie: kamalaCookie })).status, 401, 'disabled session dies immediately');
    assert.equal((await rawLogin('kamala', PASSWORD)).status, 403, 'disabled login is refused');
    assert.equal((await api(`/api/users/${kamala}`, { method: 'PATCH', cookie: adminCookie, body: { fullName: 'Edited' } })).json.error.code, 'OFFICER_INACTIVE');
    assert.equal((await api('/api/users/search', { method: 'POST', cookie: adminCookie, body: { query: 'Kamala Officer' } })).json.data.length, 0);
    const withInactive = await api('/api/users/search', { method: 'POST', cookie: adminCookie, body: { query: 'Kamala Officer', includeInactive: true } });
    assert.equal(withInactive.json.data[0].active, false);
    assert.equal((await api(`/api/users/${kamala}/disable`, { method: 'POST', cookie: adminCookie, body: {} })).json.error.code, 'ALREADY_INACTIVE');
    assert.equal(await officerCount(), officersBefore + 3, 'no hard deletion (FR-074)');
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM audit_log WHERE entity_name = $1 AND user_id = $2', ['officer', kamala])).rows[0].n, 0, 'the disabled officer keeps no lost history rows');

    const reactivated = await api(`/api/users/${kamala}/reactivate`, { method: 'POST', cookie: adminCookie, body: {} });
    assert.equal(reactivated.status, 200);
    assert.equal(reactivated.json.data.active, true);
    assert.equal((await audits(kamala)).at(-1).action, 'REACTIVATE');
    assert.equal((await rawLogin('kamala', PASSWORD)).status, 200, 'login restored');
    assert.equal((await api(`/api/users/${kamala}/reactivate`, { method: 'POST', cookie: adminCookie, body: {} })).json.error.code, 'ALREADY_ACTIVE');

    // 6. Limit and truncation.
    for (let i = 0; i < 4; i += 1) {
      const user = await admin.query('INSERT INTO user_account (username, password_hash) VALUES ($1, $2) RETURNING user_id', [`bulk${i}`, hash]);
      await admin.query(
        'INSERT INTO officer (officer_id, full_name, phone, branch_id, role_id) VALUES ($1, $2, $3, $4, $5)',
        [user.rows[0].user_id, `Bulk Officer ${i}`, `0113000${i}00`, colomboId, roleIds.SERVICE_STAFF],
      );
    }
    const limited = await api('/api/users/search', { method: 'POST', cookie: adminCookie, body: { query: 'Bulk Officer', limit: 3 } });
    assert.equal(limited.json.data.length, 3);
    assert.deepEqual(limited.json.meta, { limit: 3, truncated: true });
  } finally {
    await close?.();
    await appPool?.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    await admin.end();
  }
});
