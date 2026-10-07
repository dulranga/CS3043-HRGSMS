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
import { createBranches, validateBranchCreateInput, validateBranchSearchInput, validateBranchUpdateInput } from '../src/branches';
import { createAuthRouter } from '../src/routes/authRoutes';
import { createBranchRouter } from '../src/routes/branchRoutes';

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
  'm2_001_room_catalogue.sql',
  'm2_002_booking.sql',
  'm2_003_room_inventory.sql',
  'm2_004_booking_room_assignment.sql',
  'm2_005_reservation_integrity_guards.sql',
].map((file) => readFileSync(path.join(migrationsDir, file), 'utf8'));

const SECRET = 'test-session-secret-0123456789-abcdefghijklmnop';
const PASSWORD = 'correct-horse-battery';

test('M1-S20 branch input validation', () => {
  const created = validateBranchCreateInput({ name: '  Negombo  ', city: ' Negombo ', address: ' 1 Beach Road ', active: false });
  assert.deepEqual(created.value, { name: 'Negombo', city: 'Negombo', address: '1 Beach Road', active: false });
  assert.deepEqual(validateBranchCreateInput({ name: 'A', city: 'B' }).value, {
    name: 'A', city: 'B', address: null, active: true,
  });
  assert.ok(validateBranchCreateInput({ name: '   ', city: 'B' }).errors?.name);
  assert.ok(validateBranchCreateInput({ name: 'A' }).errors?.city);
  assert.ok(validateBranchCreateInput({ name: 'A', city: 'B', active: 'yes' }).errors?.active);
  assert.ok(validateBranchCreateInput({ name: 'A', city: 'B', address: 5 }).errors?.address);
  assert.ok(validateBranchCreateInput({ name: 'A', city: 'B', extra: 1 }).errors?.extra);
  assert.ok(validateBranchCreateInput([]).errors?.body);

  assert.deepEqual(validateBranchUpdateInput({ name: ' C ' }).value, { name: 'C' });
  assert.deepEqual(validateBranchUpdateInput({ address: null }).value, { address: null });
  assert.ok(validateBranchUpdateInput({}).errors?.body, 'at least one field is required');
  assert.ok(validateBranchUpdateInput({ name: null }).errors?.name);
  assert.ok(validateBranchUpdateInput({ city: '  ' }).errors?.city);
  assert.ok(validateBranchUpdateInput({ address: 'x'.repeat(65536) }).errors?.address);
  assert.ok(validateBranchUpdateInput({ active: false }).errors?.active, 'active is not editable through PATCH');
  assert.ok(validateBranchUpdateInput(null).errors?.body);

  assert.deepEqual(validateBranchSearchInput({ active: 'true', search: ' col ' }).value, { active: true, search: 'col' });
  assert.deepEqual(validateBranchSearchInput({}).value, { active: null, search: null });
  assert.ok(validateBranchSearchInput({ active: 'maybe' }).errors?.active);
  assert.ok(validateBranchSearchInput({ search: 'x'.repeat(101) }).errors?.search);
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

test('M1-S20 audited branch administration, FR-008/AT-25 guard and permissions', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const schema = `m1_branch_${randomBytes(8).toString('hex')}`;
  const directUrl = new URL(process.env.PG_URL);
  directUrl.hostname = directUrl.hostname.replace('-pooler.', '.');
  const admin = new Client({ connectionString: directUrl.toString() });
  await admin.connect();
  let appPool: Pool | undefined;
  let close: (() => Promise<void>) | undefined;
  let raceClient: Client | undefined;

  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET search_path TO "${schema}"`);
    assert.equal((await admin.query('SELECT current_schema() AS schema')).rows[0].schema, schema);
    for (const sql of migrations) await admin.query(sql);

    appPool = new Pool({ connectionString: directUrl.toString(), options: `-c search_path=${schema}`, max: 6 });
    assert.equal((await appPool.query('SELECT current_schema() AS schema')).rows[0].schema, schema);

    const colomboId = (await admin.query("SELECT branch_id FROM branch WHERE name = 'Colombo'")).rows[0].branch_id;
    const kandyId = (await admin.query("SELECT branch_id FROM branch WHERE name = 'Kandy'")).rows[0].branch_id;
    const galleId = (await admin.query("SELECT branch_id FROM branch WHERE name = 'Galle'")).rows[0].branch_id;
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
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          user.rows[0].user_id,
          `Officer ${role}`,
          `${role.toLowerCase()}@skynest.example`,
          '0112000000',
          null,
          colomboId,
          roleIds[role],
        ],
      );
    }
    const guestId = (await admin.query(
      "INSERT INTO guest (full_name, email) VALUES ('Online Ona', 'ona@example.com') RETURNING guest_id",
    )).rows[0].guest_id;
    const guestUser = (await admin.query(
      'INSERT INTO user_account (username, password_hash) VALUES ($1, $2) RETURNING user_id',
      ['guest.one', hash],
    )).rows[0].user_id;
    await admin.query('INSERT INTO guest_account (guest_id, user_id) VALUES ($1, $2)', [guestId, guestUser]);

    // Kandy inventory + a live BOOKED assignment for the AT-25 deactivation guard.
    const roomTypeId = (await admin.query(
      "INSERT INTO room_type (name, capacity, base_daily_rate) VALUES ('Branch Test Type', 3, 18000) RETURNING room_type_id",
    )).rows[0].room_type_id;
    const kandyRoomId = (await admin.query(
      'INSERT INTO room (room_number, branch_id, room_type_id) VALUES ($1, $2, $3) RETURNING room_id',
      ['K-1', kandyId, roomTypeId],
    )).rows[0].room_id;
    await admin.query('BEGIN');
    const bookingId = (await admin.query(
      `INSERT INTO booking (booking_ref, booking_channel, guest_id, created_by)
       VALUES ($1, 'FRONT_DESK', $2, $3) RETURNING booking_id`,
      [`BRANCH-${randomBytes(4).toString('hex')}`, guestId, officerIds.FRONT_DESK],
    )).rows[0].booking_id;
    const kandyLineId = (await admin.query(
      `INSERT INTO booking_room_line (booking_id, stay_start_date, stay_end_date, guest_count, rate_snapshot)
       VALUES ($1, '2027-05-01', '2027-05-04', 1, 18000) RETURNING line_id`,
      [bookingId],
    )).rows[0].line_id;
    await admin.query(
      `INSERT INTO booking_room_line_status_history (line_id, old_status, new_status, changed_by, reason)
       VALUES ($1, NULL, 'BOOKED', $2, 'Initial booking')`,
      [kandyLineId, officerIds.FRONT_DESK],
    );
    await admin.query('INSERT INTO booking_room_assignment (line_id, room_id) VALUES ($1, $2)', [kandyLineId, kandyRoomId]);
    await admin.query('COMMIT');

    const auth = createAuth({ db: appPool, secret: SECRET, cookieSecure: false, idleMinutes: async () => 30 });
    const authorization = createAuthorization(auth.authenticate);
    const app = express();
    app.use(express.json());
    app.use('/api/auth', createAuthRouter(auth));
    app.use('/api', createBranchRouter(createBranches({ db: appPool }), {
      requireRead: authorization.staff('branch.read'),
      requireWrite: authorization.staff('branch.write'),
    }));
    const server = await listen(app);
    close = server.close;

    const cookies = new Map<string, string>();
    async function cookieFor(username: string) {
      const cached = cookies.get(username);
      if (cached) return cached;
      const response = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: PASSWORD }),
      });
      assert.equal(response.status, 200, `login ${username}`);
      const header = response.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
      assert.ok(header);
      const cookie = header.split(';')[0];
      cookies.set(username, cookie);
      return cookie;
    }
    async function api(
      as: string | null,
      pathname: string,
      { method = 'GET', body }: { method?: string; body?: unknown } = {},
    ) {
      const headers: Record<string, string> = {};
      if (as) headers.cookie = await cookieFor(as);
      if (body !== undefined) headers['content-type'] = 'application/json';
      const response = await fetch(`${server.baseUrl}${pathname}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      return { status: response.status, json: text ? JSON.parse(text) : null };
    }
    const roleUser = (role: string) => role.toLowerCase();

    // Anonymous access to any branch route is rejected.
    for (const [method, pathname] of [
      ['GET', '/api/branches'], ['GET', `/api/branches/${galleId}`], ['POST', '/api/branches'],
      ['PATCH', `/api/branches/${galleId}`], ['POST', `/api/branches/${galleId}/deactivate`],
    ] as const) {
      const result = await api(null, pathname, { method, body: method === 'GET' ? undefined : {} });
      assert.equal(result.status, 401, `${method} ${pathname}`);
      assert.equal(result.json.error.code, 'AUTHENTICATION_REQUIRED');
    }

    // Reads: every staff role may list/read; a guest never may.
    const list = await api('front_desk', '/api/branches');
    assert.equal(list.status, 200);
    assert.ok(list.json.data.length >= 3);
    assert.equal((await api('auditor', `/api/branches/${galleId}`)).status, 200);
    assert.equal((await api('guest.one', '/api/branches')).status, 403);
    assert.equal((await api('guest.one', `/api/branches/${galleId}`)).status, 403);

    // Writes: SYSTEM_ADMINISTRATOR only (FR-008).
    for (const role of STAFF_ROLES.filter((r) => r !== 'SYSTEM_ADMINISTRATOR')) {
      const denied = await api(roleUser(role), '/api/branches', {
        method: 'POST',
        body: { name: `Denied ${role}`, city: 'X' },
      });
      assert.equal(denied.status, 403, `${role} create branch`);
      const deactivateDenied = await api(roleUser(role), `/api/branches/${galleId}/deactivate`, { method: 'POST', body: {} });
      assert.equal(deactivateDenied.status, 403, `${role} deactivate branch`);
    }
    assert.equal((await api('guest.one', '/api/branches', { method: 'POST', body: { name: 'G', city: 'C' } })).status, 403);
    const deniedRows = await admin.query("SELECT count(*)::int AS n FROM branch WHERE name LIKE 'Denied %' OR name = 'G'");
    assert.equal(deniedRows.rows[0].n, 0, 'forbidden writes created nothing');

    // Validation is strict.
    const invalid = await api('system_administrator', '/api/branches', { method: 'POST', body: { name: '  ', city: 'C' } });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.json.error.code, 'VALIDATION_ERROR');
    assert.ok(invalid.json.error.fields.name);

    // Create is audited with the acting administrator.
    const created = await api('system_administrator', '/api/branches', {
      method: 'POST',
      body: { name: 'Negombo', city: 'Negombo', address: '1 Beach Road' },
    });
    assert.equal(created.status, 201);
    const negomboId = created.json.data.branchId as string;
    assert.equal(created.json.data.active, true);
    const createAudit = await admin.query(
      "SELECT action, user_id, after_value FROM audit_log WHERE entity_name = 'branch' AND entity_id = $1 AND action = 'CREATE'",
      [negomboId],
    );
    assert.equal(createAudit.rows.length, 1);
    assert.equal(createAudit.rows[0].user_id, officerIds.SYSTEM_ADMINISTRATOR);
    assert.equal(JSON.parse(createAudit.rows[0].after_value).name, 'Negombo');

    // Edit diffs only changed fields and is audited; a no-op writes no audit row.
    const updated = await api('system_administrator', `/api/branches/${negomboId}`, {
      method: 'PATCH',
      body: { city: 'Negombo City', address: null },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.json.data.city, 'Negombo City');
    assert.equal(updated.json.data.address, null);
    const updateAudit = await admin.query(
      "SELECT before_value, after_value FROM audit_log WHERE entity_name = 'branch' AND entity_id = $1 AND action = 'UPDATE'",
      [negomboId],
    );
    assert.equal(updateAudit.rows.length, 1);
    assert.deepEqual(JSON.parse(updateAudit.rows[0].after_value), { city: 'Negombo City', address: null });
    const noop = await api('system_administrator', `/api/branches/${negomboId}`, { method: 'PATCH', body: { name: 'Negombo' } });
    assert.equal(noop.status, 200);
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM audit_log WHERE entity_id = $1 AND action = 'UPDATE'", [negomboId])).rows[0].n, 1);

    // Unknown / malformed IDs are a clean 404, not a database error.
    assert.equal((await api('system_administrator', '/api/branches/01900000-0000-7000-8000-0000000000ff')).status, 404);
    assert.equal((await api('system_administrator', '/api/branches/not-a-uuid')).status, 404);

    // AT-25: a current BOOKED assignment blocks branch deactivation and no DEACTIVATE audit is written.
    const blocked = await api('system_administrator', `/api/branches/${kandyId}/deactivate`, { method: 'POST', body: { reason: 'Retire Kandy' } });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.json.error.code, 'BRANCH_HAS_ACTIVE_ASSIGNMENTS');
    assert.equal((await admin.query('SELECT active FROM branch WHERE branch_id = $1', [kandyId])).rows[0].active, true);
    assert.equal(
      (await admin.query("SELECT count(*)::int AS n FROM audit_log WHERE entity_id = $1 AND action = 'DEACTIVATE'", [kandyId])).rows[0].n,
      0,
    );
    // Availability sees no inactive inventory and the Kandy history is untouched.
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM branch WHERE branch_id = $1', [kandyId])).rows[0].n, 1);

    // Deactivate/reactivate a branch with no live assignments: audited soft flag, never a delete.
    const galleOff = await api('system_administrator', `/api/branches/${galleId}/deactivate`, { method: 'POST', body: { reason: 'Seasonal' } });
    assert.equal(galleOff.status, 200);
    assert.equal(galleOff.json.data.active, false);
    assert.equal(
      (await admin.query('SELECT count(*)::int AS n FROM branch WHERE branch_id = $1', [galleId])).rows[0].n,
      1,
      'deactivation preserves the row',
    );
    const deactivateAudit = await admin.query(
      "SELECT action, after_value FROM audit_log WHERE entity_id = $1 AND action = 'DEACTIVATE'",
      [galleId],
    );
    assert.equal(deactivateAudit.rows.length, 1);
    assert.equal(JSON.parse(deactivateAudit.rows[0].after_value).reason, 'Seasonal');
    assert.equal((await api('system_administrator', `/api/branches/${galleId}/deactivate`, { method: 'POST', body: {} })).status, 409, 'already inactive');
    const back = await api('system_administrator', `/api/branches/${galleId}/reactivate`, { method: 'POST', body: {} });
    assert.equal(back.status, 200);
    assert.equal(back.json.data.active, true);
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM audit_log WHERE entity_id = $1 AND action = 'REACTIVATE'", [galleId])).rows[0].n, 1);

    // After the live line is validly closed, the same deactivation succeeds.
    await admin.query('BEGIN');
    await admin.query('UPDATE booking_room_line SET status = $2 WHERE line_id = $1', [kandyLineId, 'CANCELLED']);
    await admin.query(
      `INSERT INTO booking_room_line_status_history (line_id, old_status, new_status, changed_by, reason)
       VALUES ($1, 'BOOKED', 'CANCELLED', $2, 'Guest request')`,
      [kandyLineId, officerIds.FRONT_DESK],
    );
    await admin.query('UPDATE booking_room_assignment SET unassigned_at = now() WHERE line_id = $1', [kandyLineId]);
    await admin.query('COMMIT');
    const afterClose = await api('system_administrator', `/api/branches/${kandyId}/deactivate`, { method: 'POST', body: {} });
    assert.equal(afterClose.status, 200);
    assert.equal(afterClose.json.data.active, false);

    // Literal search: `%` is data, not a wildcard (AT-10), and the active filter works.
    const literal = await api('front_desk', '/api/branches?search=%25');
    assert.equal(literal.status, 200);
    assert.equal(literal.json.data.length, 0);
    const activeOnly = await api('front_desk', '/api/branches?active=true');
    assert.equal(activeOnly.status, 200);
    assert.ok(activeOnly.json.data.every((b: { active: boolean }) => b.active));

    // Concurrency: a booking that is still open in another session cannot slip past deactivation (AT-25).
    const raceBranch = (await admin.query(
      "INSERT INTO branch (name, city) VALUES ('Raceville', 'Raceville') RETURNING branch_id",
    )).rows[0].branch_id;
    const raceRoom = (await admin.query(
      'INSERT INTO room (room_number, branch_id, room_type_id) VALUES ($1, $2, $3) RETURNING room_id',
      ['R-1', raceBranch, roomTypeId],
    )).rows[0].room_id;
    const raceBooking = (await admin.query(
      `INSERT INTO booking (booking_ref, booking_channel, guest_id, created_by)
       VALUES ($1, 'FRONT_DESK', $2, $3) RETURNING booking_id`,
      [`RACE-${randomBytes(4).toString('hex')}`, guestId, officerIds.FRONT_DESK],
    )).rows[0].booking_id;

    raceClient = new Client({ connectionString: directUrl.toString() });
    await raceClient.connect();
    await raceClient.query(`SET search_path TO "${schema}"`);
    await raceClient.query('BEGIN');
    const raceLine = (await raceClient.query(
      `INSERT INTO booking_room_line (booking_id, stay_start_date, stay_end_date, guest_count, rate_snapshot)
       VALUES ($1, '2027-08-01', '2027-08-03', 1, 18000) RETURNING line_id`,
      [raceBooking],
    )).rows[0].line_id;
    await raceClient.query(
      `INSERT INTO booking_room_line_status_history (line_id, old_status, new_status, changed_by, reason)
       VALUES ($1, NULL, 'BOOKED', $2, 'Initial booking')`,
      [raceLine, officerIds.FRONT_DESK],
    );
    await raceClient.query('INSERT INTO booking_room_assignment (line_id, room_id) VALUES ($1, $2)', [raceLine, raceRoom]);
    const racingDeactivate = api('system_administrator', `/api/branches/${raceBranch}/deactivate`, { method: 'POST', body: {} });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await raceClient.query('COMMIT');
    const raceResult = await racingDeactivate;
    assert.equal(raceResult.status, 409, 'concurrent booking blocks deactivation');
    assert.equal(raceResult.json.error.code, 'BRANCH_HAS_ACTIVE_ASSIGNMENTS');
    assert.equal((await admin.query('SELECT active FROM branch WHERE branch_id = $1', [raceBranch])).rows[0].active, true);
  } finally {
    if (raceClient) {
      try { await raceClient.query('ROLLBACK'); } catch {}
      try { await raceClient.end(); } catch {}
    }
    if (close) await close();
    if (appPool) await appPool.end();
    try { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } catch {}
    await admin.end();
  }
});
