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
import { createAuthorization, requireGuestOrStaff, sessionUserId } from '../src/authorization';
import { createAuthRouter } from '../src/routes/authRoutes';
import { createInvoiceRouter } from '../src/routes/invoiceRoutes';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

// M1-S18: the guest account summary links Member 2's M2-S14 booking reads
// (mounted here with Member 1's production guest session middleware) and
// Member 4's invoice/payment reads into the owned guest's account. This test
// proves the integration mount, two-room visibility and cross-account denial
// using the real session middleware and the current M1+M2+M3+M4 migrations.

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
  'm3_001_service_usage_mock.sql',
  'm4_001_invoice_and_lines.sql',
  'm4_002_payment.sql',
  'm4_003_billing_calculation.sql',
  'm4_004_invoice_lifecycle.sql',
  'm4_005_invoice_query_indexes.sql',
].map((file) => readFileSync(path.join(migrationsDir, file), 'utf8'));

const SECRET = 'test-session-secret-0123456789-abcdefghijklmnop';
const PASSWORD = 'correct-horse-battery';

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

test('M1-S18 mounts own-booking reads with two-room visibility and cross-account denial', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const originalPgSchema = process.env.PG_SCHEMA;
  const directUrl = new URL(process.env.PG_URL);
  directUrl.hostname = directUrl.hostname.replace('-pooler.', '.');
  const connectionString = directUrl.toString();
  const schema = `m1_guest_summary_${randomBytes(8).toString('hex')}`;

  const admin = new Client({ connectionString });
  await admin.connect();
  let schemaPool: Pool | undefined;
  let globalPool: { end: () => Promise<void> } | undefined;
  let close: (() => Promise<void>) | undefined;

  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET search_path TO "${schema}"`);
    for (const sql of migrations) await admin.query(sql);

    // Search-path-scoped pool for authentication and the Member 4 read routes.
    schemaPool = new Pool({ connectionString, options: `-c search_path=${schema}`, max: 6 });
    assert.equal((await schemaPool.query('SELECT current_schema() AS schema')).rows[0].schema, schema);

    const colomboId = (await admin.query("SELECT branch_id FROM branch WHERE name = 'Colombo'")).rows[0].branch_id;
    const roleIds: Record<string, string> = {};
    for (const role of ['CHAIN_MANAGER', 'FRONT_DESK']) {
      roleIds[role] = (await admin.query('SELECT role_id FROM role WHERE role_name = $1', [role])).rows[0].role_id;
    }

    const hash = await hashPassword(PASSWORD, 4);
    async function createOfficer(username: string, role: string): Promise<string> {
      const user = (await admin.query(
        'INSERT INTO user_account (username, password_hash) VALUES ($1, $2) RETURNING user_id',
        [username, hash],
      )).rows[0].user_id;
      await admin.query(
        `INSERT INTO officer (officer_id, full_name, email, phone, nic, branch_id, role_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [user, `${role} Summary`, `${username}@skynest.example`, '0112000000', null, colomboId, roleIds[role]],
      );
      return user;
    }
    const frontDeskId = await createOfficer('front_desk', 'FRONT_DESK');
    await createOfficer('chain_manager', 'CHAIN_MANAGER');

    async function createGuest(username: string, name: string): Promise<{ userId: string; guestId: string }> {
      const user = (await admin.query(
        'INSERT INTO user_account (username, password_hash) VALUES ($1, $2) RETURNING user_id',
        [username, hash],
      )).rows[0].user_id;
      const guest = (await admin.query(
        'INSERT INTO guest (full_name, email) VALUES ($1, $2) RETURNING guest_id',
        [name, `${username}@example.com`],
      )).rows[0].guest_id;
      await admin.query('INSERT INTO guest_account (guest_id, user_id) VALUES ($1, $2)', [guest, user]);
      return { userId: user, guestId: guest };
    }
    const guestA = await createGuest('guest_a', 'Alice Guest');
    const guestB = await createGuest('guest_b', 'Bob Guest');

    const roomTypeId = (await admin.query(
      "INSERT INTO room_type (name, capacity, base_daily_rate) VALUES ('Summary Type', 2, 15000) RETURNING room_type_id",
    )).rows[0].room_type_id;
    async function createRoom(roomNumber: string): Promise<string> {
      return (await admin.query(
        'INSERT INTO room (room_number, branch_id, room_type_id) VALUES ($1, $2, $3) RETURNING room_id',
        [roomNumber, colomboId, roomTypeId],
      )).rows[0].room_id;
    }
    const roomA1 = await createRoom('SUM-A1');
    const roomA2 = await createRoom('SUM-A2');
    const roomB = await createRoom('SUM-B1');

    const policyId = (await admin.query(
      `SELECT billing_policy_id FROM billing_policy
        ORDER BY effective_from DESC, created_at DESC, billing_policy_id DESC LIMIT 1`,
    )).rows[0].billing_policy_id;

    // Deferred lifecycle constraints require the header, lines, status history
    // and assignments of a booking to commit together.
    await admin.query('BEGIN');
    const bookingA = (await admin.query(
      `INSERT INTO booking (booking_ref, booking_channel, guest_id, created_by)
       VALUES ('GUEST-A-REF', 'DIRECT_ONLINE', $1, $2) RETURNING booking_id`,
      [guestA.guestId, guestA.userId],
    )).rows[0].booking_id;

    async function addBookedLine(
      bookingId: string,
      checkIn: string,
      checkOut: string,
      guests: number,
      rate: number,
      roomId: string,
    ): Promise<string> {
      const line = (await admin.query(
        `INSERT INTO booking_room_line (booking_id, stay_start_date, stay_end_date, guest_count, rate_snapshot)
         VALUES ($1, $2, $3, $4, $5) RETURNING line_id`,
        [bookingId, checkIn, checkOut, guests, rate],
      )).rows[0].line_id;
      await admin.query(
        `INSERT INTO booking_room_line_status_history (line_id, old_status, new_status, changed_by, reason)
         VALUES ($1, NULL, 'BOOKED', $2, 'Initial booking')`,
        [line, guestA.userId],
      );
      await admin.query('INSERT INTO booking_room_assignment (line_id, room_id) VALUES ($1, $2)', [line, roomId]);
      return line;
    }

    const lineA1 = await addBookedLine(bookingA, '2027-06-01', '2027-06-03', 2, 20000, roomA1);
    const lineA2 = await addBookedLine(bookingA, '2027-06-01', '2027-06-03', 2, 10000, roomA2);

    const bookingB = (await admin.query(
      `INSERT INTO booking (booking_ref, booking_channel, guest_id, created_by)
       VALUES ('GUEST-B-REF', 'DIRECT_ONLINE', $1, $2) RETURNING booking_id`,
      [guestB.guestId, guestB.userId],
    )).rows[0].booking_id;
    await addBookedLine(bookingB, '2027-07-01', '2027-07-02', 1, 15000, roomB);

    // Member 4 invoice with one ROOM line per booking line and a single payment.
    // The invoice audit trigger reads app.current_user_id, which the Member 4
    // functions normally set; set it here for the direct insert.
    await admin.query("SELECT set_config('app.current_user_id', $1, true)", [frontDeskId]);
    const invoiceA = (await admin.query(
      `INSERT INTO invoice (booking_id, billing_policy_id, status) VALUES ($1, $2, 'DRAFT') RETURNING invoice_id`,
      [bookingA, policyId],
    )).rows[0].invoice_id;
    await admin.query(
      `INSERT INTO invoice_line (invoice_id, line_type, booking_room_line_id, description, amount)
       VALUES ($1, 'ROOM', $2, 'Room charge', 40000.00), ($1, 'ROOM', $3, 'Room charge', 20000.00)`,
      [invoiceA, lineA1, lineA2],
    );
    await admin.query(
      `INSERT INTO payment (booking_id, recorded_by, kind, amount, method, status, reference)
       VALUES ($1, $2, 'PAYMENT', 30000.00, 'CASH', 'SUCCESSFUL', 'PAY-GUEST-A-1')`,
      [bookingA, frontDeskId],
    );
    await admin.query('COMMIT');

    // The Member 2 read service resolves its schema from PG_SCHEMA at module
    // load, so set it before the dynamic import. Its pool applies search_path
    // per transaction; authentication and the Member 4 router use schemaPool.
    process.env.PG_SCHEMA = schema;
    const [{ createOnlineGuestBookingReadRouter }, { pool: globalDbPool }] = await Promise.all([
      import('../src/routes/onlineGuestBookingReadRoutes'),
      import('../src/db'),
    ]);
    globalPool = globalDbPool;

    const auth = createAuth({ db: schemaPool, secret: SECRET, cookieSecure: false, idleMinutes: async () => 30 });
    const authorization = createAuthorization(auth.authenticate);
    const app = express();
    app.use(express.json());
    app.use('/api/auth', createAuthRouter(auth));
    app.use('/api/guest', createOnlineGuestBookingReadRouter(
      { requireOnlineGuest: authorization.guest },
      { authenticatedUserId: sessionUserId },
    ));
    app.use('/api', createInvoiceRouter(
      {
        authenticate: auth.authenticate,
        authorizeBooking: requireGuestOrStaff(['invoice.read.branch', 'invoice.read.chain']),
      },
      { query: (sql: string, values?: unknown[]) => schemaPool!.query(sql, values as never) },
    ));
    const server = await listen(app);
    close = server.close;

    const cookies = new Map<string, string>();
    async function cookieFor(username: string): Promise<string> {
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
    ): Promise<{ status: number; json: any }> {
      const headers: Record<string, string> = {};
      if (as) headers.cookie = await cookieFor(as);
      const response = await fetch(`${server.baseUrl}${pathname}`, { headers });
      const text = await response.text();
      return { status: response.status, json: text ? JSON.parse(text) : null };
    }

    // Anonymous and staff sessions never reach the guest booking reads.
    assert.equal((await api(null, '/api/guest/bookings')).status, 401);
    assert.equal((await api('front_desk', '/api/guest/bookings')).status, 403);

    // Guest A sees exactly their own two-room booking with both lines.
    const listA = await api('guest_a', '/api/guest/bookings?limit=20');
    assert.equal(listA.status, 200);
    assert.equal(listA.json.data.items.length, 1);
    assert.equal(listA.json.data.items[0].bookingId, bookingA);
    assert.equal(listA.json.data.items[0].bookingRef, 'GUEST-A-REF');
    assert.equal(listA.json.data.items[0].lineSummary.total, 2);

    const detailA = await api('guest_a', `/api/guest/bookings/${bookingA}`);
    assert.equal(detailA.status, 200);
    assert.equal(detailA.json.data.lines.length, 2);
    const lineIds = detailA.json.data.lines.map((line: any) => line.lineId).sort();
    assert.deepEqual(lineIds, [lineA1, lineA2].sort());
    assert.ok(detailA.json.data.lines.every((line: any) => line.assignments.some((a: any) => a.current)));

    // Member 4 reads: one invoice with two room lines and one payment, listed once.
    const invoiceARead = await api('guest_a', `/api/bookings/${bookingA}/invoice`);
    assert.equal(invoiceARead.status, 200);
    assert.equal(invoiceARead.json.lines.length, 2);
    assert.equal(Number(invoiceARead.json.summary.total_amount), 60000);
    assert.equal(Number(invoiceARead.json.summary.net_payments), 30000);
    assert.equal(Number(invoiceARead.json.summary.outstanding_balance), 30000);

    const paymentsARead = await api('guest_a', `/api/bookings/${bookingA}/payments`);
    assert.equal(paymentsARead.status, 200);
    assert.equal(paymentsARead.json.payments.length, 1);
    assert.equal(Number(paymentsARead.json.payments[0].amount), 30000);
    assert.equal(Number(paymentsARead.json.summary.net_payments), 30000);

    // Guest B only sees their own booking and cannot reach A's booking, invoice or payments.
    const listB = await api('guest_b', '/api/guest/bookings');
    assert.equal(listB.status, 200);
    assert.equal(listB.json.data.items.length, 1);
    assert.equal(listB.json.data.items[0].bookingId, bookingB);

    const detailBOnA = await api('guest_b', `/api/guest/bookings/${bookingA}`);
    assert.equal(detailBOnA.status, 404);
    assert.equal(detailBOnA.json.error.code, 'BOOKING_NOT_FOUND');
    const detailBOnB = await api('guest_b', `/api/guest/bookings/${bookingB}`);
    assert.equal(detailBOnB.status, 200);
    assert.equal(detailBOnB.json.data.lines.length, 1);

    const invoiceBOnA = await api('guest_b', `/api/bookings/${bookingA}/invoice`);
    assert.equal(invoiceBOnA.status, 403);
    assert.equal(invoiceBOnA.json.error.code, 'FORBIDDEN');
    const paymentsBOnA = await api('guest_b', `/api/bookings/${bookingA}/payments`);
    assert.equal(paymentsBOnA.status, 403);
    assert.equal(paymentsBOnA.json.error.code, 'FORBIDDEN');

    // A client-supplied guest id is rejected rather than trusted.
    const spoofed = await api('guest_a', `/api/guest/bookings?guestId=${guestB.guestId}`);
    assert.equal(spoofed.status, 400);
    assert.equal(spoofed.json.error.code, 'VALIDATION_ERROR');
  } finally {
    if (close) await close();
    if (schemaPool) await schemaPool.end();
    if (globalPool) await globalPool.end();
    if (originalPgSchema === undefined) delete process.env.PG_SCHEMA;
    else process.env.PG_SCHEMA = originalPgSchema;
    try { await admin.query('ROLLBACK'); } catch {}
    try { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } catch {}
    await admin.end();
  }
});
