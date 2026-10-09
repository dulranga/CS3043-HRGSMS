import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import test from 'node:test';
import dotenv from 'dotenv';
import express, { Request, Response, Router } from 'express';
import { Client, Pool } from 'pg';
import { AuthPrincipal, SESSION_COOKIE_NAME, createAuth, hashPassword } from '../src/auth';
import { createAuthRouter } from '../src/routes/authRoutes';
import {
  ADMIN_ROUTE_POLICY,
  PERMISSIONS,
  REPORT_ROUTE_POLICY,
  STAFF_ROLES,
  StaffRole,
  authorizeStaff,
  createAuthorization,
  requireGuestOrStaff,
  requireStaff,
  roleHasPermission,
  sessionBranchId,
  sessionUserId,
} from '../src/authorization';

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
  'm2_006_capacity_type_edit_guards.sql',
].map((file) => readFileSync(path.join(migrationsDir, file), 'utf8'));

const SECRET = 'test-session-secret-0123456789-abcdefghijklmnop';
const PASSWORD = 'correct-horse-battery';
const BRANCH_A = '01900000-0000-7000-8000-00000000000a';
const BRANCH_B = '01900000-0000-7000-8000-00000000000b';

function staff(role: string, branchId = BRANCH_A): AuthPrincipal {
  return { userId: `u-${role}`, username: role.toLowerCase(), kind: 'STAFF', role, branchId };
}
const guestPrincipal: AuthPrincipal = { userId: 'u-guest', username: 'guest', kind: 'GUEST', guestId: 'g-1' };

