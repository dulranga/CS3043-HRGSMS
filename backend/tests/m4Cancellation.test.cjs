const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { Client } = require('pg');
const express = require('express');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });


test('M4-S11: Per-line and whole-booking cancellation before linked-policy cutoff with billing and ownership guards', async (t) => {
  assert.ok(process.env.PG_URL, 'PG_URL environment variable is required');
  const client = new Client({ connectionString: process.env.PG_URL });
  await client.connect();

  const scratchSchema = `test_m4_s11_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  let server;
  let baseUrl;

  try {
    await client.query(`CREATE SCHEMA ${scratchSchema}`);
    await client.query(`SET search_path TO ${scratchSchema}, public`);

    // Apply all 21 migrations in order
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
      'm3_001_service_usage_mock.sql',
      'm3_002_room_status_history_mock.sql',
      'm4_001_invoice_and_lines.sql',
      'm4_002_payment.sql',
      'm4_003_billing_calculation.sql',
      'm4_004_invoice_lifecycle.sql',
      'm4_005_invoice_query_indexes.sql',
      'm4_006_payment_posting.sql',
      'm4_007_checkout_transaction.sql',
      'm4_008_cancellation_transaction.sql',
    ];

    for (const file of migrationFiles) {
      const filePath = path.resolve(__dirname, '../migrations', file);
      if (fs.existsSync(filePath)) {
        const sql = fs.readFileSync(filePath, 'utf8');
        await client.query(sql);
      }
    }

    // 1. Seed Branches
    const bColombo = (await client.query(`
      INSERT INTO branch (name, city, address)
      VALUES ('Colombo Luxury Bay', 'Colombo', '100 Galle Face, Colombo')
      RETURNING branch_id;
    `)).rows[0].branch_id;

    const bKandy = (await client.query(`
      INSERT INTO branch (name, city, address)
      VALUES ('Kandy Royal View', 'Kandy', '50 Lake Road, Kandy')
      RETURNING branch_id;
    `)).rows[0].branch_id;

    // 2. Seed Staff Roles & Accounts
    const roleFD = (await client.query(`SELECT role_id FROM role WHERE role_name = 'FRONT_DESK'`)).rows[0].role_id;
    const roleBM = (await client.query(`SELECT role_id FROM role WHERE role_name = 'BRANCH_MANAGER'`)).rows[0].role_id;
    const roleCM = (await client.query(`SELECT role_id FROM role WHERE role_name = 'CHAIN_MANAGER'`)).rows[0].role_id;
    const roleSA = (await client.query(`SELECT role_id FROM role WHERE role_name = 'SYSTEM_ADMINISTRATOR'`)).rows[0].role_id;
    const roleSS = (await client.query(`SELECT role_id FROM role WHERE role_name = 'SERVICE_STAFF'`)).rows[0].role_id;
    const roleAud = (await client.query(`SELECT role_id FROM role WHERE role_name = 'AUDITOR'`)).rows[0].role_id;

    // Colombo Front Desk (own branch)
    const uColomboFD = (await client.query(`INSERT INTO user_account (username, password_hash) VALUES ('colombo_fd_11', 'pw') RETURNING user_id`)).rows[0].user_id;
    await client.query(`INSERT INTO officer (officer_id, full_name, role_id, branch_id) VALUES ($1, 'Colombo Desk Staff', $2, $3)`, [uColomboFD, roleFD, bColombo]);

    // Colombo Branch Manager
    const uColomboBM = (await client.query(`INSERT INTO user_account (username, password_hash) VALUES ('colombo_bm_11', 'pw') RETURNING user_id`)).rows[0].user_id;
    await client.query(`INSERT INTO officer (officer_id, full_name, role_id, branch_id) VALUES ($1, 'Colombo Manager', $2, $3)`, [uColomboBM, roleBM, bColombo]);

    // Kandy Front Desk (cross branch)
    const uKandyFD = (await client.query(`INSERT INTO user_account (username, password_hash) VALUES ('kandy_fd_11', 'pw') RETURNING user_id`)).rows[0].user_id;
    await client.query(`INSERT INTO officer (officer_id, full_name, role_id, branch_id) VALUES ($1, 'Kandy Desk Staff', $2, $3)`, [uKandyFD, roleFD, bKandy]);

    // Chain Manager (chain-wide)
    const uChainMgr = (await client.query(`INSERT INTO user_account (username, password_hash) VALUES ('chain_mgr_11', 'pw') RETURNING user_id`)).rows[0].user_id;
    await client.query(`INSERT INTO officer (officer_id, full_name, role_id, branch_id) VALUES ($1, 'Chain Exec', $2, $3)`, [uChainMgr, roleCM, bColombo]);

    // System Administrator (chain-wide)
    const uSysAdmin = (await client.query(`INSERT INTO user_account (username, password_hash) VALUES ('sys_admin_11', 'pw') RETURNING user_id`)).rows[0].user_id;
    await client.query(`INSERT INTO officer (officer_id, full_name, role_id, branch_id) VALUES ($1, 'Sys Admin', $2, $3)`, [uSysAdmin, roleSA, bColombo]);

    // Service Staff (unauthorized)
    const uServiceStaff = (await client.query(`INSERT INTO user_account (username, password_hash) VALUES ('service_staff_11', 'pw') RETURNING user_id`)).rows[0].user_id;
    await client.query(`INSERT INTO officer (officer_id, full_name, role_id, branch_id) VALUES ($1, 'Service Staff Member', $2, $3)`, [uServiceStaff, roleSS, bColombo]);

    // Auditor (read-only unauthorized)
    const uAuditor = (await client.query(`INSERT INTO user_account (username, password_hash) VALUES ('auditor_11', 'pw') RETURNING user_id`)).rows[0].user_id;
    await client.query(`INSERT INTO officer (officer_id, full_name, role_id, branch_id) VALUES ($1, 'Internal Auditor', $2, $3)`, [uAuditor, roleAud, bColombo]);

    // 3. Seed Online Guests (Alice and Bob)
    const uAlice = (await client.query(`INSERT INTO user_account (username, password_hash) VALUES ('alice_guest_11', 'pw') RETURNING user_id`)).rows[0].user_id;
    const gAlice = (await client.query(`INSERT INTO guest (full_name, email, phone, nic) VALUES ('Alice Perera', 'alice11@test.com', '0771111111', '199011111111') RETURNING guest_id`)).rows[0].guest_id;
    await client.query(`INSERT INTO guest_account (user_id, guest_id) VALUES ($1, $2)`, [uAlice, gAlice]);

    const uBob = (await client.query(`INSERT INTO user_account (username, password_hash) VALUES ('bob_guest_11', 'pw') RETURNING user_id`)).rows[0].user_id;
    const gBob = (await client.query(`INSERT INTO guest (full_name, email, phone, nic) VALUES ('Bob Fernando', 'bob11@test.com', '0772222222', '199022222222') RETURNING guest_id`)).rows[0].guest_id;
    await client.query(`INSERT INTO guest_account (user_id, guest_id) VALUES ($1, $2)`, [uBob, gBob]);

    // 4. Seed Policy V1 (cancellation_fee = 1000.00, no_show_grace_days = 1)
    const polV1 = (await client.query(`
      INSERT INTO billing_policy (
        effective_from, tax_percent, service_charge_percent, max_discount_percent,
        cancellation_fee, no_show_fee, late_checkout_fee, no_show_grace_days,
        is_demo, created_by
      ) VALUES (
        CURRENT_DATE - 5, 10.00, 5.00, 20.00,
        1000.00, 2000.00, 1500.00, 1,
        false, $1
      ) RETURNING billing_policy_id;
    `, [uChainMgr])).rows[0].billing_policy_id;

    // 5. Seed Room Type & Rooms
    const rtId = (await client.query(`
      INSERT INTO room_type (name, base_daily_rate, capacity)
      VALUES ('Deluxe Ocean', 10000.00, 2)
      RETURNING room_type_id;
    `)).rows[0].room_type_id;

    let roomCounter = 500;
    async function createCleanRoom(branchId) {
      roomCounter++;
      const rId = (await client.query(`
        INSERT INTO room (branch_id, room_type_id, room_number, operational_status)
        VALUES ($1, $2, 'RM-${roomCounter}', 'READY')
        RETURNING room_id;
      `, [branchId, rtId])).rows[0].room_id;
      return rId;
    }

    // Helper to seed booking with 1 or more BOOKED lines and DRAFT invoice
    async function createBookingWithLines(guestId, branchId, linesSpec) {
      const bRef = `BK-11-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

      await client.query('BEGIN');

      const bId = (await client.query(`
        INSERT INTO booking (guest_id, created_by, booking_ref, booking_channel)
        VALUES ($1, $2, $3, 'FRONT_DESK')
        RETURNING booking_id;
      `, [guestId, uColomboFD, bRef])).rows[0].booking_id;

      const createdLines = [];
      for (const spec of linesSpec) {
        const lId = (await client.query(`
          INSERT INTO booking_room_line (
            booking_id, stay_start_date, stay_end_date, guest_count, rate_snapshot, status
          ) VALUES (
            $1,
            COALESCE($2::date, CURRENT_DATE + 5),
            COALESCE($3::date, CURRENT_DATE + 7),
            $4,
            $5,
            'BOOKED'
          )
          RETURNING line_id;
        `, [
          bId,
          spec.stayStartDate || null,
          spec.stayEndDate || null,
          spec.guestCount || 2,
          spec.rate || 10000.00,
        ])).rows[0].line_id;

        const roomId = await createCleanRoom(branchId);
        await client.query(`
          INSERT INTO booking_room_assignment (line_id, room_id, assigned_at)
          VALUES ($1, $2, CURRENT_TIMESTAMP - interval '1 hour');
        `, [lId, roomId]);

        await client.query(`
          INSERT INTO booking_room_line_status_history (
            line_id, old_status, new_status, changed_by, reason
          ) VALUES ($1, NULL, 'BOOKED', $2, 'Initial reservation');
        `, [lId, uColomboFD]);

        createdLines.push({ lineId: lId, roomId });
      }

      await client.query('COMMIT');

      // Create draft invoice linked to polV1
      const invId = (await client.query(`
        SELECT fn_create_booking_draft_invoice($1, $2) AS inv_id;
      `, [bId, uColomboFD])).rows[0].inv_id;

      return { bookingId: bId, bookingRef: bRef, invoiceId: invId, lines: createdLines };
    }

    // Spin up test Express app
    const app = express();
    app.use(express.json());

    // Schema-scoped client wrapper for services
    const dbClientWrapper = {
      async query(sql, params) {
        await client.query(`SET search_path TO ${scratchSchema}, public`);
        return client.query(sql, params);
      },
    };

    const { createCancellationRouter } = await import('../src/routes/cancellationRoutes');
    const { createPaymentRouter } = await import('../src/routes/paymentRoutes');

    app.use('/api', createCancellationRouter(dbClientWrapper));
    app.use('/api', createPaymentRouter(dbClientWrapper));

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // =========================================================================
    // Subtest 1: Unauthenticated request fails with 401 Unauthorized
    // =========================================================================
    await t.test('1. Unauthenticated request fails with 401 Unauthorized', async () => {
      const b = await createBookingWithLines(gAlice, bColombo, [{}]);
      const res = await fetch(`${baseUrl}/api/bookings/${b.bookingId}/lines/${b.lines[0].lineId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.error?.code, 'AUTHENTICATION_REQUIRED');
    });

    // =========================================================================
    // Subtest 2: Online guest cannot cancel another guest's booking (403 Forbidden)
    // =========================================================================
    await t.test('2. Online guest cannot cancel another guest reservation (403 Forbidden)', async () => {
      const bAlice = await createBookingWithLines(gAlice, bColombo, [{}]);
      // Bob tries to cancel Alice's booking
      const res = await fetch(`${baseUrl}/api/bookings/${bAlice.bookingId}/lines/${bAlice.lines[0].lineId}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': uBob,
        },
      });
      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.error?.code, 'FORBIDDEN');
    });

    // =========================================================================
    // Subtest 3: Online guest CAN cancel their own BOOKED line (200 OK)
    // =========================================================================
    await t.test('3. Online guest can cancel their own BOOKED line (200 OK)', async () => {
      const bAlice = await createBookingWithLines(gAlice, bColombo, [{}]);
      const res = await fetch(`${baseUrl}/api/bookings/${bAlice.bookingId}/lines/${bAlice.lines[0].lineId}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': uAlice,
        },
        body: JSON.stringify({ reason: 'Trip plans changed' }),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.cancellation?.status, 'CANCELLED');
      assert.equal(data.cancellation?.cancellation_fee, 1000.00);

      // Verify line status in DB
      const lRow = (await client.query(`SELECT status FROM booking_room_line WHERE line_id = $1`, [bAlice.lines[0].lineId])).rows[0];
      assert.equal(lRow.status, 'CANCELLED');

      // Verify assignment closed
      const aRow = (await client.query(`SELECT unassigned_at, occupied_from, occupied_to FROM booking_room_assignment WHERE line_id = $1`, [bAlice.lines[0].lineId])).rows[0];
      assert.ok(aRow.unassigned_at !== null, 'Assignment unassigned_at must be closed');
      assert.equal(aRow.occupied_from, null, 'Cancelled line must have no occupied_from');
      assert.equal(aRow.occupied_to, null, 'Cancelled line must have no occupied_to');

      // Verify status history
      const hRows = (await client.query(`SELECT old_status, new_status, reason FROM booking_room_line_status_history WHERE line_id = $1 ORDER BY changed_at`, [bAlice.lines[0].lineId])).rows;
      assert.equal(hRows.length, 2);
      assert.equal(hRows[1].old_status, 'BOOKED');
      assert.equal(hRows[1].new_status, 'CANCELLED');
      assert.equal(hRows[1].reason, 'Trip plans changed');
    });

    // =========================================================================
    // Subtest 4: Service staff and auditors cannot cancel reservations (403 Forbidden)
    // =========================================================================
    await t.test('4. Service staff and auditors cannot cancel reservations (403 Forbidden)', async () => {
      const b = await createBookingWithLines(gAlice, bColombo, [{}]);
      // Service staff
      const resSS = await fetch(`${baseUrl}/api/bookings/${b.bookingId}/lines/${b.lines[0].lineId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uServiceStaff },
      });
      assert.equal(resSS.status, 403);

      // Auditor
      const resAud = await fetch(`${baseUrl}/api/bookings/${b.bookingId}/lines/${b.lines[0].lineId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uAuditor },
      });
      assert.equal(resAud.status, 403);
    });

    // =========================================================================
    // Subtest 5: Cross-branch Front Desk cannot cancel other branch reservation (403 Forbidden)
    // =========================================================================
    await t.test('5. Cross-branch staff cannot cancel other branch reservation (403 Forbidden)', async () => {
      const bColomboBooking = await createBookingWithLines(gAlice, bColombo, [{}]);
      const res = await fetch(`${baseUrl}/api/bookings/${bColomboBooking.bookingId}/lines/${bColomboBooking.lines[0].lineId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uKandyFD },
      });
      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.error?.code, 'FORBIDDEN');
    });

    // =========================================================================
    // Subtest 6: Partial cancellation: Line A cancelled, one room (Line B) remains BOOKED
    // =========================================================================
    await t.test('6. Partial cancellation: cancel Line A, Line B remains BOOKED and active', async () => {
      const b = await createBookingWithLines(gAlice, bColombo, [
        { stayStartDate: '2026-11-01', stayEndDate: '2026-11-03', rate: 10000.00 }, // 2 nights = 20,000
        { stayStartDate: '2026-11-01', stayEndDate: '2026-11-04', rate: 12000.00 }, // 3 nights = 36,000
      ]);

      const lineA = b.lines[0].lineId;
      const lineB = b.lines[1].lineId;

      // Cancel Line A by Colombo Front Desk
      const res = await fetch(`${baseUrl}/api/bookings/${b.bookingId}/lines/${lineA}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uColomboFD },
        body: JSON.stringify({ reason: 'Partial cancellation of first room' }),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.cancellation?.status, 'CANCELLED');
      assert.equal(data.cancellation?.remaining_active_lines, 1);

      // Verify Line B remains BOOKED and its assignment is still open
      const lineBRow = (await client.query(`SELECT status FROM booking_room_line WHERE line_id = $1`, [lineB])).rows[0];
      assert.equal(lineBRow.status, 'BOOKED');

      const assignBRow = (await client.query(`SELECT unassigned_at FROM booking_room_assignment WHERE line_id = $1`, [lineB])).rows[0];
      assert.equal(assignBRow.unassigned_at, null, 'Line B open assignment must remain open');

      // Verify invoice lines:
      // Line A has CANCELLATION_FEE (1000.00) and NO ROOM charges
      // Line B has ROOM charges (3 nights @ 12000 = 36000.00)
      const invLines = (await client.query(`
        SELECT line_type, booking_room_line_id, amount
          FROM invoice_line
         WHERE invoice_id = $1
      `, [b.invoiceId])).rows;

      const lineACharges = invLines.filter(l => l.booking_room_line_id === lineA);
      assert.equal(lineACharges.length, 1);
      assert.equal(lineACharges[0].line_type, 'CANCELLATION_FEE');
      assert.equal(Number(lineACharges[0].amount), 1000.00);

      const lineBCharges = invLines.filter(l => l.booking_room_line_id === lineB);
      assert.equal(lineBCharges.length, 1);
      assert.equal(lineBCharges[0].line_type, 'ROOM');
      assert.equal(Number(lineBCharges[0].amount), 36000.00);
    });

    // =========================================================================
    // Subtest 7: Before and at-cutoff boundary enforcement
    // =========================================================================
    await t.test('7. Cutoff boundaries: before cutoff succeeds; at or after cutoff fails (400)', async () => {
      // Stay start date: 2026-12-10, grace days: 1 => Cutoff deadline is 2026-12-11 00:00:00 Asia/Colombo
      const b = await createBookingWithLines(gAlice, bColombo, [
        { stayStartDate: '2026-12-10', stayEndDate: '2026-12-12' },
        { stayStartDate: '2026-12-10', stayEndDate: '2026-12-12' },
        { stayStartDate: '2026-12-10', stayEndDate: '2026-12-12' },
      ]);

      const line1 = b.lines[0].lineId;
      const line2 = b.lines[1].lineId;
      const line3 = b.lines[2].lineId;

      // Case A: Before cutoff (2026-12-10 23:59:59+05:30) => Succeeds
      const resA = await fetch(`${baseUrl}/api/bookings/${b.bookingId}/lines/${line1}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uColomboBM },
        body: JSON.stringify({ cancelTime: '2026-12-10T18:29:59Z' }), // 23:59:59 Colombo
      });
      assert.equal(resA.status, 200);

      // Case B: Exactly at cutoff (2026-12-11 00:00:00+05:30 = 2026-12-10T18:30:00Z) => Fails with 400
      const resB = await fetch(`${baseUrl}/api/bookings/${b.bookingId}/lines/${line2}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uColomboBM },
        body: JSON.stringify({ cancelTime: '2026-12-10T18:30:00Z' }), // exactly cutoff
      });
      assert.equal(resB.status, 400);
      const dataB = await resB.json();
      assert.equal(dataB.error?.code, 'CANCELLATION_DEADLINE_PASSED');

      // Case C: After cutoff (2026-12-11 08:00:00+05:30) => Fails with 400
      const resC = await fetch(`${baseUrl}/api/bookings/${b.bookingId}/lines/${line3}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uColomboBM },
        body: JSON.stringify({ cancelTime: '2026-12-11T02:30:00Z' }),
      });
      assert.equal(resC.status, 400);
      const dataC = await resC.json();
      assert.equal(dataC.error?.code, 'CANCELLATION_DEADLINE_PASSED');
    });

    // =========================================================================
    // Subtest 8: Check-in guard: cannot cancel a line that is CHECKED_IN
    // =========================================================================
    await t.test('8. Checked-in room line cannot be cancelled (400 CANNOT_CANCEL_CHECKED_IN)', async () => {
      const b = await createBookingWithLines(gAlice, bColombo, [{}]);
      const lineId = b.lines[0].lineId;

      // Transition line to CHECKED_IN
      await client.query('BEGIN');
      await client.query(`
        UPDATE booking_room_assignment
           SET occupied_from = CURRENT_TIMESTAMP
         WHERE line_id = $1 AND unassigned_at IS NULL;
      `, [lineId]);
      await client.query(`
        UPDATE booking_room_line SET status = 'CHECKED_IN' WHERE line_id = $1;
      `, [lineId]);
      await client.query(`
        INSERT INTO booking_room_line_status_history (line_id, old_status, new_status, changed_by, reason)
        VALUES ($1, 'BOOKED', 'CHECKED_IN', $2, 'Guest arrival');
      `, [lineId, uColomboFD]);
      await client.query('COMMIT');

      const res = await fetch(`${baseUrl}/api/bookings/${b.bookingId}/lines/${lineId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uColomboFD },
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.error?.code, 'CANNOT_CANCEL_CHECKED_IN');
    });

    // =========================================================================
    // Subtest 9: Later-policy fee stability
    // =========================================================================
    await t.test('9. Later-policy fee stability: new policy publication does not change existing booking cancellation fee', async () => {
      // Booking was created and confirmed under Policy V1 (fee = 1000.00)
      const b = await createBookingWithLines(gAlice, bColombo, [{}]);
      const lineId = b.lines[0].lineId;

      // Management publishes Policy V2 with higher cancellation fee (3500.00)
      const v2Res = await client.query(`
        INSERT INTO billing_policy (
          effective_from, tax_percent, service_charge_percent, max_discount_percent,
          cancellation_fee, no_show_fee, late_checkout_fee, no_show_grace_days,
          is_demo, created_by
        ) VALUES (
          CURRENT_DATE - 1, 12.00, 6.00, 15.00,
          3500.00, 4500.00, 3000.00, 2,
          false, $1
        ) RETURNING billing_policy_id;
      `, [uChainMgr]);
      const polV2 = v2Res.rows[0].billing_policy_id;

      // Cancel the booking's line
      const res = await fetch(`${baseUrl}/api/bookings/${b.bookingId}/lines/${lineId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uChainMgr },
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      // Fee must be 1000.00 from Policy V1, NOT 3500.00 from V2!
      assert.equal(data.cancellation?.cancellation_fee, 1000.00);

      const feeLine = (await client.query(`
        SELECT amount FROM invoice_line WHERE invoice_id = $1 AND line_type = 'CANCELLATION_FEE'
      `, [b.invoiceId])).rows[0];
      assert.equal(Number(feeLine.amount), 1000.00);

      // Publish Policy V3 to restore standard cancellation fee (1000.00) for subsequent tests
      await client.query(`
        INSERT INTO billing_policy (
          effective_from, tax_percent, service_charge_percent, max_discount_percent,
          cancellation_fee, no_show_fee, late_checkout_fee, no_show_grace_days,
          is_demo, created_by
        ) VALUES (
          CURRENT_DATE, 10.00, 5.00, 20.00,
          1000.00, 2000.00, 1500.00, 1,
          false, $1
        );
      `, [uChainMgr]);
    });

    // =========================================================================
    // Subtest 10: Prior-payment credit: cancellation creates negative balance / refund credit
    // =========================================================================
    await t.test('10. Prior-payment credit: cancellation removes room nights, creates credit for staff refund', async () => {
      // 2 nights @ 10,000 = 20,000 room charge.
      const b = await createBookingWithLines(gAlice, bColombo, [
        { stayStartDate: '2026-11-20', stayEndDate: '2026-11-22', rate: 10000.00 },
      ]);
      const lineId = b.lines[0].lineId;

      // Record prepayment of 15,000 LKR
      const payRes = await fetch(`${baseUrl}/api/bookings/${b.bookingId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uColomboFD },
        body: JSON.stringify({
          amount: 15000.00,
          method: 'CASH',
          reference: `PAY-PREPAY-${Date.now()}`,
        }),
      });
      assert.equal(payRes.status, 201);

      // Now cancel the line
      const cancelRes = await fetch(`${baseUrl}/api/bookings/${b.bookingId}/lines/${lineId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uColomboFD },
        body: JSON.stringify({ reason: 'Trip cancelled by guest' }),
      });
      assert.equal(cancelRes.status, 200);
      const cData = await cancelRes.json();

      // Invoice charges are now: 1000.00 (cancellation fee)
      // Net payments: 15,000.00
      // Balance: 1000.00 - 15000.00 = -14,000.00 (credit)
      assert.equal(cData.cancellation?.is_credit, true);
      assert.equal(cData.cancellation?.credit_amount, 14000.00);
      assert.equal(cData.cancellation?.outstanding_balance, -14000.00);

      // Verify staff can now issue manual refund of 14,000 LKR
      const refRes = await fetch(`${baseUrl}/api/bookings/${b.bookingId}/refunds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uColomboFD },
        body: JSON.stringify({
          amount: 14000.00,
          method: 'CASH',
          reference: `REF-CREDIT-${Date.now()}`,
        }),
      });
      assert.equal(refRes.status, 201);

      // Balance is now settled to 0.00
      const finalBalRes = await client.query(`SELECT fn_outstanding_balance($1) AS bal`, [b.bookingId]);
      assert.equal(Number(finalBalRes.rows[0].bal), 0.00);
    });

    // =========================================================================
    // Subtest 11: Whole-booking cancellation of multi-room booking
    // =========================================================================
    await t.test('11. Whole-booking cancellation atomically cancels all eligible lines', async () => {
      const b = await createBookingWithLines(gAlice, bColombo, [
        { stayStartDate: '2026-11-25', stayEndDate: '2026-11-27', rate: 10000.00 },
        { stayStartDate: '2026-11-25', stayEndDate: '2026-11-28', rate: 15000.00 },
      ]);

      // Call whole booking cancellation
      const res = await fetch(`${baseUrl}/api/bookings/${b.bookingId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uAlice },
        body: JSON.stringify({ reason: 'Family vacation cancelled' }),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.cancellation?.cancelled_lines_count, 2);
      assert.equal(data.cancellation?.remaining_active_lines, 0);
      assert.equal(data.cancellation?.total_cancellation_fees, 2000.00); // 2 * 1000

      // Verify all lines in DB are CANCELLED
      const lines = (await client.query(`SELECT line_id, status FROM booking_room_line WHERE booking_id = $1`, [b.bookingId])).rows;
      assert.equal(lines.length, 2);
      assert.ok(lines.every(l => l.status === 'CANCELLED'));

      // Verify open assignments closed
      const openAssigns = (await client.query(`
        SELECT bra.assignment_id
          FROM booking_room_assignment bra
          JOIN booking_room_line bl ON bl.line_id = bra.line_id
         WHERE bl.booking_id = $1 AND bra.unassigned_at IS NULL
      `, [b.bookingId])).rows;
      assert.equal(openAssigns.length, 0);

      // Verify invoice has 2 cancellation fee lines
      const invFeeLines = (await client.query(`
        SELECT line_type, amount FROM invoice_line WHERE invoice_id = $1 AND line_type = 'CANCELLATION_FEE'
      `, [b.invoiceId])).rows;
      assert.equal(invFeeLines.length, 2);
    });

    // =========================================================================
    // Subtest 12: Whole-booking rollback when one room is ineligible
    // =========================================================================
    await t.test('12. Whole-booking rollback: fails and rolls back completely when one room is CHECKED_IN', async () => {
      const b = await createBookingWithLines(gAlice, bColombo, [
        { stayStartDate: '2026-11-25', stayEndDate: '2026-11-27', rate: 10000.00 }, // Line 1: BOOKED
        { stayStartDate: '2026-11-25', stayEndDate: '2026-11-28', rate: 15000.00 }, // Line 2: will be CHECKED_IN
      ]);

      const line1 = b.lines[0].lineId;
      const line2 = b.lines[1].lineId;

      // Set Line 2 to CHECKED_IN
      await client.query('BEGIN');
      await client.query(`UPDATE booking_room_assignment SET occupied_from = CURRENT_TIMESTAMP WHERE line_id = $1`, [line2]);
      await client.query(`UPDATE booking_room_line SET status = 'CHECKED_IN' WHERE line_id = $1`, [line2]);
      await client.query(`
        INSERT INTO booking_room_line_status_history (line_id, old_status, new_status, changed_by, reason)
        VALUES ($1, 'BOOKED', 'CHECKED_IN', $2, 'Checked in');
      `, [line2, uColomboFD]);
      await client.query('COMMIT');

      // Attempt whole booking cancellation
      const res = await fetch(`${baseUrl}/api/bookings/${b.bookingId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uColomboFD },
        body: JSON.stringify({ reason: 'Attempt cancel all' }),
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.error?.code, 'NOT_ALL_LINES_ELIGIBLE');

      // Verify atomic rollback: Line 1 MUST STILL BE BOOKED!
      const line1Row = (await client.query(`SELECT status FROM booking_room_line WHERE line_id = $1`, [line1])).rows[0];
      assert.equal(line1Row.status, 'BOOKED', 'Line 1 must remain BOOKED after whole-booking rollback');

      // Line 1 open assignment must still be open
      const assign1 = (await client.query(`SELECT unassigned_at FROM booking_room_assignment WHERE line_id = $1`, [line1])).rows[0];
      assert.equal(assign1.unassigned_at, null);
    });

    // =========================================================================
    // Subtest 13: Repeated cancellation on already CANCELLED line
    // =========================================================================
    await t.test('13. Repeated cancellation: default 409 Conflict; ?idempotent=true returns 200 OK', async () => {
      const b = await createBookingWithLines(gAlice, bColombo, [{}]);
      const lineId = b.lines[0].lineId;

      // First cancel succeeds
      const res1 = await fetch(`${baseUrl}/api/bookings/${b.bookingId}/lines/${lineId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uAlice },
      });
      assert.equal(res1.status, 200);

      // Repeat without idempotency flag fails with 409
      const res2 = await fetch(`${baseUrl}/api/bookings/${b.bookingId}/lines/${lineId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uAlice },
      });
      assert.equal(res2.status, 409);
      const data2 = await res2.json();
      assert.equal(data2.error?.code, 'LINE_ALREADY_CANCELLED');

      // Repeat with ?idempotent=true returns 200 OK with repeated: true
      const res3 = await fetch(`${baseUrl}/api/bookings/${b.bookingId}/lines/${lineId}/cancel?idempotent=true`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uAlice },
      });
      assert.equal(res3.status, 200);
      const data3 = await res3.json();
      assert.equal(data3.success, true);
      assert.equal(data3.repeated, true);
      assert.equal(data3.cancellation?.status, 'CANCELLED');
    });

    // =========================================================================
    // Subtest 14: Cancellation quote inspection
    // =========================================================================
    await t.test('14. Cancellation quote inspection returns fee and eligibility', async () => {
      const b = await createBookingWithLines(gAlice, bColombo, [
        { stayStartDate: '2026-12-01', stayEndDate: '2026-12-03' },
      ]);
      const lineId = b.lines[0].lineId;

      const res = await fetch(`${baseUrl}/api/bookings/${b.bookingId}/lines/${lineId}/cancellation-quote`, {
        method: 'GET',
        headers: { 'x-user-id': uAlice },
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.quote?.is_eligible, true);
      assert.equal(data.quote?.cancellation_fee, 1000.00);
      assert.ok(data.quote?.cutoff_deadline);
    });

    // =========================================================================
    // Subtest 15: Stored procedures sp_cancel_room_line and sp_cancel_booking
    // =========================================================================
    await t.test('15. Stored procedures sp_cancel_room_line and sp_cancel_booking execute cleanly', async () => {
      const b1 = await createBookingWithLines(gAlice, bColombo, [{}]);
      const l1 = b1.lines[0].lineId;

      // CALL sp_cancel_room_line
      await client.query(`CALL sp_cancel_room_line($1, $2, $3, 'SP per-line test')`, [b1.bookingId, l1, uColomboFD]);
      const l1Status = (await client.query(`SELECT status FROM booking_room_line WHERE line_id = $1`, [l1])).rows[0].status;
      assert.equal(l1Status, 'CANCELLED');

      const b2 = await createBookingWithLines(gAlice, bColombo, [{}, {}]);
      // CALL sp_cancel_booking
      await client.query(`CALL sp_cancel_booking($1, $2, 'SP whole booking test')`, [b2.bookingId, uColomboFD]);
      const b2Lines = (await client.query(`SELECT status FROM booking_room_line WHERE booking_id = $1`, [b2.bookingId])).rows;
      assert.ok(b2Lines.every(l => l.status === 'CANCELLED'));
    });

  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    try {
      await client.query(`DROP SCHEMA IF EXISTS ${scratchSchema} CASCADE`);
    } catch {
      // ignore
    }
    await client.end();
  }
});
