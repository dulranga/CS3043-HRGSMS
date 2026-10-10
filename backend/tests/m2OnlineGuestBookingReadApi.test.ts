import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import express, { NextFunction, Request, Response } from 'express';
import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const migrationFiles = [
  'm1_001_create_branch_and_role.sql',
  'm1_002_create_user_account_and_officer.sql',
  'm1_003_create_guest_and_guest_account.sql',
  'm1_004_create_audit_log.sql',
  'm1_005_create_billing_policy.sql',
  'm2_001_room_catalogue.sql',
  'm2_002_booking.sql',
  'm2_003_room_inventory.sql',
  'm2_004_booking_room_assignment.sql',
  'm2_005_reservation_integrity_guards.sql',
  'm2_006_capacity_type_edit_guards.sql',
  'm2_007_available_rooms.sql',
  'm2_008_staff_booking_create.sql',
  'm2_009_booking_line_modifications.sql',
  'm2_010_online_guest_booking_create.sql',
  'm2_011_online_guest_booking_read_index.sql',
  'm3_001_service_usage_mock.sql',
  'm4_001_invoice_and_lines.sql',
  'm4_002_payment.sql',
  'm4_003_billing_calculation.sql',
  'm4_004_invoice_lifecycle.sql',
];

const migrations = migrationFiles.map((file) =>
  readFileSync(path.join(__dirname, '..', 'migrations', file), 'utf8'),
);

function requireTestOnlineGuest(req: Request, res: Response, next: NextFunction): void {
  const role = req.header('x-test-role');
  if (!role) {
    res.status(401).json({ error: { code: 'AUTHENTICATION_REQUIRED' } });
    return;
  }
  if (role !== 'ONLINE_GUEST') {
    res.status(403).json({ error: { code: 'FORBIDDEN' } });
    return;
  }
  next();
}

