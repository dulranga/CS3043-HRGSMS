import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
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
  'm3_001_service_usage_mock.sql',
  'm4_001_invoice_and_lines.sql',
  'm4_002_payment.sql',
  'm4_003_billing_calculation.sql',
  'm4_004_invoice_lifecycle.sql',
  'm4_005_invoice_query_indexes.sql',
  'm4_006_payment_posting.sql',
];

const migrations = migrationFiles.map((file) =>
  readFileSync(path.join(__dirname, '..', 'migrations', file), 'utf8'),
);

function requireFrontDesk(req: Request, res: Response, next: NextFunction): void {
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

function requireMoveStaff(req: Request, res: Response, next: NextFunction): void {
  const role = req.header('x-test-role');
  if (!role) {
    res.status(401).json({ error: { code: 'AUTHENTICATION_REQUIRED' } });
    return;
  }
  if (!['FRONT_DESK', 'BRANCH_MANAGER'].includes(role)) {
    res.status(403).json({ error: { code: 'FORBIDDEN' } });
    return;
  }
  next();
}

test('M2-S12 atomically adds, revises and moves room lines while refreshing the DRAFT bill', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const originalPgUrl = process.env.PG_URL;
  const originalPgSchema = process.env.PG_SCHEMA;
  const admin = new Client({ connectionString: originalPgUrl });
  const schema = `m2_booking_modify_${randomBytes(8).toString('hex')}`;
  let server: ReturnType<express.Express['listen']> | undefined;
  let applicationPool: { end: () => Promise<void> } | undefined;

  await admin.connect();
  try {
    await admin.query('BEGIN');
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET LOCAL search_path TO "${schema}"`);
    for (const migration of migrations) await admin.query(migration);

    const branches = await admin.query('SELECT branch_id FROM branch ORDER BY name, branch_id LIMIT 2');
    const branchId = branches.rows[0].branch_id as string;
    const otherBranchId = branches.rows[1].branch_id as string;
    const roles = await admin.query(
      `SELECT role_id, role_name
         FROM role
        WHERE role_name IN ('FRONT_DESK', 'BRANCH_MANAGER', 'CHAIN_MANAGER')`,
    );
    const roleIds = Object.fromEntries(
      roles.rows.map((row) => [row.role_name, row.role_id]),
    ) as Record<string, string>;

    async function createOfficer(
      roleName: 'FRONT_DESK' | 'BRANCH_MANAGER' | 'CHAIN_MANAGER',
      officerBranchId: string,
    ): Promise<string> {
      const suffix = randomBytes(4).toString('hex');
      const account = await admin.query(
        `INSERT INTO user_account (username, password_hash)
         VALUES ($1, 'test-only-hash') RETURNING user_id`,
        [`m2_modify_${roleName.toLowerCase()}_${suffix}`],
      );
      await admin.query(
        `INSERT INTO officer (officer_id, full_name, branch_id, role_id)
         VALUES ($1, $2, $3, $4)`,
        [account.rows[0].user_id, `M2 Modify ${roleName}`, officerBranchId, roleIds[roleName]],
      );
      return account.rows[0].user_id as string;
    }

    const frontDeskId = await createOfficer('FRONT_DESK', branchId);
    const branchManagerId = await createOfficer('BRANCH_MANAGER', branchId);
    const otherFrontDeskId = await createOfficer('FRONT_DESK', otherBranchId);
    const chainManagerId = await createOfficer('CHAIN_MANAGER', branchId);
    const guest = await admin.query(
      `INSERT INTO guest (full_name, email)
       VALUES ('M2 Modify Guest', 'm2-modify@example.invalid') RETURNING guest_id`,
    );
    const guestId = guest.rows[0].guest_id as string;

    const singleType = await admin.query(
      `INSERT INTO room_type (name, capacity, base_daily_rate)
       VALUES ('M2 Modify Single', 2, 100) RETURNING room_type_id`,
    );
    const doubleType = await admin.query(
      `INSERT INTO room_type (name, capacity, base_daily_rate)
       VALUES ('M2 Modify Double', 4, 200) RETURNING room_type_id`,
    );
    const premiumType = await admin.query(
      `INSERT INTO room_type (name, capacity, base_daily_rate)
       VALUES ('M2 Modify Premium', 4, 250) RETURNING room_type_id`,
    );
    const singleTypeId = singleType.rows[0].room_type_id as string;
    const doubleTypeId = doubleType.rows[0].room_type_id as string;
    const premiumTypeId = premiumType.rows[0].room_type_id as string;

    async function createRoom(number: string, roomTypeId: string, targetBranchId = branchId): Promise<string> {
      const result = await admin.query(
        `INSERT INTO room (room_number, branch_id, room_type_id)
         VALUES ($1, $2, $3) RETURNING room_id`,
        [number, targetBranchId, roomTypeId],
      );
      return result.rows[0].room_id as string;
    }

    const rooms = {
      first: await createRoom('MOD-S101', singleTypeId),
      checked: await createRoom('MOD-D201', doubleTypeId),
      added: await createRoom('MOD-S102', singleTypeId),
      moved: await createRoom('MOD-S103', singleTypeId),
      blocked: await createRoom('MOD-S104', singleTypeId),
      premium: await createRoom('MOD-P301', premiumTypeId),
      otherBranch: await createRoom('MOD-O401', singleTypeId, otherBranchId),
    };
    const system = await admin.query("SELECT user_id FROM user_account WHERE username = 'system'");
    await admin.query(
      `INSERT INTO room_block (start_date, end_date, reason, room_id, created_by)
       VALUES ('2027-11-05', '2027-11-07', 'Modification test block', $1, $2)`,
      [rooms.blocked, system.rows[0].user_id],
    );
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
    await admin.query(`SET search_path TO "${schema}"`);

    async function createBooking(
      actorId: string,
      actorBranchId: string,
      lines: Array<{
        roomId: string;
        roomTypeId: string;
        rate: string;
        checkIn: string;
        checkOut: string;
        guestCount: number;
      }>,
    ): Promise<string> {
      const payload = lines.map((line) => ({
        roomId: line.roomId,
        checkIn: line.checkIn,
        checkOut: line.checkOut,
        guestCount: line.guestCount,
        quotedRoomTypeId: line.roomTypeId,
        quotedBaseDailyRate: line.rate,
      }));
      const result = await admin.query(
        `SELECT booking_id
           FROM sp_create_booking($1, 'FRONT_DESK', $2, $3, $4, $5::jsonb)`,
        [guestId, actorId, actorBranchId, policyId, JSON.stringify(payload)],
      );
      return result.rows[0].booking_id as string;
    }

    const bookingId = await createBooking(frontDeskId, branchId, [
      {
        roomId: rooms.first, roomTypeId: singleTypeId, rate: '100.00',
        checkIn: '2027-11-01', checkOut: '2027-11-04', guestCount: 2,
      },
      {
        roomId: rooms.checked, roomTypeId: doubleTypeId, rate: '200.00',
        checkIn: '2027-11-01', checkOut: '2027-11-03', guestCount: 4,
      },
    ]);
    const otherBookingId = await createBooking(otherFrontDeskId, otherBranchId, [
      {
        roomId: rooms.otherBranch, roomTypeId: singleTypeId, rate: '100.00',
        checkIn: '2027-12-01', checkOut: '2027-12-03', guestCount: 1,
      },
    ]);
    const otherLine = await admin.query(
      'SELECT line_id FROM booking_room_line WHERE booking_id = $1',
      [otherBookingId],
    );
    const otherLineId = otherLine.rows[0].line_id as string;
    const initialLines = await admin.query(
      `SELECT line.line_id, assignment.room_id
         FROM booking_room_line AS line
         JOIN booking_room_assignment AS assignment
           ON assignment.line_id = line.line_id AND assignment.unassigned_at IS NULL
        WHERE line.booking_id = $1`,
      [bookingId],
    );
    const firstLineId = initialLines.rows.find((row) => row.room_id === rooms.first).line_id as string;
    const checkedLineId = initialLines.rows.find((row) => row.room_id === rooms.checked).line_id as string;

    process.env.PG_SCHEMA = schema;
    const [{ createBookingModificationRouter }, { pool }] = await Promise.all([
      import('../src/routes/bookingModificationRoutes'),
      import('../src/db'),
    ]);
    applicationPool = pool;
    const app = express();
    app.use(express.json());
    app.use('/api', createBookingModificationRouter(
      { requireFrontDesk, requireReservationMoveStaff: requireMoveStaff },
      {
        actorId: (req) => req.header('x-test-actor-id') ?? '',
        branchId: (req) => req.header('x-test-branch-id') ?? '',
      },
    ));
    server = await new Promise((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    async function api(
      method: 'POST' | 'PATCH',
      pathname: string,
      options: { role?: string; actorId?: string; branchId?: string; body?: unknown } = {},
    ): Promise<{ status: number; json: any }> {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (options.role) headers['x-test-role'] = options.role;
      if (options.actorId) headers['x-test-actor-id'] = options.actorId;
      if (options.branchId) headers['x-test-branch-id'] = options.branchId;
      const response = await fetch(`${baseUrl}${pathname}`, {
        method,
        headers,
        body: JSON.stringify(options.body ?? {}),
      });
      return { status: response.status, json: await response.json() };
    }

    const frontDeskAuth = { role: 'FRONT_DESK', actorId: frontDeskId, branchId };
    const managerAuth = { role: 'BRANCH_MANAGER', actorId: branchManagerId, branchId };
    const addBody = {
      roomId: rooms.added,
      checkIn: '2027-11-05',
      checkOut: '2027-11-07',
      guestCount: 1,
      quotedRoomTypeId: singleTypeId,
      quotedBaseDailyRate: '100.00',
      reason: 'Guest added another room',
    };

    const unauthenticated = await api('POST', `/api/bookings/${bookingId}/lines`, { body: addBody });
    assert.equal(unauthenticated.status, 401);
    const wrongRole = await api('POST', `/api/bookings/${bookingId}/lines`, {
      role: 'BRANCH_MANAGER', actorId: branchManagerId, branchId, body: addBody,
    });
    assert.equal(wrongRole.status, 403);

    const added = await api('POST', `/api/bookings/${bookingId}/lines`, {
      ...frontDeskAuth,
      body: addBody,
    });
    assert.equal(added.status, 201);
    assert.equal(added.json.data.invoice.total, '900.00');
    const addedLineId = added.json.data.line.lineId as string;
    const addedAssignmentId = added.json.data.line.currentAssignment.assignmentId as string;

    const beforeBlocked = await admin.query(
      `SELECT
         (SELECT count(*)::integer FROM booking_room_line WHERE booking_id = $1) AS line_count,
         (SELECT COALESCE(sum(amount), 0)::text FROM invoice_line
           WHERE invoice_id = (SELECT invoice_id FROM invoice WHERE booking_id = $1)) AS invoice_total`,
      [bookingId],
    );
    const blocked = await api('POST', `/api/bookings/${bookingId}/lines`, {
      ...frontDeskAuth,
      body: { ...addBody, roomId: rooms.blocked, reason: 'Should roll back' },
    });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.json.error.code, 'INVENTORY_CONFLICT');
    const afterBlocked = await admin.query(
      `SELECT
         (SELECT count(*)::integer FROM booking_room_line WHERE booking_id = $1) AS line_count,
         (SELECT COALESCE(sum(amount), 0)::text FROM invoice_line
           WHERE invoice_id = (SELECT invoice_id FROM invoice WHERE booking_id = $1)) AS invoice_total`,
      [bookingId],
    );
    assert.deepEqual(afterBlocked.rows[0], beforeBlocked.rows[0]);

    await admin.query(
      `SELECT * FROM fn_record_payment(
         $1, $2, 'PAYMENT', 900, 'CASH', 'M2-S12-PAID-DOWN', 'SUCCESSFUL', CURRENT_TIMESTAMP
       )`,
      [bookingId, frontDeskId],
    );

    const staleChangeBody = {
      checkIn: '2027-11-01',
      checkOut: '2027-11-03',
      guestCount: 2,
      quotedRoomTypeId: singleTypeId,
      quotedBaseDailyRate: '99.00',
      reason: 'Shorter stay requested',
    };
    const staleChange = await api('PATCH', `/api/bookings/${bookingId}/lines/${firstLineId}`, {
      ...frontDeskAuth,
      body: staleChangeBody,
    });
    assert.equal(staleChange.status, 409);
    assert.equal(staleChange.json.error.code, 'REQUOTE_REQUIRED');

    const changed = await api('PATCH', `/api/bookings/${bookingId}/lines/${firstLineId}`, {
      ...frontDeskAuth,
      body: { ...staleChangeBody, quotedBaseDailyRate: '100.00' },
    });
    assert.equal(changed.status, 200);
    assert.equal(changed.json.data.line.checkOut, '2027-11-03');
    assert.equal(changed.json.data.invoice.total, '800.00');
    assert.equal(changed.json.data.invoice.balance, '-100.00');
    assert.equal(changed.json.data.invoice.isCredit, true);
    assert.equal(changed.json.data.invoice.creditAmount, '100.00');

    const revision = await admin.query(
      `SELECT old_stay_end_date::text, new_stay_end_date::text,
              old_rate_snapshot::text, new_rate_snapshot::text
         FROM booking_room_line_revision WHERE line_id = $1`,
      [firstLineId],
    );
    assert.deepEqual(revision.rows, [{
      old_stay_end_date: '2027-11-04',
      new_stay_end_date: '2027-11-03',
      old_rate_snapshot: '100.00',
      new_rate_snapshot: '100.00',
    }]);
    const unaffected = await admin.query(
      `SELECT line_id, stay_end_date::text, rate_snapshot::text
         FROM booking_room_line
        WHERE line_id = ANY($1::uuid[]) ORDER BY line_id`,
      [[checkedLineId, addedLineId]],
    );
    assert.deepEqual(
      unaffected.rows.map((row) => [row.stay_end_date, row.rate_snapshot]).sort(),
      [['2027-11-03', '200.00'], ['2027-11-07', '100.00']],
    );

    const moved = await api('POST', `/api/bookings/${bookingId}/lines/${addedLineId}/move`, {
      ...frontDeskAuth,
      body: {
        roomId: rooms.moved,
        quotedRoomTypeId: singleTypeId,
        quotedBaseDailyRate: '100.00',
        reason: 'Guest requested a quieter room',
      },
    });
    assert.equal(moved.status, 200);
    assert.equal(moved.json.data.line.currentAssignment.roomId, rooms.moved);
    assert.equal(moved.json.data.invoice.total, '800.00');
    const movedHistory = await admin.query(
      `SELECT room_id, unassigned_at IS NULL AS current
         FROM booking_room_assignment WHERE line_id = $1 ORDER BY assigned_at, assignment_id`,
      [addedLineId],
    );
    assert.deepEqual(movedHistory.rows, [
      { room_id: rooms.added, current: false },
      { room_id: rooms.moved, current: true },
    ]);
    assert.equal(movedHistory.rows[0].current, false);
    assert.notEqual(addedAssignmentId, moved.json.data.line.currentAssignment.assignmentId);

    const crossBranchMove = await api('POST', `/api/bookings/${bookingId}/lines/${addedLineId}/move`, {
      ...frontDeskAuth,
      body: {
        roomId: rooms.otherBranch,
        quotedRoomTypeId: singleTypeId,
        quotedBaseDailyRate: '100.00',
        reason: 'Forbidden cross-branch move',
      },
    });
    assert.equal(crossBranchMove.status, 403);
    const stillMoved = await admin.query(
      `SELECT room_id FROM booking_room_assignment
        WHERE line_id = $1 AND unassigned_at IS NULL`,
      [addedLineId],
    );
    assert.equal(stillMoved.rows[0].room_id, rooms.moved);

    await admin.query('BEGIN');
    await admin.query('SET CONSTRAINTS ALL DEFERRED');
    await admin.query(
      `UPDATE booking_room_line SET status = 'CHECKED_IN', updated_at = clock_timestamp()
        WHERE line_id = $1`,
      [checkedLineId],
    );
    await admin.query(
      `UPDATE booking_room_assignment SET occupied_from = clock_timestamp()
        WHERE line_id = $1 AND unassigned_at IS NULL`,
      [checkedLineId],
    );
    await admin.query(
      `INSERT INTO booking_room_line_status_history (
         line_id, old_status, new_status, changed_by, reason
       ) VALUES ($1, 'BOOKED', 'CHECKED_IN', $2, 'M2-S12 checked-in move setup')`,
      [checkedLineId, frontDeskId],
    );
    await admin.query('COMMIT');

    const checkedChange = await api('PATCH', `/api/bookings/${bookingId}/lines/${checkedLineId}`, {
      ...frontDeskAuth,
      body: {
        checkIn: '2027-11-01', checkOut: '2027-11-04', guestCount: 4,
        quotedRoomTypeId: doubleTypeId, quotedBaseDailyRate: '200.00',
        reason: 'Checked-in dates must stay fixed',
      },
    });
    assert.equal(checkedChange.status, 409);
    assert.equal(checkedChange.json.error.code, 'INVALID_STATE');

    const unapprovedAdjustment = await api(
      'POST',
      `/api/bookings/${bookingId}/lines/${checkedLineId}/move`,
      {
        ...frontDeskAuth,
        body: {
          roomId: rooms.premium,
          quotedRoomTypeId: premiumTypeId,
          quotedBaseDailyRate: '250.00',
          reason: 'Upgrade during stay',
          approvedPriceAdjustment: '50.00',
        },
      },
    );
    assert.equal(unapprovedAdjustment.status, 403);

    const checkedMove = await api(
      'POST',
      `/api/bookings/${bookingId}/lines/${checkedLineId}/move`,
      {
        ...managerAuth,
        body: {
          roomId: rooms.premium,
          quotedRoomTypeId: premiumTypeId,
          quotedBaseDailyRate: '250.00',
          reason: 'Manager-approved in-stay upgrade',
          approvedPriceAdjustment: '50.00',
        },
      },
    );
    assert.equal(checkedMove.status, 200);
    assert.equal(checkedMove.json.data.line.status, 'CHECKED_IN');
    assert.equal(checkedMove.json.data.line.rateSnapshot, '200.00');
    assert.equal(checkedMove.json.data.invoice.total, '850.00');
    assert.equal(checkedMove.json.data.invoice.balance, '-50.00');
    const occupiedHistory = await admin.query(
      `SELECT room_id, occupied_from IS NOT NULL AS started,
              occupied_to IS NOT NULL AS ended, unassigned_at IS NULL AS current
         FROM booking_room_assignment WHERE line_id = $1 ORDER BY assigned_at, assignment_id`,
      [checkedLineId],
    );
    assert.deepEqual(occupiedHistory.rows, [
      { room_id: rooms.checked, started: true, ended: true, current: false },
      { room_id: rooms.premium, started: true, ended: false, current: true },
    ]);
    const adjustment = await admin.query(
      `SELECT line_type, booking_room_line_id, amount::text, description
         FROM invoice_line
        WHERE invoice_id = (SELECT invoice_id FROM invoice WHERE booking_id = $1)
          AND line_type = 'PRICE_ADJUSTMENT'`,
      [bookingId],
    );
    assert.equal(adjustment.rows.length, 1);
    assert.equal(adjustment.rows[0].booking_room_line_id, checkedLineId);
    assert.equal(adjustment.rows[0].amount, '50.00');

    const otherBranchChange = await api(
      'PATCH',
      `/api/bookings/${otherBookingId}/lines/${otherLineId}`,
      {
        ...frontDeskAuth,
        body: { ...staleChangeBody, quotedBaseDailyRate: '100.00' },
      },
    );
    assert.equal(otherBranchChange.status, 403);

    await admin.query('BEGIN');
    await admin.query('SAVEPOINT reject_delete');
    await assert.rejects(
      admin.query('DELETE FROM booking_room_line WHERE line_id = $1', [addedLineId]),
      (error: { code?: string }) => error.code === '55000',
    );
    await admin.query('ROLLBACK TO SAVEPOINT reject_delete');
    const retainedLine = await admin.query(
      'SELECT count(*)::integer AS count FROM booking_room_line WHERE line_id = $1',
      [addedLineId],
    );
    assert.equal(retainedLine.rows[0].count, 1);
    await admin.query('COMMIT');
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    if (applicationPool) await applicationPool.end();
    process.env.PG_SCHEMA = originalPgSchema;
    try {
      await admin.query('ROLLBACK');
      await admin.query('SET search_path TO pg_catalog');
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await admin.end();
      process.env.PG_URL = originalPgUrl;
    }
  }
});
