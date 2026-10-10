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
  'm2_010_online_guest_booking_create.sql',
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

test('M2-S13 creates direct multi-room bookings only for the authenticated guest account', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const originalPgUrl = process.env.PG_URL;
  const originalPgSchema = process.env.PG_SCHEMA;
  const admin = new Client({ connectionString: originalPgUrl });
  const schema = `m2_online_booking_${randomBytes(8).toString('hex')}`;
  let server: ReturnType<express.Express['listen']> | undefined;
  let applicationPool: { end: () => Promise<void> } | undefined;

  await admin.connect();
  try {
    await admin.query('BEGIN');
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET LOCAL search_path TO "${schema}"`);
    for (const migration of migrations) await admin.query(migration);

    const branches = await admin.query(
      'SELECT branch_id FROM branch ORDER BY name, branch_id LIMIT 2',
    );
    const branchId = branches.rows[0].branch_id as string;
    const otherBranchId = branches.rows[1].branch_id as string;
    const chainRole = await admin.query(
      "SELECT role_id FROM role WHERE role_name = 'CHAIN_MANAGER'",
    );
    const chainAccount = await admin.query(
      `INSERT INTO user_account (username, password_hash)
       VALUES ($1, 'test-only-hash')
       RETURNING user_id`,
      [`online_chain_${randomBytes(3).toString('hex')}`],
    );
    const chainManagerId = chainAccount.rows[0].user_id as string;
    await admin.query(
      `INSERT INTO officer (officer_id, full_name, branch_id, role_id)
       VALUES ($1, 'Online Booking Chain Manager', $2, $3)`,
      [chainManagerId, branchId, chainRole.rows[0].role_id],
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
      `online_owner_${randomBytes(3).toString('hex')}`,
      'Online Booking Owner',
    );
    const otherGuest = await createOnlineGuest(
      `online_other_${randomBytes(3).toString('hex')}`,
      'Other Online Guest',
    );
    const unlinkedAccount = await admin.query(
      `INSERT INTO user_account (username, password_hash)
       VALUES ($1, 'test-only-hash')
       RETURNING user_id`,
      [`online_unlinked_${randomBytes(3).toString('hex')}`],
    );

    const singleType = await admin.query(
      `INSERT INTO room_type (name, capacity, base_daily_rate)
       VALUES ('Online Single', 2, 100)
       RETURNING room_type_id`,
    );
    const doubleType = await admin.query(
      `INSERT INTO room_type (name, capacity, base_daily_rate)
       VALUES ('Online Double', 4, 200)
       RETURNING room_type_id`,
    );
    const singleTypeId = singleType.rows[0].room_type_id as string;
    const doubleTypeId = doubleType.rows[0].room_type_id as string;

    async function createRoom(
      roomNumber: string,
      roomTypeId = singleTypeId,
      roomBranchId = branchId,
    ): Promise<string> {
      const room = await admin.query(
        `INSERT INTO room (room_number, branch_id, room_type_id)
         VALUES ($1, $2, $3)
         RETURNING room_id`,
        [roomNumber, roomBranchId, roomTypeId],
      );
      return room.rows[0].room_id as string;
    }

    const rooms = {
      singleOne: await createRoom('OG-S101'),
      singleTwo: await createRoom('OG-S102'),
      singleThree: await createRoom('OG-S103'),
      doubleOne: await createRoom('OG-D201', doubleTypeId),
      otherBranch: await createRoom('OG-OTHER', singleTypeId, otherBranchId),
    };

    await admin.query('COMMIT');
    await admin.query(`SET search_path TO "${schema}"`);

    process.env.PG_SCHEMA = schema;
    const [{ createOnlineGuestBookingRouter }, { pool }] = await Promise.all([
      import('../src/routes/onlineGuestBookingCreateRoutes'),
      import('../src/db'),
    ]);
    applicationPool = pool;
    const app = express();
    app.use(express.json());
    app.use('/api/guest', createOnlineGuestBookingRouter(
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
      options: { role?: string; userId?: string; body?: unknown } = {},
    ): Promise<{ status: number; json: any }> {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (options.role) headers['x-test-role'] = options.role;
      if (options.userId) headers['x-test-user-id'] = options.userId;
      const response = await fetch(`${baseUrl}${pathname}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(options.body ?? {}),
      });
      return { status: response.status, json: await response.json() };
    }

    const auth = { role: 'ONLINE_GUEST', userId: owner.userId };
    const firstSelection = {
      roomId: rooms.singleOne,
      checkIn: '2027-06-01',
      checkOut: '2027-06-04',
      guestCount: 2,
    };

    const unauthenticated = await api('/api/guest/bookings/quote', {
      body: { branchId, lines: [firstSelection] },
    });
    assert.equal(unauthenticated.status, 401);

    const wrongRole = await api('/api/guest/bookings/quote', {
      role: 'FRONT_DESK',
      userId: owner.userId,
      body: { branchId, lines: [firstSelection] },
    });
    assert.equal(wrongRole.status, 403);

    const unlinked = await api('/api/guest/bookings/quote', {
      role: 'ONLINE_GUEST',
      userId: unlinkedAccount.rows[0].user_id,
      body: { branchId, lines: [firstSelection] },
    });
    assert.equal(unlinked.status, 403);

    const missingPolicy = await api('/api/guest/bookings/quote', {
      ...auth,
      body: { branchId, lines: [firstSelection] },
    });
    assert.equal(missingPolicy.status, 409);
    assert.equal(missingPolicy.json.error.code, 'POLICY_UNAVAILABLE');

    const policyOne = await admin.query(
      `INSERT INTO billing_policy (
         effective_from, tax_percent, service_charge_percent, max_discount_percent,
         cancellation_fee, no_show_fee, late_checkout_fee, no_show_grace_days,
         is_demo, created_by
       ) VALUES ('2026-01-01', 0, 0, 10, 0, 0, 0, 1, false, $1)
       RETURNING billing_policy_id`,
      [chainManagerId],
    );
    const policyOneId = policyOne.rows[0].billing_policy_id as string;

    const mixedQuote = await api('/api/guest/bookings/quote', {
      ...auth,
      body: {
        branchId,
        lines: [
          firstSelection,
          {
            roomId: rooms.doubleOne,
            checkIn: '2027-06-02',
            checkOut: '2027-06-05',
            guestCount: 4,
          },
        ],
      },
    });
    assert.equal(mixedQuote.status, 200);
    assert.equal(mixedQuote.json.data.billingPolicy.billingPolicyId, policyOneId);
    assert.deepEqual(
      mixedQuote.json.data.lines.map((line: any) => line.baseDailyRate),
      ['100.00', '200.00'],
    );

    function confirmationFromQuote(quote: any) {
      return {
        branchId: quote.branchId,
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

    const spoofedGuestBody = {
      ...confirmationFromQuote(mixedQuote.json.data),
      guestId: otherGuest.guestId,
    };
    const spoofedGuest = await api('/api/guest/bookings', {
      ...auth,
      body: spoofedGuestBody,
    });
    assert.equal(spoofedGuest.status, 400);
    assert.equal(spoofedGuest.json.error.code, 'VALIDATION_ERROR');

    const spoofedChannel = await api('/api/guest/bookings', {
      ...auth,
      body: {
        ...confirmationFromQuote(mixedQuote.json.data),
        bookingChannel: 'FRONT_DESK',
      },
    });
    assert.equal(spoofedChannel.status, 400);

    const created = await api('/api/guest/bookings', {
      ...auth,
      body: confirmationFromQuote(mixedQuote.json.data),
    });
    assert.equal(created.status, 201);
    assert.equal(created.json.data.guestId, owner.guestId);
    assert.equal(created.json.data.createdBy, owner.userId);
    assert.equal(created.json.data.bookingChannel, 'DIRECT_ONLINE');
    assert.equal(created.json.data.invoice.billingPolicyId, policyOneId);
    assert.deepEqual(
      created.json.data.lines.map((line: any) => line.rateSnapshot).sort(),
      ['100.00', '200.00'],
    );

    const stored = await admin.query(
      `SELECT target_booking.guest_id,
              target_booking.created_by,
              target_booking.booking_channel,
              count(DISTINCT line.line_id)::integer AS line_count,
              count(DISTINCT assignment.assignment_id)::integer AS assignment_count,
              count(DISTINCT history.history_id)::integer AS history_count,
              count(DISTINCT invoice.invoice_id)::integer AS invoice_count,
              count(DISTINCT audit.audit_id)::integer AS audit_count
         FROM booking AS target_booking
         JOIN booking_room_line AS line ON line.booking_id = target_booking.booking_id
         JOIN booking_room_assignment AS assignment ON assignment.line_id = line.line_id
         JOIN booking_room_line_status_history AS history ON history.line_id = line.line_id
         JOIN invoice ON invoice.booking_id = target_booking.booking_id
         JOIN audit_log AS audit
           ON audit.entity_name = 'booking'
          AND audit.entity_id = target_booking.booking_id::text
        WHERE target_booking.booking_id = $1
        GROUP BY target_booking.booking_id`,
      [created.json.data.bookingId],
    );
    assert.deepEqual(stored.rows[0], {
      guest_id: owner.guestId,
      created_by: owner.userId,
      booking_channel: 'DIRECT_ONLINE',
      line_count: 2,
      assignment_count: 2,
      history_count: 2,
      invoice_count: 1,
      audit_count: 1,
    });

    const staleRateQuote = await api('/api/guest/bookings/quote', {
      ...auth,
      body: {
        branchId,
        lines: [{
          roomId: rooms.singleTwo,
          checkIn: '2027-07-01',
          checkOut: '2027-07-03',
          guestCount: 2,
        }],
      },
    });
    assert.equal(staleRateQuote.status, 200);
    await admin.query(
      'UPDATE room_type SET base_daily_rate = 125 WHERE room_type_id = $1',
      [singleTypeId],
    );
    const countBeforeStaleRate = await admin.query(
      'SELECT count(*)::integer AS count FROM booking',
    );
    const staleRate = await api('/api/guest/bookings', {
      ...auth,
      body: confirmationFromQuote(staleRateQuote.json.data),
    });
    assert.equal(staleRate.status, 409);
    assert.equal(staleRate.json.error.code, 'REQUOTE_REQUIRED');
    const countAfterStaleRate = await admin.query(
      'SELECT count(*)::integer AS count FROM booking',
    );
    assert.equal(countAfterStaleRate.rows[0].count, countBeforeStaleRate.rows[0].count);

    const stalePolicyQuote = await api('/api/guest/bookings/quote', {
      ...auth,
      body: {
        branchId,
        lines: [{
          roomId: rooms.singleThree,
          checkIn: '2027-08-01',
          checkOut: '2027-08-03',
          guestCount: 1,
        }],
      },
    });
    assert.equal(stalePolicyQuote.status, 200);
    const policyTwo = await admin.query(
      `INSERT INTO billing_policy (
         effective_from, tax_percent, service_charge_percent, max_discount_percent,
         cancellation_fee, no_show_fee, late_checkout_fee, no_show_grace_days,
         is_demo, created_by
       ) VALUES ('2026-01-01', 5, 0, 10, 0, 0, 0, 1, false, $1)
       RETURNING billing_policy_id`,
      [chainManagerId],
    );
    const stalePolicy = await api('/api/guest/bookings', {
      ...auth,
      body: confirmationFromQuote(stalePolicyQuote.json.data),
    });
    assert.equal(stalePolicy.status, 409);
    assert.equal(stalePolicy.json.error.code, 'REQUOTE_REQUIRED');

    const freshQuote = await api('/api/guest/bookings/quote', {
      role: 'ONLINE_GUEST',
      userId: otherGuest.userId,
      body: {
        branchId,
        lines: [{
          roomId: rooms.singleThree,
          checkIn: '2027-08-01',
          checkOut: '2027-08-03',
          guestCount: 1,
        }],
      },
    });
    assert.equal(freshQuote.status, 200);
    assert.equal(
      freshQuote.json.data.billingPolicy.billingPolicyId,
      policyTwo.rows[0].billing_policy_id,
    );
    const spoofedRateBody = confirmationFromQuote(freshQuote.json.data);
    spoofedRateBody.lines[0].quotedBaseDailyRate = '0.00';
    const spoofedRate = await api('/api/guest/bookings', {
      role: 'ONLINE_GUEST',
      userId: otherGuest.userId,
      body: spoofedRateBody,
    });
    assert.equal(spoofedRate.status, 409);
    assert.equal(spoofedRate.json.error.code, 'REQUOTE_REQUIRED');

    const ownSecondBooking = await api('/api/guest/bookings', {
      role: 'ONLINE_GUEST',
      userId: otherGuest.userId,
      body: confirmationFromQuote(freshQuote.json.data),
    });
    assert.equal(ownSecondBooking.status, 201);
    assert.equal(ownSecondBooking.json.data.guestId, otherGuest.guestId);
    assert.equal(ownSecondBooking.json.data.createdBy, otherGuest.userId);

    const rollbackQuote = await api('/api/guest/bookings/quote', {
      ...auth,
      body: {
        branchId,
        lines: [{
          roomId: rooms.singleTwo,
          checkIn: '2027-09-01',
          checkOut: '2027-09-03',
          guestCount: 1,
        }],
      },
    });
    const rollbackBody = confirmationFromQuote(rollbackQuote.json.data);
    rollbackBody.lines.push({
      roomId: rooms.otherBranch,
      checkIn: '2027-09-01',
      checkOut: '2027-09-03',
      guestCount: 1,
      quotedRoomTypeId: singleTypeId,
      quotedBaseDailyRate: '125.00',
    });
    const countBeforeRollback = await admin.query(
      'SELECT count(*)::integer AS count FROM booking',
    );
    const crossBranchRollback = await api('/api/guest/bookings', {
      ...auth,
      body: rollbackBody,
    });
    assert.equal(crossBranchRollback.status, 409);
    assert.equal(crossBranchRollback.json.error.code, 'INVENTORY_CONFLICT');
    const countAfterRollback = await admin.query(
      'SELECT count(*)::integer AS count FROM booking',
    );
    assert.equal(countAfterRollback.rows[0].count, countBeforeRollback.rows[0].count);
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