test('M2-S14 lists and returns only the authenticated guest account bookings', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const originalPgUrl = process.env.PG_URL;
  const originalPgSchema = process.env.PG_SCHEMA;
  const admin = new Client({ connectionString: originalPgUrl });
  const schema = `m2_online_booking_read_${randomBytes(8).toString('hex')}`;
  let server: ReturnType<express.Express['listen']> | undefined;
  let applicationPool: { end: () => Promise<void> } | undefined;

  await admin.connect();
  try {
    await admin.query('BEGIN');
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET LOCAL search_path TO "${schema}"`);
    for (const migration of migrations) await admin.query(migration);

    const branches = await admin.query(
      'SELECT branch_id FROM branch ORDER BY name, branch_id LIMIT 1',
    );
    const branchId = branches.rows[0].branch_id as string;
    const roles = await admin.query(
      `SELECT role_id, role_name
         FROM role
        WHERE role_name IN ('CHAIN_MANAGER', 'FRONT_DESK')`,
    );
    const roleIds = Object.fromEntries(
      roles.rows.map((row) => [row.role_name, row.role_id]),
    ) as Record<string, string>;

    async function createOfficer(username: string, roleName: string): Promise<string> {
      const account = await admin.query(
        `INSERT INTO user_account (username, password_hash)
         VALUES ($1, 'test-only-hash')
         RETURNING user_id`,
        [username],
      );
      await admin.query(
        `INSERT INTO officer (officer_id, full_name, branch_id, role_id)
         VALUES ($1, $2, $3, $4)`,
        [account.rows[0].user_id, `${roleName} Read Test`, branchId, roleIds[roleName]],
      );
      return account.rows[0].user_id as string;
    }

    const chainManagerId = await createOfficer(
      `read_chain_${randomBytes(3).toString('hex')}`,
      'CHAIN_MANAGER',
    );
    const frontDeskId = await createOfficer(
      `read_frontdesk_${randomBytes(3).toString('hex')}`,
      'FRONT_DESK',
    );

    async function createOnlineGuest(username: string, name: string): Promise<{
      userId: string;
      guestId: string;
    }> {
      const account = await admin.query(
        `INSERT INTO user_account (username, password_hash)
         VALUES ($1, 'test-only-hash')
         RETURNING user_id`,
        [username],
      );
      const guest = await admin.query(
        `INSERT INTO guest (full_name, email)
         VALUES ($1, $2)
         RETURNING guest_id`,
        [name, `${username}@example.invalid`],
      );
      await admin.query(
        'INSERT INTO guest_account (guest_id, user_id) VALUES ($1, $2)',
        [guest.rows[0].guest_id, account.rows[0].user_id],
      );
      return {
        userId: account.rows[0].user_id as string,
        guestId: guest.rows[0].guest_id as string,
      };
    }

    const owner = await createOnlineGuest(
      `read_owner_${randomBytes(3).toString('hex')}`,
      'Booking Read Owner',
    );
    const otherGuest = await createOnlineGuest(
      `read_other_${randomBytes(3).toString('hex')}`,
      'Other Booking Owner',
    );
    const unlinkedAccount = await admin.query(
      `INSERT INTO user_account (username, password_hash)
       VALUES ($1, 'test-only-hash')
       RETURNING user_id`,
      [`read_unlinked_${randomBytes(3).toString('hex')}`],
    );

    const singleType = await admin.query(
      `INSERT INTO room_type (name, capacity, base_daily_rate)
       VALUES ('Read Single', 2, 100)
       RETURNING room_type_id`,
    );
    const doubleType = await admin.query(
      `INSERT INTO room_type (name, capacity, base_daily_rate)
       VALUES ('Read Double', 4, 200)
       RETURNING room_type_id`,
    );
    const singleTypeId = singleType.rows[0].room_type_id as string;
    const doubleTypeId = doubleType.rows[0].room_type_id as string;

    async function createRoom(roomNumber: string, roomTypeId = singleTypeId): Promise<string> {
      const room = await admin.query(
        `INSERT INTO room (room_number, branch_id, room_type_id)
         VALUES ($1, $2, $3)
         RETURNING room_id`,
        [roomNumber, branchId, roomTypeId],
      );
      return room.rows[0].room_id as string;
    }

    const rooms = {
      ownerOne: await createRoom('READ-S101'),
      ownerTwo: await createRoom('READ-S102'),
      ownerMoved: await createRoom('READ-S103'),
      ownerDouble: await createRoom('READ-D201', doubleTypeId),
      other: await createRoom('READ-S104'),
    };

    const policy = await admin.query(
      `INSERT INTO billing_policy (
         effective_from, tax_percent, service_charge_percent, max_discount_percent,
         cancellation_fee, no_show_fee, late_checkout_fee, no_show_grace_days,
         is_demo, created_by
       ) VALUES ('2026-01-01', 0, 0, 10, 0, 0, 0, 1, false, $1)
       RETURNING billing_policy_id`,
      [chainManagerId],
    );
    const policyId = policy.rows[0].billing_policy_id as string;

    // Policy publication uses clock_timestamp(), while confirmation compares it
    // with the later request transaction_timestamp(). Commit setup first so the
    // booking calls model separate real requests.
    await admin.query('COMMIT');
    await admin.query(`SET search_path TO "${schema}"`);

    async function createBooking(
      userId: string,
      lines: Array<Record<string, unknown>>,
    ): Promise<string> {
      const result = await admin.query(
        `SELECT booking_id
           FROM sp_create_online_guest_booking(
             $1::uuid, $2::uuid, $3::uuid, $4::jsonb
           )`,
        [userId, branchId, policyId, JSON.stringify(lines)],
      );
      return result.rows[0].booking_id as string;
    }

    const ownerBookingOne = await createBooking(owner.userId, [
      {
        roomId: rooms.ownerOne,
        checkIn: '2027-06-01',
        checkOut: '2027-06-04',
        guestCount: 2,
        quotedRoomTypeId: singleTypeId,
        quotedBaseDailyRate: '100.00',
      },
      {
        roomId: rooms.ownerDouble,
        checkIn: '2027-06-02',
        checkOut: '2027-06-05',
        guestCount: 4,
        quotedRoomTypeId: doubleTypeId,
        quotedBaseDailyRate: '200.00',
      },
    ]);
    const ownerBookingTwo = await createBooking(owner.userId, [{
      roomId: rooms.ownerTwo,
      checkIn: '2027-07-01',
      checkOut: '2027-07-03',
      guestCount: 1,
      quotedRoomTypeId: singleTypeId,
      quotedBaseDailyRate: '100.00',
    }]);
    const otherBooking = await createBooking(otherGuest.userId, [{
      roomId: rooms.other,
      checkIn: '2027-08-01',
      checkOut: '2027-08-03',
      guestCount: 1,
      quotedRoomTypeId: singleTypeId,
      quotedBaseDailyRate: '100.00',
    }]);

    const ownerLine = await admin.query(
      `SELECT line_id
         FROM booking_room_line
        WHERE booking_id = $1 AND rate_snapshot = 100
        LIMIT 1`,
      [ownerBookingOne],
    );
    const ownerLineId = ownerLine.rows[0].line_id as string;
    await admin.query(
      `SELECT *
         FROM sp_change_booking_room_line(
           $1::uuid, $2::uuid, $3::date, $4::date, $5::smallint,
           $6::uuid, $7::numeric, $8::uuid, $9::uuid, $10::varchar
         )`,
      [
        ownerBookingOne,
        ownerLineId,
        '2027-06-01',
        '2027-06-05',
        2,
        singleTypeId,
        '100.00',
        frontDeskId,
        branchId,
        'Guest requested one additional night',
      ],
    );
    await admin.query(
      `SELECT *
         FROM sp_move_booking_room_line(
           $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::numeric,
           $6::uuid, $7::uuid, $8::varchar, $9::numeric
         )`,
      [
        ownerBookingOne,
        ownerLineId,
        rooms.ownerMoved,
        singleTypeId,
        '100.00',
        frontDeskId,
        branchId,
        'Move requested before arrival',
        null,
      ],
    );

    const index = await admin.query(
      `SELECT indexdef
         FROM pg_indexes
        WHERE schemaname = $1 AND indexname = 'booking_guest_created_idx'`,
      [schema],
    );
    assert.equal(index.rowCount, 1);
    assert.match(index.rows[0].indexdef, /guest_id, created_at DESC, booking_id DESC/);

    process.env.PG_SCHEMA = schema;
    const [{ createOnlineGuestBookingReadRouter }, { pool }] = await Promise.all([
      import('../src/routes/onlineGuestBookingReadRoutes'),
      import('../src/db'),
    ]);
    applicationPool = pool;
    const app = express();
    app.use('/api/guest', createOnlineGuestBookingReadRouter(
      { requireOnlineGuest: requireTestOnlineGuest },
      { authenticatedUserId: (req) => req.header('x-test-user-id') ?? '' },
    ));
    server = await new Promise((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    async function api(
      pathname: string,
      options: { role?: string; userId?: string } = {},
    ): Promise<{ status: number; json: any }> {
      const headers: Record<string, string> = {};
      if (options.role) headers['x-test-role'] = options.role;
      if (options.userId) headers['x-test-user-id'] = options.userId;
      const response = await fetch(`${baseUrl}${pathname}`, { headers });
      return { status: response.status, json: await response.json() };
    }

    const auth = { role: 'ONLINE_GUEST', userId: owner.userId };
    const unauthenticated = await api('/api/guest/bookings');
    assert.equal(unauthenticated.status, 401);

    const wrongRole = await api('/api/guest/bookings', {
      role: 'FRONT_DESK',
      userId: owner.userId,
    });
    assert.equal(wrongRole.status, 403);

    const unlinked = await api('/api/guest/bookings', {
      role: 'ONLINE_GUEST',
      userId: unlinkedAccount.rows[0].user_id,
    });
    assert.equal(unlinked.status, 403);

    const list = await api('/api/guest/bookings', auth);
    assert.equal(list.status, 200);
    assert.equal(list.json.data.items.length, 2);
    assert.deepEqual(
      new Set(list.json.data.items.map((item: any) => item.bookingId)),
      new Set([ownerBookingOne, ownerBookingTwo]),
    );
    assert.ok(!list.json.data.items.some((item: any) => item.bookingId === otherBooking));
    const twoLineSummary = list.json.data.items.find(
      (item: any) => item.bookingId === ownerBookingOne,
    );
    assert.equal(twoLineSummary.lineSummary.total, 2);
    assert.equal(twoLineSummary.lineSummary.booked, 2);
    assert.ok(!('guestId' in twoLineSummary));
    assert.ok(!('createdBy' in twoLineSummary));

    const paged = await api('/api/guest/bookings?limit=1&offset=1', auth);
    assert.equal(paged.status, 200);
    assert.equal(paged.json.data.items.length, 1);
    assert.deepEqual(paged.json.data.pagination, { limit: 1, offset: 1, returned: 1 });

    const ownershipOverride = await api(
      `/api/guest/bookings?guestId=${otherGuest.guestId}`,
      auth,
    );
    assert.equal(ownershipOverride.status, 400);

    const detail = await api(`/api/guest/bookings/${ownerBookingOne}`, auth);
    assert.equal(detail.status, 200);
    assert.equal(detail.json.data.bookingId, ownerBookingOne);
    assert.equal(detail.json.data.lines.length, 2);
    assert.ok(!('guest' in detail.json.data));
    assert.ok(!('createdBy' in detail.json.data));
    const changedLine = detail.json.data.lines.find((line: any) => line.lineId === ownerLineId);
    assert.equal(changedLine.checkOut, '2027-06-05');
    assert.equal(changedLine.revisions.length, 1);
    assert.equal(changedLine.assignments.length, 2);
    assert.equal(changedLine.assignments.filter((value: any) => value.current).length, 1);
    assert.equal(changedLine.statusHistory.length, 1);
    assert.ok(!('changedBy' in changedLine.statusHistory[0]));
    assert.ok(!('changedBy' in changedLine.revisions[0]));

    const otherDetail = await api(`/api/guest/bookings/${otherBooking}`, auth);
    const missingDetail = await api(`/api/guest/bookings/${randomUUID()}`, auth);
    assert.equal(otherDetail.status, 404);
    assert.equal(missingDetail.status, 404);
    assert.deepEqual(otherDetail.json, missingDetail.json);
    assert.deepEqual(otherDetail.json, {
      error: { code: 'BOOKING_NOT_FOUND', message: 'Booking was not found.' },
    });

    const invalidId = await api('/api/guest/bookings/not-a-uuid', auth);
    assert.equal(invalidId.status, 400);
    const detailQuery = await api(
      `/api/guest/bookings/${ownerBookingOne}?guestId=${owner.guestId}`,
      auth,
    );
    assert.equal(detailQuery.status, 400);
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()));
      });
    }
    if (applicationPool) await applicationPool.end();
    if (originalPgSchema === undefined) delete process.env.PG_SCHEMA;
    else process.env.PG_SCHEMA = originalPgSchema;
    try { await admin.query('ROLLBACK'); } catch {}
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});
