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
  '0000_create_audit_and_config.sql',
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
  'm3_001_service_usage_mock.sql',
  'm4_001_invoice_and_lines.sql',
  'm4_002_payment.sql',
  'm4_003_billing_calculation.sql',
  'm4_004_invoice_lifecycle.sql',
];

const migrations = migrationFiles.map((file) =>
  readFileSync(path.join(__dirname, '..', 'migrations', file), 'utf8'),
);

function requireTestFrontDesk(req: Request, res: Response, next: NextFunction): void {
  const role = req.header('x-test-role');
  if (!role) {
    res.status(401).json({ error: { code: 'AUTHENTICATION_REQUIRED' } });
    return;
  }
  if (role !== 'FRONT_DESK') {
    res.status(403).json({ error: { code: 'FORBIDDEN' } });
    return;
  }
  next();
}

test('M2-S11 lists each branch booking once and returns complete line and assignment history', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const originalPgUrl = process.env.PG_URL;
  const originalPgSchema = process.env.PG_SCHEMA;
  const admin = new Client({ connectionString: originalPgUrl });
  const schema = `m2_booking_read_${randomBytes(8).toString('hex')}`;
  let server: ReturnType<express.Express['listen']> | undefined;
  let applicationPool: { end: () => Promise<void> } | undefined;

  await admin.connect();
  try {
    await admin.query('BEGIN');
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET LOCAL search_path TO "${schema}", public`);
    for (const migration of migrations) await admin.query(migration);

    const branches = await admin.query('SELECT branch_id FROM branch ORDER BY name, branch_id LIMIT 2');
    const branchId = branches.rows[0].branch_id as string;
    const otherBranchId = branches.rows[1].branch_id as string;
    const roles = await admin.query(
      `SELECT role_id, role_name FROM role WHERE role_name IN ('FRONT_DESK', 'CHAIN_MANAGER')`,
    );
    const roleIds = Object.fromEntries(
      roles.rows.map((row) => [row.role_name, row.role_id]),
    ) as Record<string, string>;

    async function createOfficer(
      roleName: 'FRONT_DESK' | 'CHAIN_MANAGER',
      officerBranchId: string,
    ): Promise<string> {
      const suffix = randomBytes(4).toString('hex');
      const account = await admin.query(
        `INSERT INTO user_account (username, password_hash)
         VALUES ($1, 'test-only-hash') RETURNING user_id`,
        [`m2_read_${roleName.toLowerCase()}_${suffix}`],
      );
      await admin.query(
        `INSERT INTO officer (officer_id, full_name, branch_id, role_id)
         VALUES ($1, $2, $3, $4)`,
        [account.rows[0].user_id, `M2 Read ${roleName}`, officerBranchId, roleIds[roleName]],
      );
      return account.rows[0].user_id as string;
    }

    const frontDeskId = await createOfficer('FRONT_DESK', branchId);
    const otherFrontDeskId = await createOfficer('FRONT_DESK', otherBranchId);
    const chainManagerId = await createOfficer('CHAIN_MANAGER', branchId);
    const guest = await admin.query(
      `INSERT INTO guest (full_name, email, phone, nic)
       VALUES ('M2 Read Guest', 'm2-read@example.invalid', '+94-000-0000', 'READ-001')
       RETURNING guest_id`,
    );
    const guestId = guest.rows[0].guest_id as string;
    const roomType = await admin.query(
      `INSERT INTO room_type (name, capacity, base_daily_rate)
       VALUES ('M2 Read Type', 3, 150) RETURNING room_type_id`,
    );
    const roomTypeId = roomType.rows[0].room_type_id as string;

    async function createRoom(number: string, targetBranchId: string): Promise<string> {
      const room = await admin.query(
        `INSERT INTO room (room_number, branch_id, room_type_id)
         VALUES ($1, $2, $3) RETURNING room_id`,
        [number, targetBranchId, roomTypeId],
      );
      return room.rows[0].room_id as string;
    }

    const firstRoomId = await createRoom('READ-101', branchId);
    const secondRoomId = await createRoom('READ-102', branchId);
    const movedRoomId = await createRoom('READ-103', branchId);
    const otherRoomId = await createRoom('READ-201', otherBranchId);
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
    await admin.query('COMMIT');
    await admin.query(`SET search_path TO "${schema}", public`);

    async function createBooking(
      actorId: string,
      actorBranchId: string,
      roomLines: Array<{ roomId: string; checkIn: string; checkOut: string; guestCount: number }>,
    ): Promise<string> {
      const lines = roomLines.map((line) => ({
        ...line,
        quotedRoomTypeId: roomTypeId,
        quotedBaseDailyRate: '150.00',
      }));
      const result = await admin.query(
        `SELECT booking_id
           FROM sp_create_booking($1, 'FRONT_DESK', $2, $3, $4, $5::jsonb)`,
        [guestId, actorId, actorBranchId, policyId, JSON.stringify(lines)],
      );
      return result.rows[0].booking_id as string;
    }

    const bookingId = await createBooking(frontDeskId, branchId, [
      { roomId: firstRoomId, checkIn: '2027-11-01', checkOut: '2027-11-04', guestCount: 2 },
      { roomId: secondRoomId, checkIn: '2027-11-02', checkOut: '2027-11-06', guestCount: 3 },
    ]);
    const otherBookingId = await createBooking(otherFrontDeskId, otherBranchId, [
      { roomId: otherRoomId, checkIn: '2027-12-01', checkOut: '2027-12-03', guestCount: 1 },
    ]);

    const movedLine = await admin.query(
      `SELECT line.line_id
         FROM booking_room_line AS line
         JOIN booking_room_assignment AS assignment ON assignment.line_id = line.line_id
        WHERE line.booking_id = $1 AND assignment.room_id = $2`,
      [bookingId, firstRoomId],
    );
    await admin.query('BEGIN');
    await admin.query('SET CONSTRAINTS ALL DEFERRED');
    await admin.query(
      `UPDATE booking_room_assignment
          SET unassigned_at = clock_timestamp()
        WHERE line_id = $1 AND unassigned_at IS NULL`,
      [movedLine.rows[0].line_id],
    );
    await admin.query(
      `INSERT INTO booking_room_assignment (line_id, room_id) VALUES ($1, $2)`,
      [movedLine.rows[0].line_id, movedRoomId],
    );
    await admin.query('COMMIT');

    process.env.PG_SCHEMA = schema;
    const [{ createBookingReadRouter }, { pool }] = await Promise.all([
      import('../src/routes/bookingReadRoutes'),
      import('../src/db'),
    ]);
    applicationPool = pool;
    const app = express();
    app.use('/api', createBookingReadRouter(
      { requireFrontDesk: requireTestFrontDesk },
      { branchId: (req) => req.header('x-test-branch-id') ?? '' },
    ));
    server = await new Promise((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    async function get(
      pathname: string,
      options: { role?: string; branchId?: string } = {},
    ): Promise<{ status: number; json: any }> {
      const headers: Record<string, string> = {};
      if (options.role) headers['x-test-role'] = options.role;
      if (options.branchId) headers['x-test-branch-id'] = options.branchId;
      const response = await fetch(`${baseUrl}${pathname}`, { headers });
      return { status: response.status, json: await response.json() };
    }

    const unauthenticated = await get('/api/bookings');
    assert.equal(unauthenticated.status, 401);
    const forbidden = await get('/api/bookings', { role: 'BRANCH_MANAGER', branchId });
    assert.equal(forbidden.status, 403);

    const branchList = await get('/api/bookings?limit=50&offset=0', {
      role: 'FRONT_DESK',
      branchId,
    });
    assert.equal(branchList.status, 200);
    assert.equal(branchList.json.data.items.length, 1);
    assert.equal(branchList.json.data.items[0].bookingId, bookingId);
    assert.equal(branchList.json.data.items[0].lineSummary.total, 2);
    assert.equal(branchList.json.data.items[0].lineSummary.booked, 2);
    assert.deepEqual(branchList.json.data.pagination, { limit: 50, offset: 0, returned: 1 });
    assert.ok(!branchList.json.data.items.some((item: any) => item.bookingId === otherBookingId));

    const detail = await get(`/api/bookings/${bookingId}`, {
      role: 'FRONT_DESK',
      branchId,
    });
    assert.equal(detail.status, 200);
    assert.equal(detail.json.data.lines.length, 2);
    assert.equal(
      detail.json.data.lines.flatMap((line: any) => line.assignments).length,
      3,
    );
    assert.equal(
      detail.json.data.lines.flatMap((line: any) => line.assignments).filter((item: any) => item.current).length,
      2,
    );
    assert.deepEqual(
      detail.json.data.lines.flatMap((line: any) => line.assignments).map((item: any) => item.roomNumber).sort(),
      ['READ-101', 'READ-102', 'READ-103'],
    );
    assert.equal(
      detail.json.data.lines.flatMap((line: any) => line.statusHistory).length,
      2,
    );
    assert.ok(detail.json.data.lines.every((line: any) => Array.isArray(line.revisions)));

    const crossBranchDetail = await get(`/api/bookings/${otherBookingId}`, {
      role: 'FRONT_DESK',
      branchId,
    });
    assert.equal(crossBranchDetail.status, 404);
    assert.equal(crossBranchDetail.json.error.code, 'BOOKING_NOT_FOUND');

    const otherBranchDetail = await get(`/api/bookings/${otherBookingId}`, {
      role: 'FRONT_DESK',
      branchId: otherBranchId,
    });
    assert.equal(otherBranchDetail.status, 200);
    assert.equal(otherBranchDetail.json.data.bookingId, otherBookingId);

    const unknown = await get(`/api/bookings/${randomUUID()}`, {
      role: 'FRONT_DESK',
      branchId,
    });
    assert.equal(unknown.status, 404);
    const invalidId = await get('/api/bookings/not-a-uuid', {
      role: 'FRONT_DESK',
      branchId,
    });
    assert.equal(invalidId.status, 400);
    const clientBranchOverride = await get(`/api/bookings?branchId=${otherBranchId}`, {
      role: 'FRONT_DESK',
      branchId,
    });
    assert.equal(clientBranchOverride.status, 400);
    const invalidPagination = await get('/api/bookings?limit=101', {
      role: 'FRONT_DESK',
      branchId,
    });
    assert.equal(invalidPagination.status, 400);
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    if (applicationPool) await applicationPool.end();
    process.env.PG_SCHEMA = originalPgSchema;
    try {
      await admin.query('ROLLBACK');
      await admin.query('SET search_path TO public');
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await admin.end();
      process.env.PG_URL = originalPgUrl;
    }
  }
});
