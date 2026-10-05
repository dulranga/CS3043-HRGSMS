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

test('M2-S10 atomically creates quoted multi-room staff bookings and DRAFT invoices', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const originalPgUrl = process.env.PG_URL;
  const originalPgSchema = process.env.PG_SCHEMA;
  const admin = new Client({ connectionString: originalPgUrl });
  const schema = `m2_booking_create_${randomBytes(8).toString('hex')}`;
  let server: ReturnType<express.Express['listen']> | undefined;
  let applicationPool: { end: () => Promise<void> } | undefined;

  await admin.connect();
  try {
    await admin.query('BEGIN');
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET LOCAL search_path TO "${schema}", public`);
    for (const migration of migrations) await admin.query(migration);

    const branches = await admin.query(
      'SELECT branch_id FROM branch ORDER BY name, branch_id LIMIT 2',
    );
    const branchId = branches.rows[0].branch_id as string;
    const otherBranchId = branches.rows[1].branch_id as string;
    const roles = await admin.query(
      `SELECT role_id, role_name
         FROM role
        WHERE role_name IN ('FRONT_DESK', 'CHAIN_MANAGER')`,
    );
    const roleIds = Object.fromEntries(
      roles.rows.map((row) => [row.role_name, row.role_id]),
    ) as Record<string, string>;

    async function createOfficer(
      username: string,
      fullName: string,
      roleName: 'FRONT_DESK' | 'CHAIN_MANAGER',
      officerBranchId: string,
    ): Promise<string> {
      const account = await admin.query(
        `INSERT INTO user_account (username, password_hash)
         VALUES ($1, 'test-only-hash')
         RETURNING user_id`,
        [username],
      );
      await admin.query(
        `INSERT INTO officer (officer_id, full_name, branch_id, role_id)
         VALUES ($1, $2, $3, $4)`,
        [account.rows[0].user_id, fullName, officerBranchId, roleIds[roleName]],
      );
      return account.rows[0].user_id as string;
    }

    const frontDeskId = await createOfficer(
      `frontdesk_${randomBytes(3).toString('hex')}`,
      'Booking Test Front Desk',
      'FRONT_DESK',
      branchId,
    );
    const chainManagerId = await createOfficer(
      `chain_${randomBytes(3).toString('hex')}`,
      'Booking Test Chain Manager',
      'CHAIN_MANAGER',
      branchId,
    );
    const guest = await admin.query(
      `INSERT INTO guest (full_name, email)
       VALUES ('Booking Test Guest', 'booking-test@example.invalid')
       RETURNING guest_id`,
    );
    const guestId = guest.rows[0].guest_id as string;

    const singleType = await admin.query(
      `INSERT INTO room_type (name, capacity, base_daily_rate)
       VALUES ('Booking Single', 2, 100)
       RETURNING room_type_id`,
    );
    const doubleType = await admin.query(
      `INSERT INTO room_type (name, capacity, base_daily_rate)
       VALUES ('Booking Double', 4, 200)
       RETURNING room_type_id`,
    );
    const singleTypeId = singleType.rows[0].room_type_id as string;
    const doubleTypeId = doubleType.rows[0].room_type_id as string;

    async function createRoom(
      roomNumber: string,
      roomTypeId = singleTypeId,
      roomBranchId = branchId,
      active = true,
    ): Promise<string> {
      const room = await admin.query(
        `INSERT INTO room (room_number, branch_id, room_type_id, active)
         VALUES ($1, $2, $3, $4)
         RETURNING room_id`,
        [roomNumber, roomBranchId, roomTypeId, active],
      );
      return room.rows[0].room_id as string;
    }

    const rooms = {
      singleOne: await createRoom('S-101'),
      singleTwo: await createRoom('S-102'),
      singleThree: await createRoom('S-103'),
      singleFour: await createRoom('S-104'),
      singleFive: await createRoom('S-105'),
      concurrent: await createRoom('S-106'),
      doubleOne: await createRoom('D-201', doubleTypeId),
      blocked: await createRoom('S-BLOCKED'),
      inactive: await createRoom('S-INACTIVE', singleTypeId, branchId, false),
      otherBranch: await createRoom('OTHER-101', singleTypeId, otherBranchId),
    };
    const system = await admin.query(
      "SELECT user_id FROM user_account WHERE username = 'system'",
    );
    await admin.query(
      `INSERT INTO room_block (start_date, end_date, reason, room_id, created_by)
       VALUES ('2027-09-01', '2027-09-04', 'Booking test block', $1, $2)`,
      [rooms.blocked, system.rows[0].user_id],
    );
    await admin.query('COMMIT');
    await admin.query(`SET search_path TO "${schema}", public`);

    process.env.PG_SCHEMA = schema;
    const [{ createBookingCreateRouter }, { pool }] = await Promise.all([
      import('../src/routes/bookingCreateRoutes'),
      import('../src/db'),
    ]);
    applicationPool = pool;
    const app = express();
    app.use(express.json());
    app.use('/api', createBookingCreateRouter(
      { requireFrontDesk: requireTestFrontDesk },
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
      pathname: string,
      options: {
        role?: string;
        actorId?: string;
        branchId?: string;
        body?: unknown;
      } = {},
    ): Promise<{ status: number; json: any }> {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (options.role) headers['x-test-role'] = options.role;
      if (options.actorId) headers['x-test-actor-id'] = options.actorId;
      if (options.branchId) headers['x-test-branch-id'] = options.branchId;
      const response = await fetch(`${baseUrl}${pathname}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(options.body ?? {}),
      });
      return { status: response.status, json: await response.json() };
    }

    const auth = {
      role: 'FRONT_DESK',
      actorId: frontDeskId,
      branchId,
    };
    const singleSelection = {
      roomId: rooms.singleOne,
      checkIn: '2027-06-01',
      checkOut: '2027-06-04',
      guestCount: 2,
    };

    const missingPolicy = await api('/api/bookings/quote', {
      ...auth,
      body: { lines: [singleSelection] },
    });
    assert.equal(missingPolicy.status, 409);
    assert.equal(missingPolicy.json.error.code, 'POLICY_UNAVAILABLE');

    const policyOne = await admin.query(
      `INSERT INTO billing_policy (
         effective_from,
         tax_percent,
         service_charge_percent,
         max_discount_percent,
         cancellation_fee,
         no_show_fee,
         late_checkout_fee,
         no_show_grace_days,
         is_demo,
         created_by
       ) VALUES ('2026-01-01', 0, 0, 10, 0, 0, 0, 1, false, $1)
       RETURNING billing_policy_id`,
      [chainManagerId],
    );
    const policyOneId = policyOne.rows[0].billing_policy_id as string;

    const mixedSelections = [
      singleSelection,
      {
        roomId: rooms.doubleOne,
        checkIn: '2027-06-02',
        checkOut: '2027-06-05',
        guestCount: 4,
      },
    ];
    const mixedQuote = await api('/api/bookings/quote', {
      ...auth,
      body: { lines: mixedSelections },
    });
    assert.equal(mixedQuote.status, 200);
    assert.equal(mixedQuote.json.data.billingPolicy.billingPolicyId, policyOneId);
    assert.deepEqual(
      mixedQuote.json.data.lines.map((line: any) => line.baseDailyRate),
      ['100.00', '200.00'],
    );

    function confirmationFromQuote(quote: any, channel = 'FRONT_DESK') {
      return {
        guestId,
        bookingChannel: channel,
        quotedBillingPolicyId: quote.billingPolicy.billingPolicyId,
        lines: quote.lines.map((line: any) => ({
          roomId: line.roomId,
          checkIn: line.checkIn,
          checkOut: line.checkOut,
          guestCount: line.guestCount,
          quotedRoomTypeId: line.roomTypeId,
          quotedBaseDailyRate: line.baseDailyRate,
        })),
      };
    }

    const mixedCreate = await api('/api/bookings', {
      ...auth,
      body: confirmationFromQuote(mixedQuote.json.data),
    });
    assert.equal(mixedCreate.status, 201);
    assert.match(mixedCreate.json.data.bookingRef, /^SKY-[0-9a-f]{32}$/);
    assert.equal(mixedCreate.json.data.lines.length, 2);
    assert.deepEqual(
      mixedCreate.json.data.lines.map((line: any) => line.rateSnapshot).sort(),
      ['100.00', '200.00'],
    );
    assert.equal(mixedCreate.json.data.invoice.status, 'DRAFT');
    assert.equal(mixedCreate.json.data.invoice.billingPolicyId, policyOneId);
    assert.equal(mixedCreate.json.data.invoice.total, '900.00');
    const firstBookingId = mixedCreate.json.data.bookingId as string;

    const firstEvidence = await admin.query(
      `SELECT
         (SELECT count(*)::integer FROM booking_room_line WHERE booking_id = $1) AS lines,
         (SELECT count(*)::integer
            FROM booking_room_assignment AS assignment
            JOIN booking_room_line AS line ON line.line_id = assignment.line_id
           WHERE line.booking_id = $1 AND assignment.unassigned_at IS NULL) AS assignments,
         (SELECT count(*)::integer
            FROM booking_room_line_status_history AS history
            JOIN booking_room_line AS line ON line.line_id = history.line_id
           WHERE line.booking_id = $1) AS histories,
         (SELECT count(*)::integer
            FROM invoice_line AS invoice_line
            JOIN invoice ON invoice.invoice_id = invoice_line.invoice_id
           WHERE invoice.booking_id = $1 AND invoice_line.line_type = 'ROOM') AS room_invoice_lines,
         (SELECT count(*)::integer
            FROM audit_log
           WHERE entity_name = 'booking' AND entity_id = $1::text AND action = 'CREATE') AS audits`,
      [firstBookingId],
    );
    assert.deepEqual(firstEvidence.rows[0], {
      lines: 2,
      assignments: 2,
      histories: 2,
      room_invoice_lines: 2,
      audits: 1,
    });

    const sameTypeSelections = [
      { roomId: rooms.singleTwo, checkIn: '2027-07-01', checkOut: '2027-07-03', guestCount: 1 },
      { roomId: rooms.singleThree, checkIn: '2027-07-01', checkOut: '2027-07-03', guestCount: 2 },
    ];
    const sameTypeQuote = await api('/api/bookings/quote', {
      ...auth,
      body: { lines: sameTypeSelections },
    });
    const sameTypeCreate = await api('/api/bookings', {
      ...auth,
      body: confirmationFromQuote(sameTypeQuote.json.data, 'PHONE'),
    });
    assert.equal(sameTypeCreate.status, 201);
    assert.deepEqual(
      sameTypeCreate.json.data.lines.map((line: any) => line.rateSnapshot),
      ['100.00', '100.00'],
    );

    const staleRateQuote = await api('/api/bookings/quote', {
      ...auth,
      body: {
        lines: [{
          roomId: rooms.singleFour,
          checkIn: '2027-08-01',
          checkOut: '2027-08-03',
          guestCount: 2,
        }],
      },
    });
    await admin.query(
      'UPDATE room_type SET base_daily_rate = 125 WHERE room_type_id = $1',
      [singleTypeId],
    );
    const beforeStaleRate = await admin.query('SELECT count(*)::integer AS count FROM booking');
    const staleRateCreate = await api('/api/bookings', {
      ...auth,
      body: confirmationFromQuote(staleRateQuote.json.data),
    });
    assert.equal(staleRateCreate.status, 409);
    assert.equal(staleRateCreate.json.error.code, 'REQUOTE_REQUIRED');
    const afterStaleRate = await admin.query('SELECT count(*)::integer AS count FROM booking');
    assert.equal(afterStaleRate.rows[0].count, beforeStaleRate.rows[0].count);

    const policyTwo = await admin.query(
      `INSERT INTO billing_policy (
         effective_from,
         tax_percent,
         service_charge_percent,
         max_discount_percent,
         cancellation_fee,
         no_show_fee,
         late_checkout_fee,
         no_show_grace_days,
         is_demo,
         created_by
       ) VALUES ('2026-01-01', 5, 0, 10, 0, 0, 0, 1, false, $1)
       RETURNING billing_policy_id`,
      [chainManagerId],
    );
    const policyTwoId = policyTwo.rows[0].billing_policy_id as string;

    const stalePolicyBody = confirmationFromQuote(staleRateQuote.json.data);
    stalePolicyBody.lines[0].quotedBaseDailyRate = '125.00';
    const stalePolicyCreate = await api('/api/bookings', {
      ...auth,
      body: stalePolicyBody,
    });
    assert.equal(stalePolicyCreate.status, 409);
    assert.equal(stalePolicyCreate.json.error.code, 'REQUOTE_REQUIRED');

    const freshQuote = await api('/api/bookings/quote', {
      ...auth,
      body: {
        lines: [{
          roomId: rooms.singleFour,
          checkIn: '2027-08-01',
          checkOut: '2027-08-03',
          guestCount: 2,
        }],
      },
    });
    assert.equal(freshQuote.json.data.billingPolicy.billingPolicyId, policyTwoId);
    assert.equal(freshQuote.json.data.lines[0].baseDailyRate, '125.00');
    const freshCreate = await api('/api/bookings', {
      ...auth,
      body: confirmationFromQuote(freshQuote.json.data, 'EMAIL'),
    });
    assert.equal(freshCreate.status, 201);
    assert.equal(freshCreate.json.data.invoice.billingPolicyId, policyTwoId);

    const retainedPolicy = await admin.query(
      'SELECT billing_policy_id FROM invoice WHERE booking_id = $1',
      [firstBookingId],
    );
    assert.equal(retainedPolicy.rows[0].billing_policy_id, policyOneId);
    const retainedRates = await admin.query(
      `SELECT rate_snapshot::text
         FROM booking_room_line
        WHERE booking_id = $1
        ORDER BY rate_snapshot`,
      [firstBookingId],
    );
    assert.deepEqual(retainedRates.rows.map((row) => row.rate_snapshot), ['100.00', '200.00']);

    const bookingCountBeforeFailure = await admin.query(
      'SELECT count(*)::integer AS count FROM booking',
    );
    const failedMultiLine = await api('/api/bookings', {
      ...auth,
      body: {
        guestId,
        bookingChannel: 'FRONT_DESK',
        quotedBillingPolicyId: policyTwoId,
        lines: [
          {
            roomId: rooms.singleFive,
            checkIn: '2027-09-01',
            checkOut: '2027-09-04',
            guestCount: 2,
            quotedRoomTypeId: singleTypeId,
            quotedBaseDailyRate: '125.00',
          },
          {
            roomId: rooms.blocked,
            checkIn: '2027-09-01',
            checkOut: '2027-09-04',
            guestCount: 1,
            quotedRoomTypeId: singleTypeId,
            quotedBaseDailyRate: '125.00',
          },
        ],
      },
    });
    assert.equal(failedMultiLine.status, 409);
    assert.equal(failedMultiLine.json.error.code, 'INVENTORY_CONFLICT');
    const bookingCountAfterFailure = await admin.query(
      'SELECT count(*)::integer AS count FROM booking',
    );
    assert.equal(
      bookingCountAfterFailure.rows[0].count,
      bookingCountBeforeFailure.rows[0].count,
    );

    const inactiveCreate = await api('/api/bookings', {
      ...auth,
      body: {
        guestId,
        bookingChannel: 'FRONT_DESK',
        quotedBillingPolicyId: policyTwoId,
        lines: [{
          roomId: rooms.inactive,
          checkIn: '2027-10-01',
          checkOut: '2027-10-02',
          guestCount: 1,
          quotedRoomTypeId: singleTypeId,
          quotedBaseDailyRate: '125.00',
        }],
      },
    });
    assert.equal(inactiveCreate.status, 409);

    const spoofedRate = await api('/api/bookings', {
      ...auth,
      body: {
        guestId,
        bookingChannel: 'FRONT_DESK',
        quotedBillingPolicyId: policyTwoId,
        lines: [{
          roomId: rooms.singleFive,
          checkIn: '2027-10-01',
          checkOut: '2027-10-02',
          guestCount: 1,
          quotedRoomTypeId: singleTypeId,
          quotedBaseDailyRate: '0.00',
        }],
      },
    });
    assert.equal(spoofedRate.status, 409);
    assert.equal(spoofedRate.json.error.code, 'REQUOTE_REQUIRED');

    const crossBranch = await api('/api/bookings', {
      ...auth,
      body: {
        guestId,
        bookingChannel: 'FRONT_DESK',
        quotedBillingPolicyId: policyTwoId,
        lines: [{
          roomId: rooms.otherBranch,
          checkIn: '2027-10-01',
          checkOut: '2027-10-02',
          guestCount: 1,
          quotedRoomTypeId: singleTypeId,
          quotedBaseDailyRate: '125.00',
        }],
      },
    });
    assert.equal(crossBranch.status, 403);

    const wrongDatabaseActor = await api('/api/bookings', {
      role: 'FRONT_DESK',
      actorId: chainManagerId,
      branchId,
      body: {
        guestId,
        bookingChannel: 'FRONT_DESK',
        quotedBillingPolicyId: policyTwoId,
        lines: [{
          roomId: rooms.singleFive,
          checkIn: '2027-10-01',
          checkOut: '2027-10-02',
          guestCount: 1,
          quotedRoomTypeId: singleTypeId,
          quotedBaseDailyRate: '125.00',
        }],
      },
    });
    assert.equal(wrongDatabaseActor.status, 403);

    const directOnline = await api('/api/bookings', {
      ...auth,
      body: {
        guestId,
        bookingChannel: 'DIRECT_ONLINE',
        quotedBillingPolicyId: policyTwoId,
        lines: [],
      },
    });
    assert.equal(directOnline.status, 400);

    const forbiddenRole = await api('/api/bookings/quote', {
      role: 'BRANCH_MANAGER',
      actorId: frontDeskId,
      branchId,
      body: { lines: [singleSelection] },
    });
    assert.equal(forbiddenRole.status, 403);

    const concurrentQuote = await api('/api/bookings/quote', {
      ...auth,
      body: {
        lines: [{
          roomId: rooms.concurrent,
          checkIn: '2027-11-01',
          checkOut: '2027-11-03',
          guestCount: 2,
        }],
      },
    });
    assert.equal(concurrentQuote.status, 200);
    const concurrentBody = confirmationFromQuote(concurrentQuote.json.data);
    const concurrentResults = await Promise.all([
      api('/api/bookings', { ...auth, body: concurrentBody }),
      api('/api/bookings', { ...auth, body: concurrentBody }),
    ]);
    assert.deepEqual(
      concurrentResults.map((result) => result.status).sort(),
      [201, 409],
    );
    const concurrentAssignments = await admin.query(
      `SELECT count(*)::integer AS count
         FROM booking_room_assignment AS assignment
         JOIN booking_room_line AS line ON line.line_id = assignment.line_id
        WHERE assignment.room_id = $1
          AND assignment.unassigned_at IS NULL
          AND line.status = 'BOOKED'
          AND line.stay_start_date < '2027-11-03'
          AND '2027-11-01' < line.stay_end_date`,
      [rooms.concurrent],
    );
    assert.equal(concurrentAssignments.rows[0].count, 1);
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