test('M1-S09 permission matrix matches the SRS §6.1.4 working mapping for every seeded role', () => {
  const expected: Record<StaffRole, string[]> = {
    FRONT_DESK: ['room.read', 'service_usage.record', 'booking.manage', 'checkout.perform', 'payment.record', 'invoice.read.branch', 'guest.link.issue', 'guest.manage', 'branch.read'],
    SERVICE_STAFF: ['room.read', 'room.condition.write', 'service_usage.record', 'branch.read'],
    BRANCH_MANAGER: ['room.read', 'room.write', 'invoice.read.branch', 'discount.apply', 'report.read.branch', 'branch.read'],
    CHAIN_MANAGER: ['catalogue.write', 'invoice.read.chain', 'report.read.chain', 'billing_policy.publish', 'branch.read'],
    SYSTEM_ADMINISTRATOR: ['audit.read', 'branch.read', 'branch.write', 'account.read', 'account.write', 'config.read', 'config.write'],
    AUDITOR: ['invoice.read.chain', 'report.read.chain', 'audit.read', 'branch.read', 'account.read', 'config.read'],
  };
  const permissions = Object.keys(PERMISSIONS) as Array<keyof typeof PERMISSIONS>;
  for (const role of STAFF_ROLES) {
    const granted = permissions.filter((permission) => roleHasPermission(role, permission)).sort();
    assert.deepEqual(granted, [...expected[role]].sort(), role);
  }
  // Only CHAIN_MANAGER edits shared catalogues/prices; SYSTEM_ADMINISTRATOR has no financial permission.
  assert.deepEqual(PERMISSIONS['catalogue.write'].roles, ['CHAIN_MANAGER']);
  for (const financial of ['payment.record', 'checkout.perform', 'discount.apply', 'billing_policy.publish', 'catalogue.write'] as const) {
    assert.equal(roleHasPermission('SYSTEM_ADMINISTRATOR', financial), false, financial);
    assert.equal(roleHasPermission('AUDITOR', financial), false, financial);
  }
  assert.equal(roleHasPermission('GUEST', 'branch.read'), false);
  assert.equal(roleHasPermission(undefined, 'branch.read'), false);
  assert.equal(roleHasPermission('front_desk', 'payment.record'), false, 'role names are exact');

  // Decisions: authentication, guest denial, branch scope and chain preference.
  assert.deepEqual(authorizeStaff(undefined, 'room.read'), { allowed: false, status: 401, code: 'AUTHENTICATION_REQUIRED' });
  assert.equal(authorizeStaff(guestPrincipal, 'branch.read').allowed, false, 'guests never hold staff permissions');
  assert.equal(authorizeStaff({ ...staff('FRONT_DESK'), branchId: undefined }, 'room.read').allowed, false);
  assert.equal(authorizeStaff(staff('UNKNOWN_ROLE'), 'branch.read').allowed, false);
  assert.deepEqual(authorizeStaff(staff('BRANCH_MANAGER'), 'room.write', BRANCH_B), {
    allowed: false,
    status: 403,
    code: 'CROSS_BRANCH_FORBIDDEN',
  });
  assert.deepEqual(authorizeStaff(staff('BRANCH_MANAGER'), 'room.write', BRANCH_A), {
    allowed: true,
    permission: 'room.write',
    scope: 'BRANCH',
    branchId: BRANCH_A,
  });
  const chainReport = authorizeStaff(staff('AUDITOR'), ['report.read.chain', 'report.read.branch'], BRANCH_B);
  assert.equal(chainReport.allowed && chainReport.scope, 'CHAIN');
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

// Stand-ins for routers whose handlers need other members' schemas. They keep
// the real paths so the production route policies are exercised unchanged.
function echoRouter(paths: Array<[string, string]>): Router {
  const router = Router();
  const echo = (req: Request, res: Response) => {
    res.json({ ok: true, query: req.query });
  };
  for (const [method, route] of paths) {
    (router as unknown as Record<string, (path: string, handler: typeof echo) => void>)[method](route, echo);
  }
  return router;
}

test('M1-S09 server-side role/branch authorization across protected routers (AT-24)', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const schema = `m1_authz_${randomBytes(8).toString('hex')}`;
  const originalSchema = process.env.PG_SCHEMA;
  // A transaction-mode pooler (Neon "-pooler" hosts) can move session-level
  // SETs between server connections, so every session-scoped connection here
  // uses the direct endpoint with the scratch schema pinned at startup.
  const directUrl = new URL(process.env.PG_URL);
  directUrl.hostname = directUrl.hostname.replace('-pooler.', '.');
  const admin = new Client({ connectionString: directUrl.toString() });
  await admin.connect();
  let authPool: Pool | undefined;
  let servicePool: { end: () => Promise<void> } | undefined;
  let close: (() => Promise<void>) | undefined;

  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET search_path TO "${schema}"`);
    assert.equal((await admin.query('SELECT current_schema() AS schema')).rows[0].schema, schema);
    for (const sql of migrations) await admin.query(sql);

    authPool = new Pool({ connectionString: directUrl.toString(), options: `-c search_path=${schema}`, max: 6 });
    const pinned = await authPool.query('SELECT current_schema() AS schema');
    assert.equal(pinned.rows[0].schema, schema);

    // Member 2's services read PG_SCHEMA at import time and SET LOCAL it per transaction.
    process.env.PG_SCHEMA = schema;
    const [{ createCatalogueRouter }, { createRoomInventoryRouter }, { pool }] = await Promise.all([
      import('../src/routes/catalogueRoutes'),
      import('../src/routes/roomInventoryRoutes'),
      import('../src/db'),
    ]);
    servicePool = pool;

    const branches = (await admin.query('SELECT branch_id, name FROM branch ORDER BY name')).rows;
    const branchA = branches.find((b) => b.name === 'Colombo').branch_id as string;
    const branchB = branches.find((b) => b.name === 'Kandy').branch_id as string;
    const hash = await hashPassword(PASSWORD, 4);

    async function createStaff(username: string, role: string, branchId = branchA) {
      const user = await admin.query(
        'INSERT INTO user_account (username, password_hash) VALUES ($1, $2) RETURNING user_id',
        [username, hash],
      );
      await admin.query(
        `INSERT INTO officer (officer_id, full_name, branch_id, role_id)
         SELECT $1, $2, $3, role_id FROM role WHERE role_name = $4`,
        [user.rows[0].user_id, `Officer ${username}`, branchId, role],
      );
      return user.rows[0].user_id as string;
    }
    for (const role of STAFF_ROLES) await createStaff(role.toLowerCase(), role);
    await createStaff('branch_manager.kandy', 'BRANCH_MANAGER', branchB);
    await createStaff('front_desk.kandy', 'FRONT_DESK', branchB);
    const switching = await createStaff('role.switch', 'FRONT_DESK');
    const guestUser = await admin.query(
      'INSERT INTO user_account (username, password_hash) VALUES ($1, $2) RETURNING user_id',
      ['guest.one', hash],
    );
    const guest = await admin.query("INSERT INTO guest (full_name) VALUES ('Guest One') RETURNING guest_id");
    await admin.query('INSERT INTO guest_account (guest_id, user_id) VALUES ($1, $2)', [
      guest.rows[0].guest_id,
      guestUser.rows[0].user_id,
    ]);

    const auth = createAuth({ db: authPool, secret: SECRET, cookieSecure: false, idleMinutes: async () => 30 });
    const authorization = createAuthorization(auth.authenticate);
    const app = express();
    app.use(express.json());
    app.use('/api/auth', createAuthRouter(auth));
    // Mirrors backend/src/index.ts.
    app.use(
      '/api/admin',
      authorization.policy(ADMIN_ROUTE_POLICY),
      echoRouter([
        ['get', '/branches'], ['post', '/branches'], ['patch', '/branches/:id'],
        ['get', '/users'], ['patch', '/users/:id/status'], ['get', '/audit-logs'],
        ['get', '/configs'], ['put', '/configs/:key'], ['delete', '/branches/:id'],
      ]),
    );
    app.use(
      '/api/reports',
      authorization.policy(REPORT_ROUTE_POLICY),
      echoRouter([
        ['get', '/occupancy'], ['get', '/revenue'], ['get', '/guest-history'], ['get', '/service-usage'],
        ['get', '/service-usage/top'], ['get', '/audit-logs'], ['get', '/occupancy/export'],
        ['get', '/revenue/export'], ['get', '/guest-history/export'],
        ['get', '/billing'], ['get', '/billing/export'], ['get', '/preference/trends'],
        ['get', '/trends/export'], ['get', '/service-usage/export'], ['get', '/audit-logs/export'],
      ]),
    );
    const ok = (_req: Request, res: Response) => { res.json({ ok: true }); };
    app.get('/api/bookings/:bookingId/invoice', auth.authenticate, requireGuestOrStaff(['invoice.read.branch', 'invoice.read.chain']), ok);
    app.post('/api/bookings/:bookingId/payments', auth.authenticate, requireStaff('payment.record'), ok);
    app.post('/api/bookings/:bookingId/checkout', auth.authenticate, requireStaff('checkout.perform'), ok);
    app.use('/api', createCatalogueRouter({
      requireRead: authorization.authenticated,
      requireChainManager: authorization.staff('catalogue.write'),
    }));
    app.use('/api', createRoomInventoryRouter(
      { requireBranchRead: authorization.staff('room.read'), requireBranchManager: authorization.staff('room.write') },
      { branchId: sessionBranchId, actorId: sessionUserId },
    ));
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
      { method = 'GET', body, headers = {} }: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
    ) {
      const all: Record<string, string> = { ...headers };
      if (as) all.cookie = await cookieFor(as);
      if (body !== undefined) all['content-type'] = 'application/json';
      const response = await fetch(`${server.baseUrl}${pathname}`, {
        method,
        headers: all,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      return { status: response.status, json: text ? JSON.parse(text) : null };
    }
    const roleUser = (role: StaffRole) => role.toLowerCase();

    // No session: every protected route is 401, and spoofed identity headers are ignored.
    const spoof = { 'x-user-id': switching, 'x-role': 'CHAIN_MANAGER', 'x-branch-id': branchA, 'x-test-role': 'CHAIN_MANAGER' };
    for (const [method, pathname] of [
      ['GET', '/api/room-types'], ['POST', '/api/room-types'], ['GET', '/api/rooms'], ['POST', '/api/rooms'],
      ['GET', '/api/admin/branches'], ['GET', '/api/reports/occupancy'], ['GET', '/api/admin/not-mapped'],
      ['POST', '/api/bookings/x/payments'], ['GET', '/api/bookings/x/invoice'],
    ]) {
      const result = await api(null, pathname, { method, headers: spoof, body: method === 'GET' ? undefined : {} });
      assert.equal(result.status, 401, `${method} ${pathname}`);
      assert.equal(result.json.error.code, 'AUTHENTICATION_REQUIRED');
    }
    const headerEscalation = await api('front_desk', '/api/room-types', {
      method: 'POST',
      headers: spoof,
      body: { name: 'Escalated', capacity: 2, baseDailyRate: '1.00' },
    });
    assert.equal(headerEscalation.status, 403, 'request headers never grant a role');

    // AT-24: only CHAIN_MANAGER edits the chain-wide catalogue; rates stay unchanged otherwise.
    const created = await api('chain_manager', '/api/room-types', {
      method: 'POST',
      body: { name: 'Authz Deluxe', capacity: 2, baseDailyRate: '15000.00' },
    });
    assert.equal(created.status, 201);
    const roomTypeId = created.json.data.roomTypeId as string;
    const amenity = await api('chain_manager', '/api/amenities', { method: 'POST', body: { name: 'Authz Balcony' } });
    assert.equal(amenity.status, 201);
    for (const role of STAFF_ROLES.filter((r) => r !== 'CHAIN_MANAGER')) {
      const createDenied = await api(roleUser(role), '/api/room-types', {
        method: 'POST',
        body: { name: `Denied ${role}`, capacity: 2, baseDailyRate: '1.00' },
      });
      assert.equal(createDenied.status, 403, `${role} create room type`);
      const rateDenied = await api(roleUser(role), `/api/room-types/${roomTypeId}`, {
        method: 'PATCH',
        body: { baseDailyRate: '1.00' },
      });
      assert.equal(rateDenied.status, 403, `${role} change rate`);
      const amenityDenied = await api(roleUser(role), `/api/amenities/${amenity.json.data.amenityId}`, {
        method: 'PATCH',
        body: { description: 'changed' },
      });
      assert.equal(amenityDenied.status, 403, `${role} edit amenity`);
      assert.equal((await api(roleUser(role), '/api/room-types')).status, 200, `${role} reads catalogue`);
    }
    const guestCatalogueWrite = await api('guest.one', `/api/room-types/${roomTypeId}`, {
      method: 'PATCH',
      body: { baseDailyRate: '1.00' },
    });
    assert.equal(guestCatalogueWrite.status, 403);
    assert.equal((await api('guest.one', '/api/room-types')).status, 200);
    const rate = await admin.query('SELECT base_daily_rate::text AS rate FROM room_type WHERE room_type_id = $1', [roomTypeId]);
    assert.equal(rate.rows[0].rate, '15000.00', 'forbidden writes left the rate unchanged');
    const typeCount = await admin.query("SELECT count(*)::int AS n FROM room_type WHERE name LIKE 'Denied %' OR name = 'Escalated'");
    assert.equal(typeCount.rows[0].n, 0);
    const rateChange = await api('chain_manager', `/api/room-types/${roomTypeId}`, {
      method: 'PATCH',
      body: { baseDailyRate: '16000.00' },
    });
    assert.equal(rateChange.status, 200);

    // Rooms/blocks: only BRANCH_MANAGER writes, only in the assigned branch.
    const roomA = await api('branch_manager', '/api/rooms', { method: 'POST', body: { roomNumber: 'A-1', roomTypeId } });
    assert.equal(roomA.status, 201);
    assert.equal(roomA.json.data.branchId, branchA, 'branch comes from the session');
    const roomAId = roomA.json.data.roomId as string;
    const roomB = await api('branch_manager.kandy', '/api/rooms', { method: 'POST', body: { roomNumber: 'B-1', roomTypeId } });
    assert.equal(roomB.status, 201);
    assert.equal(roomB.json.data.branchId, branchB);
    const injectedBranch = await api('branch_manager', '/api/rooms', {
      method: 'POST',
      body: { roomNumber: 'A-2', roomTypeId, branchId: branchB },
    });
    assert.equal(injectedBranch.status, 400, 'a client-supplied branch is rejected');

    for (const role of STAFF_ROLES.filter((r) => r !== 'BRANCH_MANAGER')) {
      const denied = await api(roleUser(role), '/api/rooms', { method: 'POST', body: { roomNumber: `X-${role}`, roomTypeId } });
      assert.equal(denied.status, 403, `${role} create room`);
      const blockDenied = await api(roleUser(role), `/api/rooms/${roomAId}/blocks`, {
        method: 'POST',
        body: { startDate: '2027-03-01', endDate: '2027-03-02', reason: 'Denied' },
      });
      assert.equal(blockDenied.status, 403, `${role} create block`);
    }
    // Cross-branch room/block edit by another branch's manager (AT-24).
    const crossEdit = await api('branch_manager.kandy', `/api/rooms/${roomAId}`, { method: 'PATCH', body: { roomNumber: 'HIJACK' } });
    assert.equal(crossEdit.status, 404);
    const crossBlock = await api('branch_manager.kandy', `/api/rooms/${roomAId}/blocks`, {
      method: 'POST',
      body: { startDate: '2027-03-01', endDate: '2027-03-02', reason: 'Cross' },
    });
    assert.equal(crossBlock.status, 404);
    const ownBlock = await api('branch_manager', `/api/rooms/${roomAId}/blocks`, {
      method: 'POST',
      body: { startDate: '2027-03-01', endDate: '2027-03-02', reason: 'Painting' },
    });
    assert.equal(ownBlock.status, 201);
    const crossBlockEdit = await api('branch_manager.kandy', `/api/room-blocks/${ownBlock.json.data.blockId}`, {
      method: 'DELETE',
    });
    assert.equal(crossBlockEdit.status, 404);
    const roomRow = await admin.query('SELECT room_number FROM room WHERE room_id = $1', [roomAId]);
    assert.equal(roomRow.rows[0].room_number, 'A-1');
    const blocks = await admin.query('SELECT count(*)::int AS n FROM room_block WHERE room_id = $1', [roomAId]);
    assert.equal(blocks.rows[0].n, 1);

    // Room reads: own-branch operational roles only, scoped to the session branch.
    for (const role of ['FRONT_DESK', 'SERVICE_STAFF', 'BRANCH_MANAGER'] as const) {
      const list = await api(roleUser(role), '/api/rooms');
      assert.equal(list.status, 200, role);
      assert.deepEqual(list.json.data.map((r: { roomId: string }) => r.roomId), [roomAId], `${role} sees own branch only`);
    }
    assert.equal((await api('front_desk.kandy', `/api/rooms/${roomAId}`)).status, 404, 'cross-branch read hidden');
    for (const as of ['chain_manager', 'system_administrator', 'auditor', 'guest.one']) {
      assert.equal((await api(as, '/api/rooms')).status, 403, `${as} room read`);
    }

    // Payments and checkout: FRONT_DESK only; the booking-branch check stays in Member 4's service.
    for (const role of STAFF_ROLES) {
      const expected = role === 'FRONT_DESK' ? 200 : 403;
      assert.equal((await api(roleUser(role), '/api/bookings/x/payments', { method: 'POST', body: {} })).status, expected, `${role} payment`);
      assert.equal((await api(roleUser(role), '/api/bookings/x/checkout', { method: 'POST', body: {} })).status, expected, `${role} checkout`);
    }
    assert.equal((await api('guest.one', '/api/bookings/x/payments', { method: 'POST', body: {} })).status, 403);
    // Invoice reads: guests (ownership checked downstream) and finance/report readers.
    const invoiceReaders = new Set(['FRONT_DESK', 'BRANCH_MANAGER', 'CHAIN_MANAGER', 'AUDITOR']);
    for (const role of STAFF_ROLES) {
      assert.equal((await api(roleUser(role), '/api/bookings/x/invoice')).status, invoiceReaders.has(role) ? 200 : 403, `${role} invoice`);
    }
    assert.equal((await api('guest.one', '/api/bookings/x/invoice')).status, 200);

    // Administration: SYSTEM_ADMINISTRATOR writes; AUDITOR reads; default deny for unmapped routes.
    const adminCases: Array<[string, string, Set<string>]> = [
      ['GET', '/api/admin/branches', new Set(STAFF_ROLES)],
      ['POST', '/api/admin/branches', new Set(['SYSTEM_ADMINISTRATOR'])],
      ['PATCH', `/api/admin/branches/${branchA}`, new Set(['SYSTEM_ADMINISTRATOR'])],
      ['GET', '/api/admin/users', new Set(['SYSTEM_ADMINISTRATOR', 'AUDITOR'])],
      ['PATCH', `/api/admin/users/${switching}/status`, new Set(['SYSTEM_ADMINISTRATOR'])],
      ['GET', '/api/admin/audit-logs', new Set(['SYSTEM_ADMINISTRATOR', 'AUDITOR'])],
      ['GET', '/api/admin/configs', new Set(['SYSTEM_ADMINISTRATOR', 'AUDITOR'])],
      ['PUT', '/api/admin/configs/session_idle_timeout_minutes', new Set(['SYSTEM_ADMINISTRATOR'])],
      ['DELETE', `/api/admin/branches/${branchA}`, new Set()],
    ];
    for (const [method, pathname, allowed] of adminCases) {
      for (const role of STAFF_ROLES) {
        const result = await api(roleUser(role), pathname, { method, body: method === 'GET' ? undefined : {} });
        assert.equal(result.status, allowed.has(role) ? 200 : 403, `${role} ${method} ${pathname}`);
      }
      assert.equal((await api('guest.one', pathname, { method, body: method === 'GET' ? undefined : {} })).status, 403);
    }

    // Reports: chain readers see any branch; BRANCH_MANAGER is pinned to its own branch.
    for (const route of ['occupancy/export', 'billing', 'billing/export']) {
      const scoped = await api('branch_manager', '/api/reports/' + route);
      assert.equal(scoped.status, 200);
      assert.equal(scoped.json.query.branch_id, branchA);
      assert.equal((await api('branch_manager', '/api/reports/' + route + '?branch_id=' + branchB)).status, 403);
    }
    const own = await api('branch_manager', '/api/reports/occupancy');
    assert.equal(own.status, 200);
    assert.equal(own.json.query.branch_id, branchA, 'omitted filter is forced to own branch');
    const blankFilter = await api('branch_manager', '/api/reports/revenue?branch_id=');
    assert.equal(blankFilter.json.query.branch_id, branchA);
    const crossReport = await api('branch_manager', `/api/reports/revenue?branch_id=${branchB}`);
    assert.equal(crossReport.status, 403);
    assert.equal(crossReport.json.error.code, 'CROSS_BRANCH_FORBIDDEN');
    assert.equal((await api('branch_manager', `/api/reports/occupancy?branch_id=${branchA}&branch_id=${branchB}`)).status, 403);
    const chainRead = await api('chain_manager', `/api/reports/revenue?branch_id=${branchB}`);
    assert.equal(chainRead.status, 200);
    assert.equal(chainRead.json.query.branch_id, branchB);
    const chainAll = await api('auditor', '/api/reports/occupancy');
    assert.equal(chainAll.json.query.branch_id, undefined, 'chain readers are not narrowed');
    for (const pathname of ['/api/reports/guest-history', '/api/reports/service-usage', '/api/reports/service-usage/top', '/api/reports/guest-history/export']) {
      assert.equal((await api('branch_manager', pathname)).status, 403, `BM ${pathname}`);
      assert.equal((await api('chain_manager', pathname)).status, 200, `CM ${pathname}`);
      assert.equal((await api('auditor', pathname)).status, 200, `AUDITOR ${pathname}`);
    }
    for (const role of ['FRONT_DESK', 'SERVICE_STAFF', 'SYSTEM_ADMINISTRATOR'] as const) {
      assert.equal((await api(roleUser(role), '/api/reports/occupancy')).status, 403, `${role} reports`);
    }
    assert.equal((await api('system_administrator', '/api/reports/audit-logs')).status, 200);
    assert.equal((await api('chain_manager', '/api/reports/audit-logs')).status, 403);
    assert.equal((await api('guest.one', '/api/reports/occupancy')).status, 403);

    // Role and branch changes apply on the next request without re-login.
    assert.equal((await api('role.switch', '/api/bookings/x/payments', { method: 'POST', body: {} })).status, 200);
    await admin.query(
      "UPDATE officer SET role_id = (SELECT role_id FROM role WHERE role_name = 'AUDITOR') WHERE officer_id = $1",
      [switching],
    );
    assert.equal((await api('role.switch', '/api/bookings/x/payments', { method: 'POST', body: {} })).status, 403);
    assert.equal((await api('role.switch', '/api/admin/audit-logs')).status, 200);
    await admin.query(
      "UPDATE officer SET role_id = (SELECT role_id FROM role WHERE role_name = 'BRANCH_MANAGER'), branch_id = $2 WHERE officer_id = $1",
      [switching, branchB],
    );
    const moved = await api('role.switch', '/api/rooms');
    assert.deepEqual(moved.json.data.map((r: { roomId: string }) => r.roomId), [roomB.json.data.roomId]);
  } finally {
    await close?.();
    await servicePool?.end();
    await authPool?.end();
    if (originalSchema === undefined) delete process.env.PG_SCHEMA;
    else process.env.PG_SCHEMA = originalSchema;
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});
