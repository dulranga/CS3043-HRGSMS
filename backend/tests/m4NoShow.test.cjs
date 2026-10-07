const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { Client } = require('pg');
const express = require('express');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

test('M4-S12: Per-line no-show transition with cutoff, history, and invoice-linked no-show fee', async (t) => {
  assert.ok(process.env.PG_URL, 'PG_URL environment variable is required');
  const client = new Client({ connectionString: process.env.PG_URL });
  await client.connect();

  const scratchSchema = `test_m4_s12_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  let server;
  let baseUrl;

  try {
    await client.query(`CREATE SCHEMA ${scratchSchema}`);
    await client.query(`SET search_path TO ${scratchSchema}, public`);

    // Apply all 22 migrations in order
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
      'm4_009_no_show_transaction.sql',
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
    const uColomboFD = (await client.query(`INSERT INTO user_account (username, password_hash) VALUES ('colombo_fd_12', 'pw') RETURNING user_id`)).rows[0].user_id;
    await client.query(`INSERT INTO officer (officer_id, full_name, role_id, branch_id) VALUES ($1, 'Colombo Desk Staff', $2, $3)`, [uColomboFD, roleFD, bColombo]);

    // Colombo Branch Manager
    const uColomboBM = (await client.query(`INSERT INTO user_account (username, password_hash) VALUES ('colombo_bm_12', 'pw') RETURNING user_id`)).rows[0].user_id;
    await client.query(`INSERT INTO officer (officer_id, full_name, role_id, branch_id) VALUES ($1, 'Colombo Manager', $2, $3)`, [uColomboBM, roleBM, bColombo]);

    // Kandy Front Desk (cross branch)
    const uKandyFD = (await client.query(`INSERT INTO user_account (username, password_hash) VALUES ('kandy_fd_12', 'pw') RETURNING user_id`)).rows[0].user_id;
    await client.query(`INSERT INTO officer (officer_id, full_name, role_id, branch_id) VALUES ($1, 'Kandy Desk Staff', $2, $3)`, [uKandyFD, roleFD, bKandy]);

    // Chain Manager (chain-wide)
    const uChainMgr = (await client.query(`INSERT INTO user_account (username, password_hash) VALUES ('chain_mgr_12', 'pw') RETURNING user_id`)).rows[0].user_id;
    await client.query(`INSERT INTO officer (officer_id, full_name, role_id, branch_id) VALUES ($1, 'Chain Exec', $2, $3)`, [uChainMgr, roleCM, bColombo]);

    // System Administrator (chain-wide)
    const uSysAdmin = (await client.query(`INSERT INTO user_account (username, password_hash) VALUES ('sys_admin_12', 'pw') RETURNING user_id`)).rows[0].user_id;
    await client.query(`INSERT INTO officer (officer_id, full_name, role_id, branch_id) VALUES ($1, 'Sys Admin', $2, $3)`, [uSysAdmin, roleSA, bColombo]);

    // Service Staff (unauthorized)
    const uServiceStaff = (await client.query(`INSERT INTO user_account (username, password_hash) VALUES ('service_staff_12', 'pw') RETURNING user_id`)).rows[0].user_id;
    await client.query(`INSERT INTO officer (officer_id, full_name, role_id, branch_id) VALUES ($1, 'Service Staff Member', $2, $3)`, [uServiceStaff, roleSS, bColombo]);

    // Auditor (read-only unauthorized)
    const uAuditor = (await client.query(`INSERT INTO user_account (username, password_hash) VALUES ('auditor_12', 'pw') RETURNING user_id`)).rows[0].user_id;
    await client.query(`INSERT INTO officer (officer_id, full_name, role_id, branch_id) VALUES ($1, 'Internal Auditor', $2, $3)`, [uAuditor, roleAud, bColombo]);

    // 3. Seed Online Guest (Alice)
    const uAlice = (await client.query(`INSERT INTO user_account (username, password_hash) VALUES ('alice_guest_12', 'pw') RETURNING user_id`)).rows[0].user_id;
    const gAlice = (await client.query(`INSERT INTO guest (full_name, email, phone, nic) VALUES ('Alice Perera', 'alice12@test.com', '0771111112', '199011111112') RETURNING guest_id`)).rows[0].guest_id;
    await client.query(`INSERT INTO guest_account (user_id, guest_id) VALUES ($1, $2)`, [uAlice, gAlice]);

    // 4. Seed Policy V1 (no_show_fee = 2000.00, cancellation_fee = 1000.00, no_show_grace_days = 1)
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

    let roomCounter = 600;
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
      const bRef = `BK-12-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

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

      // Create draft invoice linked to effective policy
      const invId = (await client.query(`
        SELECT fn_create_booking_draft_invoice($1, $2) AS inv_id;
      `, [bId, uColomboFD])).rows[0].inv_id;

      return { bookingId: bId, bookingRef: bRef, invoiceId: invId, lines: createdLines };
    }

    // Spin up test Express app
    const app = express();
    app.use(express.json());

    const dbClientWrapper = {
      async query(sql, params) {
        await client.query(`SET search_path TO ${scratchSchema}, public`);
        return client.query(sql, params);
      },
    };

    const { createNoShowRouter } = await import('../src/routes/noShowRoutes');
    const { createPaymentRouter } = await import('../src/routes/paymentRoutes');
    const { createCancellationRouter } = await import('../src/routes/cancellationRoutes');

    app.use('/api', createNoShowRouter(dbClientWrapper));
    app.use('/api', createPaymentRouter(undefined, dbClientWrapper));
    app.use('/api', createCancellationRouter(dbClientWrapper));

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
      const lineId = b.lines[0].lineId;

      const res = await fetch(`${baseUrl}/api/bookings/${b.bookingId}/lines/${lineId}/no-show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.error?.code, 'AUTHENTICATION_REQUIRED');
    });

    // =========================================================================
    // Subtest 2: Online guest cannot mark no-show (403 Forbidden per FR-064)
    // =========================================================================
    await t.test('2. Online guest cannot mark no-show (403 Forbidden)', async () => {
      const b = await createBookingWithLines(gAlice, bColombo, [{}]);
      const lineId = b.lines[0].lineId;

      const res = await fetch(`${baseUrl}/api/bookings/${b.bookingId}/lines/${lineId}/no-show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uAlice },
      });
      assert.equal(res.status, 403);
      const data = await res.json();
      assert.match(data.error?.message, /Online guests cannot mark reservations as no-show/i);
    });

    // =========================================================================
    // Subtest 3: Service staff and auditors cannot mark no-show (403 Forbidden)
    // =========================================================================
    await t.test('3. Service staff and auditors cannot mark reservations as no-show (403 Forbidden)', async () => {
      const b = await createBookingWithLines(gAlice, bColombo, [{}]);
      const lineId = b.lines[0].lineId;

      // Service staff
      const resSS = await fetch(`${baseUrl}/api/bookings/${b.bookingId}/lines/${lineId}/no-show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uServiceStaff },
      });
      assert.equal(resSS.status, 403);

      // Auditor
      const resAud = await fetch(`${baseUrl}/api/bookings/${b.bookingId}/lines/${lineId}/no-show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uAuditor },
      });
      assert.equal(resAud.status, 403);
    });

    // =========================================================================
    // Subtest 4: Cross-branch staff cannot mark other branch line as no-show (403 Forbidden)
    // =========================================================================
    await t.test('4. Cross-branch staff cannot mark other branch reservation as no-show (403 Forbidden)', async () => {
      const b = await createBookingWithLines(gAlice, bColombo, [{}]);
      const lineId = b.lines[0].lineId;

      const res = await fetch(`${baseUrl}/api/bookings/${b.bookingId}/lines/${lineId}/no-show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uKandyFD },
      });
      assert.equal(res.status, 403);
      const data = await res.json();
      assert.match(data.error?.message, /Branch staff cannot mark no-show for bookings of another branch/i);
    });

    // =========================================================================
    // Subtest 5: Early no-show before cutoff deadline is rejected (400 EARLY_NO_SHOW_NOT_ALLOWED)
    // =========================================================================
    await t.test('5. Early no-show before cutoff deadline fails with 400 EARLY_NO_SHOW_NOT_ALLOWED', async () => {
      // Stay start date: 2026-12-10, grace days: 1 => Cutoff deadline is 2026-12-11 00:00:00 Asia/Colombo
      // (in UTC: 2026-12-10T18:30:00Z)
      const b = await createBookingWithLines(gAlice, bColombo, [
        { stayStartDate: '2026-12-10', stayEndDate: '2026-12-12' },
      ]);
      const lineId = b.lines[0].lineId;

      // 1 second before cutoff: 2026-12-10T18:29:59Z
      const res = await fetch(`${baseUrl}/api/bookings/${b.bookingId}/lines/${lineId}/no-show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uColomboFD },
        body: JSON.stringify({ markTime: '2026-12-10T18:29:59Z' }),
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.error?.code, 'EARLY_NO_SHOW_NOT_ALLOWED');
    });

    // =========================================================================
    // Subtest 6: Cutoff boundary: exactly at cutoff deadline (00:00:00 Asia/Colombo) succeeds
    // =========================================================================
    await t.test('6. Exactly at cutoff deadline (00:00:00 Asia/Colombo), no-show succeeds (200 OK)', async () => {
      // Stay start date: 2026-12-10, grace days: 1 => Cutoff deadline is 2026-12-11 00:00:00+05:30 (2026-12-10T18:30:00Z)
      const b = await createBookingWithLines(gAlice, bColombo, [
        { stayStartDate: '2026-12-10', stayEndDate: '2026-12-12' },
      ]);
      const lineId = b.lines[0].lineId;
      const roomId = b.lines[0].roomId;

      const res = await fetch(`${baseUrl}/api/bookings/${b.bookingId}/lines/${lineId}/no-show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uColomboFD },
        body: JSON.stringify({
          markTime: '2026-12-10T18:30:00Z',
          reason: 'Guest did not check in within grace period',
        }),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.no_show?.status, 'NO_SHOW');
      assert.equal(data.no_show?.no_show_fee, 2000.00);

      // Verify DB line status
      const lineRow = (await client.query(`SELECT status FROM booking_room_line WHERE line_id = $1`, [lineId])).rows[0];
      assert.equal(lineRow.status, 'NO_SHOW');

      // Verify assignment closed without occupancy
      const assignRow = (await client.query(`SELECT occupied_from, unassigned_at FROM booking_room_assignment WHERE line_id = $1`, [lineId])).rows[0];
      assert.equal(assignRow.occupied_from, null);
      assert.ok(assignRow.unassigned_at !== null, 'Assignment unassigned_at must be populated');

      // Verify room physical condition remains READY (no occupancy occurred)
      const roomRow = (await client.query(`SELECT operational_status FROM room WHERE room_id = $1`, [roomId])).rows[0];
      assert.equal(roomRow.operational_status, 'READY');

      // Verify status history
      const histRow = (await client.query(`
        SELECT old_status, new_status, reason, changed_by
          FROM booking_room_line_status_history
         WHERE line_id = $1
         ORDER BY history_id DESC
         LIMIT 1
      `, [lineId])).rows[0];
      assert.equal(histRow.old_status, 'BOOKED');
      assert.equal(histRow.new_status, 'NO_SHOW');
      assert.equal(histRow.changed_by, uColomboFD);
    });

    // =========================================================================
    // Subtest 7: After cutoff deadline, no-show transition succeeds (200 OK)
    // =========================================================================
    await t.test('7. After cutoff deadline, no-show transition succeeds (200 OK)', async () => {
      // Stay start date: 2026-12-10 => Cutoff is 2026-12-11 00:00:00+05:30.
      // Call at 2026-12-11 09:00:00+05:30 (UTC 2026-12-11T03:30:00Z)
      const b = await createBookingWithLines(gAlice, bColombo, [
        { stayStartDate: '2026-12-10', stayEndDate: '2026-12-12' },
      ]);
      const lineId = b.lines[0].lineId;

      const res = await fetch(`${baseUrl}/api/bookings/${b.bookingId}/lines/${lineId}/no-show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uColomboBM },
        body: JSON.stringify({
          markTime: '2026-12-11T03:30:00Z',
          reason: 'Morning audit marking absent guest',
        }),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.no_show?.status, 'NO_SHOW');
    });

    // =========================================================================
    // Subtest 8: Partial no-show: Line A marked NO_SHOW, Line B remains valid and BOOKED
    // =========================================================================
    await t.test('8. Partial no-show: Line A marked NO_SHOW, Line B remains BOOKED and active', async () => {
      const b = await createBookingWithLines(gAlice, bColombo, [
        { stayStartDate: '2026-11-01', stayEndDate: '2026-11-03', rate: 10000.00 }, // 2 nights = 20,000
        { stayStartDate: '2026-11-01', stayEndDate: '2026-11-04', rate: 12000.00 }, // 3 nights = 36,000
      ]);

      const lineA = b.lines[0].lineId;
      const lineB = b.lines[1].lineId;

      // Mark Line A as NO_SHOW by Colombo Front Desk (call at 2026-11-02 10:00:00+05:30)
      const res = await fetch(`${baseUrl}/api/bookings/${b.bookingId}/lines/${lineA}/no-show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uColomboFD },
        body: JSON.stringify({
          markTime: '2026-11-02T04:30:00Z', // 10:00 Colombo (past cutoff 2026-11-02 00:00:00+05:30)
          reason: 'First room occupant did not arrive',
        }),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.no_show?.status, 'NO_SHOW');
      assert.equal(data.no_show?.remaining_active_lines, 1);

      // Verify Line B remains BOOKED and its assignment is still open
      const lineBRow = (await client.query(`SELECT status FROM booking_room_line WHERE line_id = $1`, [lineB])).rows[0];
      assert.equal(lineBRow.status, 'BOOKED');

      const assignBRow = (await client.query(`SELECT unassigned_at FROM booking_room_assignment WHERE line_id = $1`, [lineB])).rows[0];
      assert.equal(assignBRow.unassigned_at, null, 'Line B open assignment must remain open');

      // Verify invoice lines:
      // Line A has NO_SHOW_FEE (2000.00) and NO ROOM charges
      // Line B has ROOM charges (3 nights @ 12000 = 36000.00)
      const invLines = (await client.query(`
        SELECT line_type, booking_room_line_id, amount
          FROM invoice_line
         WHERE invoice_id = $1
      `, [b.invoiceId])).rows;

      const lineACharges = invLines.filter(l => l.booking_room_line_id === lineA);
      assert.equal(lineACharges.length, 1);
      assert.equal(lineACharges[0].line_type, 'NO_SHOW_FEE');
      assert.equal(Number(lineACharges[0].amount), 2000.00);

      const lineBCharges = invLines.filter(l => l.booking_room_line_id === lineB);
      assert.equal(lineBCharges.length, 1);
      assert.equal(lineBCharges[0].line_type, 'ROOM');
      assert.equal(Number(lineBCharges[0].amount), 36000.00);
    });

    // =========================================================================
    // Subtest 9: Date revision changes derived cutoff deadline (FR-064)
    // =========================================================================
    await t.test('9. Pre-check-in date revision moves derived cutoff deadline', async () => {
      // Line originally scheduled for 2026-12-15 to 2026-12-17 (cutoff: 2026-12-16 00:00:00+05:30)
      const b = await createBookingWithLines(gAlice, bColombo, [
        { stayStartDate: '2026-12-15', stayEndDate: '2026-12-17' },
      ]);
      const lineId = b.lines[0].lineId;

      // Guest postpones arrival date to 2026-12-20 to 2026-12-22
      await client.query('BEGIN');
      await client.query(`
        INSERT INTO booking_room_line_revision (
          line_id, old_stay_start_date, old_stay_end_date, old_guest_count, old_rate_snapshot,
          new_stay_start_date, new_stay_end_date, new_guest_count, new_rate_snapshot,
          changed_by, reason
        ) VALUES (
          $1, '2026-12-15', '2026-12-17', 2, 10000.00,
          '2026-12-20', '2026-12-22', 2, 10000.00,
          $2, 'Guest postponed reservation dates'
        );
      `, [lineId, uColomboFD]);

      await client.query(`
        UPDATE booking_room_line
           SET stay_start_date = '2026-12-20',
               stay_end_date = '2026-12-22'
         WHERE line_id = $1;
      `, [lineId]);
      await client.query('COMMIT');

      // Attempt no-show at 2026-12-16 08:00:00+05:30 (past original cutoff, but before revised cutoff 2026-12-21 00:00:00+05:30)
      const resEarly = await fetch(`${baseUrl}/api/bookings/${b.bookingId}/lines/${lineId}/no-show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uColomboFD },
        body: JSON.stringify({ markTime: '2026-12-16T02:30:00Z' }),
      });
      assert.equal(resEarly.status, 400);
      const dataEarly = await resEarly.json();
      assert.equal(dataEarly.error?.code, 'EARLY_NO_SHOW_NOT_ALLOWED');

      // Attempt no-show at 2026-12-21 08:00:00+05:30 (past revised cutoff)
      const resValid = await fetch(`${baseUrl}/api/bookings/${b.bookingId}/lines/${lineId}/no-show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uColomboFD },
        body: JSON.stringify({ markTime: '2026-12-21T02:30:00Z' }),
      });
      assert.equal(resValid.status, 200);
      const dataValid = await resValid.json();
      assert.equal(dataValid.success, true);
      assert.equal(dataValid.no_show?.status, 'NO_SHOW');
    });

    // =========================================================================
    // Subtest 10: Demo policy boundary test (is_demo = true, grace_days = 1, fee = 0.00)
    // =========================================================================
    await t.test('10. Demo billing policy boundary: grace_days = 1 and zero fee', async () => {
      // Create demo policy
      const demoPol = (await client.query(`
        INSERT INTO billing_policy (
          effective_from, tax_percent, service_charge_percent, max_discount_percent,
          cancellation_fee, no_show_fee, late_checkout_fee, no_show_grace_days,
          is_demo, created_by
        ) VALUES (
          CURRENT_DATE - 10, 0.00, 0.00, 0.00,
          0.00, 0.00, 0.00, 1,
          true, $1
        ) RETURNING billing_policy_id;
      `, [uChainMgr])).rows[0].billing_policy_id;

      // Seed booking linking explicitly to demo policy
      const bRef = `BK-DEMO-${Date.now()}`;
      await client.query('BEGIN');
      const bId = (await client.query(`
        INSERT INTO booking (guest_id, created_by, booking_ref, booking_channel)
        VALUES ($1, $2, $3, 'FRONT_DESK') RETURNING booking_id;
      `, [gAlice, uColomboFD, bRef])).rows[0].booking_id;

      const lId = (await client.query(`
        INSERT INTO booking_room_line (
          booking_id, stay_start_date, stay_end_date, guest_count, rate_snapshot, status
        ) VALUES ($1, '2026-12-05', '2026-12-07', 2, 10000.00, 'BOOKED')
        RETURNING line_id;
      `, [bId])).rows[0].line_id;

      const rId = await createCleanRoom(bColombo);
      await client.query(`INSERT INTO booking_room_assignment (line_id, room_id) VALUES ($1, $2);`, [lId, rId]);
      await client.query(`INSERT INTO booking_room_line_status_history (line_id, old_status, new_status, changed_by, reason) VALUES ($1, NULL, 'BOOKED', $2, 'Init');`, [lId, uColomboFD]);
      await client.query('COMMIT');

      // Create draft invoice linked directly to demo policy within transaction
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_user_id', $1, true);`, [uColomboFD]);
      await client.query(`
        INSERT INTO invoice (booking_id, billing_policy_id, status)
        VALUES ($1, $2, 'DRAFT');
      `, [bId, demoPol]);
      await client.query('COMMIT');

      // Cutoff deadline is 2026-12-06 00:00:00+05:30 (UTC 2026-12-05T18:30:00Z)
      // Call exactly at cutoff
      const res = await fetch(`${baseUrl}/api/bookings/${bId}/lines/${lId}/no-show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uColomboFD },
        body: JSON.stringify({ markTime: '2026-12-05T18:30:00Z' }),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.no_show?.no_show_fee, 0.00);
    });

    // =========================================================================
    // Subtest 11: Later-policy fee stability (FR-076, DBR-036)
    // =========================================================================
    await t.test('11. Later-policy changes do not alter existing booking no-show fee or grace days', async () => {
      // Booking confirmed under Policy V1 (no_show_fee = 2000.00, grace_days = 1)
      const b = await createBookingWithLines(gAlice, bColombo, [
        { stayStartDate: '2026-12-01', stayEndDate: '2026-12-03' },
      ]);
      const lineId = b.lines[0].lineId;

      // Management publishes Policy V2 with higher no-show fee (5000.00) and 3 grace days
      await client.query(`
        INSERT INTO billing_policy (
          effective_from, tax_percent, service_charge_percent, max_discount_percent,
          cancellation_fee, no_show_fee, late_checkout_fee, no_show_grace_days,
          is_demo, created_by
        ) VALUES (
          CURRENT_DATE - 1, 12.00, 6.00, 15.00,
          3500.00, 5000.00, 3000.00, 3,
          false, $1
        );
      `, [uChainMgr]);

      // Under Policy V1 (grace_days = 1), cutoff is 2026-12-02 00:00:00+05:30 (UTC 2026-12-01T18:30:00Z)
      // Call at 2026-12-02 08:00:00+05:30 (UTC 2026-12-02T02:30:00Z)
      // (Note: Under Policy V2, cutoff would have been 3 days later, so this would have been rejected if V2 applied!)
      const res = await fetch(`${baseUrl}/api/bookings/${b.bookingId}/lines/${lineId}/no-show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uChainMgr },
        body: JSON.stringify({ markTime: '2026-12-02T02:30:00Z' }),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      // Fee must be 2000.00 from Policy V1, NOT 5000.00 from V2!
      assert.equal(data.no_show?.no_show_fee, 2000.00);

      const feeLine = (await client.query(`
        SELECT amount FROM invoice_line WHERE invoice_id = $1 AND line_type = 'NO_SHOW_FEE'
      `, [b.invoiceId])).rows[0];
      assert.equal(Number(feeLine.amount), 2000.00);

      // Publish Policy V3 restoring standard baseline for subsequent subtests
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
    // Subtest 12: Prior-payment credit and refund path
    // =========================================================================
    await t.test('12. Prior-payment credit: no-show removes room nights, creates credit for staff refund', async () => {
      const b = await createBookingWithLines(gAlice, bColombo, [
        { stayStartDate: '2026-11-20', stayEndDate: '2026-11-22', rate: 10000.00 },
      ]);
      const lineId = b.lines[0].lineId;

      // Guest made prepayment of 15,000 LKR
      const payRes = await fetch(`${baseUrl}/api/bookings/${b.bookingId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uColomboFD },
        body: JSON.stringify({
          amount: 15000.00,
          method: 'BANK_TRANSFER',
          reference: `PAY-PREPAY-NS-${Date.now()}`,
        }),
      });
      assert.equal(payRes.status, 201);

      // Mark line as NO_SHOW past cutoff
      const nsRes = await fetch(`${baseUrl}/api/bookings/${b.bookingId}/lines/${lineId}/no-show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uColomboFD },
        body: JSON.stringify({
          markTime: '2026-11-21T06:00:00Z',
          reason: 'Guest absent',
        }),
      });
      assert.equal(nsRes.status, 200);
      const nsData = await nsRes.json();

      // Invoice charges are now: 2000.00 (no-show fee)
      // Net payments: 15,000.00
      // Balance: 2000.00 - 15000.00 = -13,000.00 (credit)
      assert.equal(nsData.no_show?.is_credit, true);
      assert.equal(nsData.no_show?.credit_amount, 13000.00);
      assert.equal(nsData.no_show?.outstanding_balance, -13000.00);

      // Staff issues refund of 13,000 LKR
      const refRes = await fetch(`${baseUrl}/api/bookings/${b.bookingId}/refunds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uColomboFD },
        body: JSON.stringify({
          amount: 13000.00,
          method: 'BANK_TRANSFER',
          reference: `REF-CREDIT-NS-${Date.now()}`,
        }),
      });
      assert.equal(refRes.status, 201);

      // Balance is now settled to 0.00
      const finalBalRes = await client.query(`SELECT fn_outstanding_balance($1) AS bal`, [b.bookingId]);
      assert.equal(Number(finalBalRes.rows[0].bal), 0.00);
    });

    // =========================================================================
    // Subtest 13: Checked-in room line cannot be marked NO_SHOW (400 CANNOT_NO_SHOW_CHECKED_IN)
    // =========================================================================
    await t.test('13. Checked-in room line cannot be marked as NO_SHOW (400)', async () => {
      const b = await createBookingWithLines(gAlice, bColombo, [{}]);
      const lineId = b.lines[0].lineId;

      // Transition line to CHECKED_IN
      await client.query('BEGIN');
      await client.query(`UPDATE booking_room_assignment SET occupied_from = CURRENT_TIMESTAMP WHERE line_id = $1`, [lineId]);
      await client.query(`UPDATE booking_room_line SET status = 'CHECKED_IN' WHERE line_id = $1;`, [lineId]);
      await client.query(`
        INSERT INTO booking_room_line_status_history (line_id, old_status, new_status, changed_by, reason)
        VALUES ($1, 'BOOKED', 'CHECKED_IN', $2, 'Checked in');
      `, [lineId, uColomboFD]);
      await client.query('COMMIT');

      const res = await fetch(`${baseUrl}/api/bookings/${b.bookingId}/lines/${lineId}/no-show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uColomboFD },
        body: JSON.stringify({ markTime: '2026-12-30T10:00:00Z' }),
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.error?.code, 'CANNOT_NO_SHOW_CHECKED_IN');
    });

    // =========================================================================
    // Subtest 14: Cancelled line cannot be marked NO_SHOW (400 CANNOT_NO_SHOW_CANCELLED)
    // =========================================================================
    await t.test('14. Cancelled room line cannot be marked as NO_SHOW (400)', async () => {
      const b = await createBookingWithLines(gAlice, bColombo, [
        { stayStartDate: '2026-12-15', stayEndDate: '2026-12-17' },
      ]);
      const lineId = b.lines[0].lineId;

      // Cancel the line first before cutoff
      const cancelRes = await fetch(`${baseUrl}/api/bookings/${b.bookingId}/lines/${lineId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uColomboFD },
        body: JSON.stringify({ cancelTime: '2026-12-14T10:00:00Z' }),
      });
      assert.equal(cancelRes.status, 200);

      // Now attempt to mark as NO_SHOW
      const res = await fetch(`${baseUrl}/api/bookings/${b.bookingId}/lines/${lineId}/no-show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uColomboFD },
        body: JSON.stringify({ markTime: '2026-12-17T10:00:00Z' }),
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.error?.code, 'CANNOT_NO_SHOW_CANCELLED');
    });

    // =========================================================================
    // Subtest 15: Repeated NO_SHOW on already NO_SHOW line
    // =========================================================================
    await t.test('15. Repeated NO_SHOW: default 409 Conflict; ?idempotent=true returns 200 OK', async () => {
      const b = await createBookingWithLines(gAlice, bColombo, [
        { stayStartDate: '2026-11-10', stayEndDate: '2026-11-12' },
      ]);
      const lineId = b.lines[0].lineId;

      // First call succeeds
      const res1 = await fetch(`${baseUrl}/api/bookings/${b.bookingId}/lines/${lineId}/no-show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uColomboFD },
        body: JSON.stringify({ markTime: '2026-11-11T10:00:00Z' }),
      });
      assert.equal(res1.status, 200);

      // Repeat without idempotency flag fails with 409
      const res2 = await fetch(`${baseUrl}/api/bookings/${b.bookingId}/lines/${lineId}/no-show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uColomboFD },
      });
      assert.equal(res2.status, 409);
      const data2 = await res2.json();
      assert.equal(data2.error?.code, 'LINE_ALREADY_NO_SHOW');

      // Repeat with ?idempotent=true returns 200 OK with repeated: true
      const res3 = await fetch(`${baseUrl}/api/bookings/${b.bookingId}/lines/${lineId}/no-show?idempotent=true`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': uColomboFD },
      });
      assert.equal(res3.status, 200);
      const data3 = await res3.json();
      assert.equal(data3.success, true);
      assert.equal(data3.repeated, true);
      assert.equal(data3.no_show?.status, 'NO_SHOW');
    });

    // =========================================================================
    // Subtest 16: No-show quote and eligibility inspection
    // =========================================================================
    await t.test('16. No-show quote inspection returns eligibility and cutoff deadline', async () => {
      // Future reservation (cutoff not yet reached)
      const b = await createBookingWithLines(gAlice, bColombo, [
        { stayStartDate: '2026-12-25', stayEndDate: '2026-12-27' },
      ]);
      const lineId = b.lines[0].lineId;

      const res = await fetch(`${baseUrl}/api/bookings/${b.bookingId}/lines/${lineId}/no-show-quote`, {
        method: 'GET',
        headers: { 'x-user-id': uColomboFD },
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.quote?.is_eligible, false);
      assert.equal(data.quote?.no_show_fee, 2000.00);
      assert.ok(data.quote?.cutoff_deadline);
      assert.match(data.quote?.rejection_reason, /Cutoff deadline .* has not yet passed/i);
    });

    // =========================================================================
    // Subtest 17: Stored procedures sp_no_show_room_line and sp_no_show_booking
    // =========================================================================
    await t.test('17. Stored procedures sp_no_show_room_line and sp_no_show_booking execute cleanly', async () => {
      // Use past dates so cutoff deadline has passed at CURRENT_TIMESTAMP
      const b1 = await createBookingWithLines(gAlice, bColombo, [
        { stayStartDate: '2026-10-01', stayEndDate: '2026-10-03' },
      ]);
      const l1 = b1.lines[0].lineId;

      // CALL sp_no_show_room_line
      await client.query(`CALL sp_no_show_room_line($1, $2, $3, 'SP per-line no-show test')`, [b1.bookingId, l1, uColomboFD]);
      const l1Status = (await client.query(`SELECT status FROM booking_room_line WHERE line_id = $1`, [l1])).rows[0].status;
      assert.equal(l1Status, 'NO_SHOW');

      const b2 = await createBookingWithLines(gAlice, bColombo, [
        { stayStartDate: '2026-10-01', stayEndDate: '2026-10-03' },
        { stayStartDate: '2026-10-01', stayEndDate: '2026-10-04' },
      ]);

      // CALL sp_no_show_booking
      await client.query(`CALL sp_no_show_booking($1, $2, 'SP whole booking no-show test')`, [b2.bookingId, uColomboFD]);
      const b2Lines = (await client.query(`SELECT status FROM booking_room_line WHERE booking_id = $1`, [b2.bookingId])).rows;
      assert.ok(b2Lines.every(l => l.status === 'NO_SHOW'));
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
