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
import { maskNic } from '../src/guestIdentity';
import { createGuestProfiles, validateGuestSearchInput, validateGuestWriteInput } from '../src/guestProfiles';
import { createAuthRouter } from '../src/routes/authRoutes';
import { createGuestProfileRouter } from '../src/routes/guestProfileRoutes';

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
const UNKNOWN_GUEST = '01900000-0000-7000-8000-0000000000ff';

test('M1-S11 NIC masking and input validation', () => {
  assert.equal(maskNic('901234567V'), '•••••567V');
  assert.equal(maskNic('200012345678'), '•••••5678');
  assert.equal(maskNic('AB1'), '•••••', 'short NICs reveal nothing');
  assert.equal(maskNic(null), null);

  assert.deepEqual(validateGuestSearchInput({ query: '  Per ' }).value, { query: 'Per', nic: null, includeInactive: false, limit: 20 });
  assert.deepEqual(validateGuestSearchInput({ nic: ' 901234567v ' }).value?.nic, '901234567V');
  assert.ok(validateGuestSearchInput({}).errors?.query, 'a criterion is required');
  assert.ok(validateGuestSearchInput({ query: 'a' }).errors?.query);
  assert.ok(validateGuestSearchInput({ query: 'x'.repeat(101) }).errors?.query);
  assert.ok(validateGuestSearchInput({ query: 5 }).errors?.query);
  assert.ok(validateGuestSearchInput({ query: 'ab', limit: 51 }).errors?.limit);
  assert.ok(validateGuestSearchInput({ query: 'ab', limit: 1.5 }).errors?.limit);
  assert.ok(validateGuestSearchInput({ query: 'ab', includeInactive: 'yes' }).errors?.includeInactive);
  assert.ok(validateGuestSearchInput({ query: 'ab', guestId: 'x' }).errors?.guestId);
  assert.ok(validateGuestSearchInput([]).errors);

  assert.deepEqual(validateGuestWriteInput({ fullName: ' A ', phone: '(077) 123-4567', nic: '1v' }, false).value, {
    fields: { fullName: 'A', email: null, phone: '0771234567', nic: '1V' },
    confirmNotDuplicate: false,
  });
  assert.ok(validateGuestWriteInput({ fullName: 'A' }, false).errors?.contact, 'FR-017');
  assert.ok(validateGuestWriteInput({ email: 'a@b.co' }, false).errors?.fullName);
  assert.ok(validateGuestWriteInput({ fullName: 'A', email: 'bad' }, false).errors?.email);
  assert.ok(validateGuestWriteInput({ fullName: 'A', email: 'a@b.co', active: false }, false).errors?.active);
  assert.ok(validateGuestWriteInput({ fullName: 'A', email: 'a@b.co', confirmNotDuplicate: 'y' }, false).errors?.confirmNotDuplicate);
  assert.deepEqual(validateGuestWriteInput({ email: null }, true).value?.fields, { email: null }, 'PATCH null clears');
  assert.ok(validateGuestWriteInput({ fullName: null }, true).errors?.fullName);
  assert.ok(validateGuestWriteInput({ fullName: '' }, true).errors?.fullName);
  assert.ok(validateGuestWriteInput({}, true).errors?.body);
  assert.ok(validateGuestWriteInput(null, true).errors?.body);
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

test('M1-S11 staff guest search/create/update/deactivate with privacy and permissions', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const schema = `m1_gp_${randomBytes(8).toString('hex')}`;
  // Session-scoped search_path needs the direct endpoint, not the pooler.
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
    const officerIds: Record<string, string> = {};
    for (const role of STAFF_ROLES) {
      const user = await admin.query(
        'INSERT INTO user_account (username, password_hash) VALUES ($1, $2) RETURNING user_id',
        [role.toLowerCase(), hash],
      );
      officerIds[role] = user.rows[0].user_id;
      await admin.query(
        `INSERT INTO officer (officer_id, full_name, branch_id, role_id)
         SELECT $1, $2, $3, role_id FROM role WHERE role_name = $4`,
        [user.rows[0].user_id, `Officer ${role}`, branchId, role],
      );
    }
    // An existing walk-in guest with a legacy formatted phone, plus an online guest.
    const kamala = (await admin.query(
      `INSERT INTO guest (full_name, email, phone, nic)
       VALUES ('Kamala Silva', 'Kamala.Silva@Example.com', '+94 77 555 0101', '851234567V') RETURNING guest_id`,
    )).rows[0].guest_id as string;
    const online = (await admin.query(
      "INSERT INTO guest (full_name, email) VALUES ('Online Ona', 'ona@example.com') RETURNING guest_id",
    )).rows[0].guest_id as string;
    const onaUser = (await admin.query(
      "INSERT INTO user_account (username, password_hash) VALUES ('ona', $1) RETURNING user_id",
      [hash],
    )).rows[0].user_id;
    await admin.query('INSERT INTO guest_account (guest_id, user_id) VALUES ($1, $2)', [online, onaUser]);

    const auth = createAuth({ db: appPool, secret: SECRET, cookieSecure: false, idleMinutes: async () => 30 });
    const authorization = createAuthorization(auth.authenticate);
    const app = express();
    app.use(express.json());
    app.use('/api/auth', createAuthRouter(auth));
    app.use('/api', createGuestProfileRouter(createGuestProfiles({ db: appPool }), {
      requireGuestManager: authorization.staff('guest.manage'),
    }));
    const server = await listen(app);
    close = server.close;

    async function rawLogin(username: string) {
      return fetch(`${server.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: PASSWORD }),
      });
    }
    async function login(username: string) {
      const response = await rawLogin(username);
      assert.equal(response.status, 200, `login ${username}`);
      const header = response.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
      assert.ok(header);
      return header.split(';')[0];
    }
    async function api(pathname: string, { method = 'GET', body, cookie }: { method?: string; body?: unknown; cookie?: string } = {}) {
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
    const audits = async (guestId: string) => (await admin.query(
      "SELECT action, user_id, before_value, after_value FROM audit_log WHERE entity_name = 'guest' AND entity_id = $1 ORDER BY changed_at, audit_id",
      [guestId],
    )).rows;

    // 1. Only FRONT_DESK reaches any route; guests and other roles are denied.
    const routes: { method: string; path: string; body?: unknown }[] = [
      { method: 'POST', path: '/api/guests/search', body: { query: 'Kamala' } },
      { method: 'POST', path: '/api/guests', body: { fullName: 'X', email: 'x@example.com' } },
      { method: 'GET', path: `/api/guests/${kamala}` },
      { method: 'PATCH', path: `/api/guests/${kamala}`, body: { fullName: 'Hijacked' } },
      { method: 'POST', path: `/api/guests/${kamala}/deactivate`, body: {} },
      { method: 'POST', path: `/api/guests/${kamala}/reactivate`, body: {} },
    ];
    for (const route of routes) {
      assert.equal((await api(route.path, { method: route.method, body: route.body })).status, 401, `${route.path} anonymous`);
    }
    const denied = [...STAFF_ROLES.filter((r) => r !== 'FRONT_DESK').map((r) => r.toLowerCase()), 'ona'];
    for (const username of denied) {
      const cookie = await login(username);
      for (const route of routes) {
        const result = await api(route.path, { method: route.method, body: route.body, cookie });
        assert.equal(result.status, 403, `${username} ${route.method} ${route.path}`);
      }
    }
    assert.equal((await admin.query('SELECT full_name FROM guest WHERE guest_id = $1', [kamala])).rows[0].full_name, 'Kamala Silva');
    assert.equal(await admin.query('SELECT count(*)::int AS n FROM guest').then((r) => r.rows[0].n), 2, 'denied requests created nothing');

    const desk = await login('front_desk');
    const deskId = officerIds.FRONT_DESK;

    // 2. Search: name/email/phone substring, exact NIC only, masked output.
    const byName = await api('/api/guests/search', { method: 'POST', cookie: desk, body: { query: 'silv' } });
    assert.equal(byName.status, 200);
    assert.equal(byName.headers.get('cache-control'), 'no-store');
    assert.deepEqual(byName.json.data.map((g: { guestId: string }) => g.guestId), [kamala]);
    assert.equal(byName.json.data[0].maskedNic, '•••••567V');
    assert.equal(byName.json.data[0].hasNic, true);
    assert.equal(byName.json.data[0].hasOnlineAccount, false);
    assert.ok(!byName.text.includes('851234567V') && !('nic' in byName.json.data[0]), 'raw NIC never returned');
    const byEmail = await api('/api/guests/search', { method: 'POST', cookie: desk, body: { query: 'KAMALA.SILVA@' } });
    assert.equal(byEmail.json.data.length, 1);
    const byPhone = await api('/api/guests/search', { method: 'POST', cookie: desk, body: { query: '555-0101' } });
    assert.deepEqual(byPhone.json.data.map((g: { guestId: string }) => g.guestId), [kamala], 'legacy formatted phone matches digits');
    const byNic = await api('/api/guests/search', { method: 'POST', cookie: desk, body: { nic: '851234567v' } });
    assert.deepEqual(byNic.json.data.map((g: { guestId: string }) => g.guestId), [kamala]);
    for (const probe of [{ nic: '851234567' }, { query: '4567V' }, { query: '8512' }]) {
      const partial = await api('/api/guests/search', { method: 'POST', cookie: desk, body: probe });
      assert.equal(partial.json.data.length, 0, `partial NIC ${JSON.stringify(probe)} matches nothing`);
    }
    // AT-10: wildcards and SQL are treated as literal data.
    for (const query of ['%%', '__', "' OR '1'='1", "x'); DROP TABLE guest; --"]) {
      const result = await api('/api/guests/search', { method: 'POST', cookie: desk, body: { query } });
      assert.equal(result.status, 200, query);
      assert.equal(result.json.data.length, 0, query);
    }
    assert.equal(await admin.query('SELECT count(*)::int AS n FROM guest').then((r) => r.rows[0].n), 2);
    assert.equal((await api('/api/guests/search', { method: 'POST', cookie: desk, body: {} })).status, 400);
    const onaSearch = await api('/api/guests/search', { method: 'POST', cookie: desk, body: { query: 'ona' } });
    assert.equal(onaSearch.json.data[0].hasOnlineAccount, true);

    // 3. Detail.
    assert.equal((await api('/api/guests/not-a-uuid', { cookie: desk })).status, 404);
    assert.equal((await api(`/api/guests/${UNKNOWN_GUEST}`, { cookie: desk })).status, 404);
    const detail = await api(`/api/guests/${kamala}`, { cookie: desk });
    assert.equal(detail.json.data.fullName, 'Kamala Silva');
    assert.ok(!detail.text.includes('851234567V'));

    // 4. Create with normalization, audit and duplicate rules.
    const created = await api('/api/guests', {
      method: 'POST',
      cookie: desk,
      body: { fullName: ' Nimal Perera ', email: ' Nimal@Example.COM ', phone: '077 123 4567', nic: '901234567v' },
    });
    assert.equal(created.status, 201, created.text);
    const nimal = created.json.data.guestId as string;
    assert.deepEqual(
      { ...created.json.data, guestId: undefined, createdAt: undefined, updatedAt: undefined },
      { guestId: undefined, fullName: 'Nimal Perera', email: 'nimal@example.com', phone: '0771234567', maskedNic: '•••••567V', hasNic: true, active: true, hasOnlineAccount: false, createdAt: undefined, updatedAt: undefined },
    );
    assert.equal((await admin.query('SELECT nic FROM guest WHERE guest_id = $1', [nimal])).rows[0].nic, '901234567V');
    const createAudit = await audits(nimal);
    assert.equal(createAudit.length, 1);
    assert.equal(createAudit[0].action, 'CREATE');
    assert.equal(createAudit[0].user_id, deskId);
    assert.ok(!createAudit[0].after_value.includes('901234567V'), 'NIC redacted in audit');
    assert.equal(JSON.parse(createAudit[0].after_value).source, 'STAFF');

    assert.equal((await api('/api/guests', { method: 'POST', cookie: desk, body: { fullName: 'No Contact' } })).json.error.fields.contact, 'an email address or phone number is required');
    const nicDup = await api('/api/guests', {
      method: 'POST',
      cookie: desk,
      body: { fullName: 'Impostor', email: 'imp@example.com', nic: ' 851234567v', confirmNotDuplicate: true },
    });
    assert.equal(nicDup.status, 409);
    assert.equal(nicDup.json.error.code, 'GUEST_NIC_EXISTS', 'a NIC match cannot be overridden');
    assert.deepEqual(nicDup.json.error.candidates, [{ guestId: kamala, fullName: 'Kamala Silva', active: true, maskedNic: '•••••567V', matchedOn: ['nic'] }]);
    assert.ok(!nicDup.text.includes('851234567V'));

    const phoneDup = await api('/api/guests', {
      method: 'POST',
      cookie: desk,
      body: { fullName: 'Sunil Silva', phone: '+94775550101', email: 'KAMALA.silva@example.com' },
    });
    assert.equal(phoneDup.status, 409);
    assert.equal(phoneDup.json.error.code, 'POSSIBLE_DUPLICATE');
    assert.deepEqual(phoneDup.json.error.candidates[0].matchedOn, ['email', 'phone']);
    const sunil = await api('/api/guests', {
      method: 'POST',
      cookie: desk,
      body: { fullName: 'Sunil Silva', phone: '+94775550101', confirmNotDuplicate: true },
    });
    assert.equal(sunil.status, 201, 'a confirmed family member sharing a phone is allowed');
    assert.equal(JSON.parse((await audits(sunil.json.data.guestId))[0].after_value).confirmedNotDuplicate, true);

    // Concurrent creates with the same new email: the identity lock lets only one through.
    const raced = await Promise.all(['Race One', 'Race Two'].map((fullName) =>
      api('/api/guests', { method: 'POST', cookie: desk, body: { fullName, email: 'race@example.com' } })));
    assert.deepEqual(raced.map((r) => r.status).sort(), [201, 409], JSON.stringify(raced.map((r) => r.json)));

    // 5. Update: changed fields only, duplicate checks exclude self, history intact.
    const bookingId = (await admin.query(
      `INSERT INTO booking (booking_ref, booking_channel, guest_id, created_by)
       VALUES ('BK-NIMAL-1', 'FRONT_DESK', $1, $2) RETURNING booking_id`,
      [nimal, deskId],
    )).rows[0].booking_id;
    await admin.query('BEGIN');
    const lineId = (await admin.query(
      `INSERT INTO booking_room_line (booking_id, stay_start_date, stay_end_date, guest_count, rate_snapshot)
       VALUES ($1, DATE '2026-12-01', DATE '2026-12-03', 2, 100) RETURNING line_id`,
      [bookingId],
    )).rows[0].line_id;
    await admin.query(
      "INSERT INTO booking_room_line_status_history (line_id, old_status, new_status, changed_by) VALUES ($1, NULL, 'BOOKED', $2)",
      [lineId, deskId],
    );
    const roomTypeId = (await admin.query(
      "INSERT INTO room_type (name, capacity, base_daily_rate) VALUES ('Deluxe', 2, 100) RETURNING room_type_id",
    )).rows[0].room_type_id;
    const roomId = (await admin.query(
      "INSERT INTO room (room_number, branch_id, room_type_id) VALUES ('101', $1, $2) RETURNING room_id",
      [branchId, roomTypeId],
    )).rows[0].room_id;
    await admin.query('INSERT INTO booking_room_assignment (line_id, room_id) VALUES ($1, $2)', [lineId, roomId]);
    await admin.query('COMMIT');

    const patched = await api(`/api/guests/${nimal}`, { method: 'PATCH', cookie: desk, body: { phone: '0779998888', fullName: 'Nimal Perera' } });
    assert.equal(patched.status, 200, patched.text);
    assert.equal(patched.json.data.phone, '0779998888');
    const updateAudit = (await audits(nimal)).at(-1);
    assert.equal(updateAudit.action, 'UPDATE');
    assert.deepEqual(JSON.parse(updateAudit.before_value), { phone: '0771234567' }, 'only changed fields are audited');
    assert.deepEqual(JSON.parse(updateAudit.after_value), { phone: '0779998888' });
    assert.equal((await admin.query('SELECT guest_id, booking_ref FROM booking WHERE booking_id = $1', [bookingId])).rows[0].booking_ref, 'BK-NIMAL-1', 'FR-021');

    const auditCount = (await audits(nimal)).length;
    const noop = await api(`/api/guests/${nimal}`, { method: 'PATCH', cookie: desk, body: { email: 'NIMAL@example.com' } });
    assert.equal(noop.status, 200);
    assert.equal((await audits(nimal)).length, auditCount, 'a no-op update writes no audit');
    assert.equal((await api(`/api/guests/${nimal}`, { method: 'PATCH', cookie: desk, body: { nic: '851234567V' } })).json.error.code, 'GUEST_NIC_EXISTS');
    assert.equal((await api(`/api/guests/${nimal}`, { method: 'PATCH', cookie: desk, body: { email: 'ona@example.com' } })).json.error.code, 'POSSIBLE_DUPLICATE');
    assert.equal((await api(`/api/guests/${nimal}`, { method: 'PATCH', cookie: desk, body: { email: 'ona@example.com', confirmNotDuplicate: true } })).status, 200);
    const noContact = await api(`/api/guests/${nimal}`, { method: 'PATCH', cookie: desk, body: { email: null, phone: null } });
    assert.equal(noContact.status, 400);
    assert.ok(noContact.json.error.fields.contact);
    assert.equal((await api(`/api/guests/${nimal}`, { method: 'PATCH', cookie: desk, body: { active: false } })).status, 400);
    assert.equal((await api(`/api/guests/${UNKNOWN_GUEST}`, { method: 'PATCH', cookie: desk, body: { fullName: 'Ghost' } })).status, 404);
    const nicCleared = await api(`/api/guests/${nimal}`, { method: 'PATCH', cookie: desk, body: { nic: null } });
    assert.equal(nicCleared.json.data.maskedNic, null);
    assert.equal(nicCleared.json.data.hasNic, false);

    // 6. Deactivation keeps history, is refused with open bookings and
    //    disables a linked online login until reactivated (FR-022).
    const blocked = await api(`/api/guests/${nimal}/deactivate`, { method: 'POST', cookie: desk, body: {} });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.json.error.code, 'GUEST_HAS_OPEN_BOOKINGS');
    assert.equal(blocked.json.error.openBookings, 1);
    assert.equal((await api(`/api/guests/${nimal}/deactivate`, { method: 'POST', cookie: desk, body: { reason: 7 } })).status, 400);

    assert.equal((await rawLogin('ona')).status, 200);
    const deactivated = await api(`/api/guests/${online}/deactivate`, { method: 'POST', cookie: desk, body: { reason: 'Duplicate profile' } });
    assert.equal(deactivated.status, 200, deactivated.text);
    assert.equal(deactivated.json.data.active, false);
    const deactivateAudit = (await audits(online)).at(-1);
    assert.equal(deactivateAudit.action, 'DEACTIVATE');
    assert.deepEqual(JSON.parse(deactivateAudit.after_value), { active: false, reason: 'Duplicate profile' });
    assert.equal((await rawLogin('ona')).status, 403, 'linked online account is disabled');
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM guest_account WHERE guest_id = $1', [online])).rows[0].n, 1, 'link preserved');
    assert.equal((await api(`/api/guests/${online}/deactivate`, { method: 'POST', cookie: desk })).json.error.code, 'GUEST_ALREADY_INACTIVE');
    assert.equal((await api(`/api/guests/${online}`, { method: 'PATCH', cookie: desk, body: { fullName: 'Edited' } })).json.error.code, 'GUEST_INACTIVE');
    assert.equal((await api('/api/guests/search', { method: 'POST', cookie: desk, body: { query: 'Online Ona' } })).json.data.length, 0);
    const withInactive = await api('/api/guests/search', { method: 'POST', cookie: desk, body: { query: 'Online Ona', includeInactive: true } });
    assert.equal(withInactive.json.data[0].active, false);

    const reactivated = await api(`/api/guests/${online}/reactivate`, { method: 'POST', cookie: desk });
    assert.equal(reactivated.status, 200);
    assert.equal((await audits(online)).at(-1).action, 'REACTIVATE');
    assert.equal((await api(`/api/guests/${online}/reactivate`, { method: 'POST', cookie: desk })).json.error.code, 'GUEST_ALREADY_ACTIVE');
    assert.equal((await rawLogin('ona')).status, 200, 'online login restored');

    // 7. Limit and truncation.
    for (let i = 0; i < 4; i += 1) {
      await admin.query("INSERT INTO guest (full_name, phone) VALUES ($1, $2)", [`Bulk Guest ${i}`, `01100000${i}0`]);
    }
    const limited = await api('/api/guests/search', { method: 'POST', cookie: desk, body: { query: 'Bulk Guest', limit: 3 } });
    assert.equal(limited.json.data.length, 3);
    assert.deepEqual(limited.json.meta, { limit: 3, truncated: true });
  } finally {
    await close?.();
    await appPool?.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    await admin.end();
  }
});
