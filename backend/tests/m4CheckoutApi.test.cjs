const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { Client } = require('pg');

function loadDatabaseUrl() {
  const envPath = path.resolve(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('PG_URL=')) {
        return trimmed.replace('PG_URL=', '').trim().replace(/^["']|["']$/g, '');
      }
    }
  }
  return process.env.PG_URL || process.env.DATABASE_URL;
}

test('M4-S10: Line-specific checkout API with branch/role guards and explicit repeated-request behavior', async (t) => {
  const connectionString = loadDatabaseUrl();
  assert.ok(connectionString, 'Database connection string must be defined');

  const client = new Client({ connectionString });
  await client.connect();

  const scratchSchema = `test_m4_s10_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  let server;
  let baseUrl;

  try {
    await client.query(`CREATE SCHEMA ${scratchSchema}`);
    await client.query(`SET search_path TO ${scratchSchema}, public`);

    // Apply all 20 migrations in order
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
      VALUES ('Colombo Grand', 'Colombo', '10 Galle Road, Colombo')
      RETURNING branch_id;
    `)).rows[0].branch_id;

    const bKandy = (await client.query(`
      INSERT INTO branch (name, city, address)
      VALUES ('Kandy Hills', 'Kandy', '20 Peradeniya Road, Kandy')
      RETURNING branch_id;
    `)).rows[0].branch_id;

    // 2. Seed Staff Roles & Accounts
    const roleFD = (await client.query(`SELECT role_id FROM role WHERE role_name = 'FRONT_DESK'`)).rows[0].role_id;
    const roleBM = (await client.query(`SELECT role_id FROM role WHERE role_name = 'BRANCH_MANAGER'`)).rows[0].role_id;
    const roleCM = (await client.query(`SELECT role_id FROM role WHERE role_name = 'CHAIN_MANAGER'`)).rows[0].role_id;
    const roleSA = (await client.query(`SELECT role_id FROM role WHERE role_name = 'SYSTEM_ADMINISTRATOR'`)).rows[0].role_id;
    const roleSS = (await client.query(`SELECT role_id FROM role WHERE role_name = 'SERVICE_STAFF'`)).rows[0].role_id;
    const roleAud = (await client.query(`SELECT role_id FROM role WHERE role_name = 'AUDITOR'`)).rows[0].role_id;

    // Staff Colombo Front Desk (own branch)
    const uColomboFD = (await client.query(`INSERT INTO user_account (username, password_hash) VALUES ('colombo_fd_10', 'pw') RETURNING user_id`)).rows[0].user_id;
    await client.query(`INSERT INTO officer (officer_id, full_name, role_id, branch_id) VALUES ($1, 'Colombo Desk Staff', $2, $3)`, [uColomboFD, roleFD, bColombo]);

    // Staff Colombo Branch Manager (own branch)
    const uColomboBM = (await client.query(`INSERT INTO user_account (username, password_hash) VALUES ('colombo_bm_10', 'pw') RETURNING user_id`)).rows[0].user_id;
    await client.query(`INSERT INTO officer (officer_id, full_name, role_id, branch_id) VALUES ($1, 'Colombo Manager', $2, $3)`, [uColomboBM, roleBM, bColombo]);

    // Staff Kandy Front Desk (cross branch)
    const uKandyFD = (await client.query(`INSERT INTO user_account (username, password_hash) VALUES ('kandy_fd_10', 'pw') RETURNING user_id`)).rows[0].user_id;
    await client.query(`INSERT INTO officer (officer_id, full_name, role_id, branch_id) VALUES ($1, 'Kandy Desk Staff', $2, $3)`, [uKandyFD, roleFD, bKandy]);

    // Staff Chain Manager (chain-wide)
    const uChainMgr = (await client.query(`INSERT INTO user_account (username, password_hash) VALUES ('chain_mgr_10', 'pw') RETURNING user_id`)).rows[0].user_id;
    await client.query(`INSERT INTO officer (officer_id, full_name, role_id, branch_id) VALUES ($1, 'Chain Exec', $2, $3)`, [uChainMgr, roleCM, bColombo]);

    // Staff System Administrator (chain-wide)
    const uSysAdmin = (await client.query(`INSERT INTO user_account (username, password_hash) VALUES ('sys_admin_10', 'pw') RETURNING user_id`)).rows[0].user_id;
    await client.query(`INSERT INTO officer (officer_id, full_name, role_id, branch_id) VALUES ($1, 'Sys Admin', $2, $3)`, [uSysAdmin, roleSA, bColombo]);

    // Staff Service Staff (not authorized for checkout)
    const uServiceStaff = (await client.query(`INSERT INTO user_account (username, password_hash) VALUES ('service_staff_10', 'pw') RETURNING user_id`)).rows[0].user_id;
    await client.query(`INSERT INTO officer (officer_id, full_name, role_id, branch_id) VALUES ($1, 'Service Staff Member', $2, $3)`, [uServiceStaff, roleSS, bColombo]);

    // Staff Auditor (read-only, not authorized for checkout)
    const uAuditor = (await client.query(`INSERT INTO user_account (username, password_hash) VALUES ('auditor_10', 'pw') RETURNING user_id`)).rows[0].user_id;
    await client.query(`INSERT INTO officer (officer_id, full_name, role_id, branch_id) VALUES ($1, 'Internal Auditor', $2, $3)`, [uAuditor, roleAud, bColombo]);

    // 3. Seed Online Guest (Alice)
    const uAlice = (await client.query(`INSERT INTO user_account (username, password_hash) VALUES ('alice_guest_10', 'pw') RETURNING user_id`)).rows[0].user_id;
    const gAlice = (await client.query(`INSERT INTO guest (full_name, email, phone, nic) VALUES ('Alice Perera', 'alice10@test.com', '0771010101', '199010101010') RETURNING guest_id`)).rows[0].guest_id;
    await client.query(`INSERT INTO guest_account (user_id, guest_id) VALUES ($1, $2)`, [uAlice, gAlice]);

    // 4. Seed Billing Policy
    await client.query(`
      INSERT INTO billing_policy (
        effective_from, tax_percent, service_charge_percent, max_discount_percent,
        cancellation_fee, no_show_fee, late_checkout_fee, no_show_grace_days,
        is_demo, created_by
      ) VALUES (
        CURRENT_DATE - 1, 10.00, 5.00, 20.00,
        1000.00, 2000.00, 1500.00, 1,
        false, $1
      );
    `, [uChainMgr]);

    // 5. Seed Room Type & Rooms
    const rtId = (await client.query(`
      INSERT INTO room_type (name, base_daily_rate, capacity)
      VALUES ('Deluxe Ocean', 10000.00, 2)
      RETURNING room_type_id;
    `)).rows[0].room_type_id;

    let roomCounter = 300;
    async function createCleanRoom(branchId) {
      roomCounter++;
      const r = (await client.query(`
        INSERT INTO room (room_number, branch_id, room_type_id, operational_status)
        VALUES ($1, $2, $3, 'READY')
        RETURNING room_id;
      `, [String(roomCounter), branchId, rtId])).rows[0].room_id;
      return r;
    }

    // Helper: Atomic multi-line booking creation adhering to M2 deferred triggers
    async function createBookingWithLines({ ref, branchId, lines }) {
      await client.query('BEGIN');
      const bRes = await client.query(`
        INSERT INTO booking (booking_ref, booking_channel, guest_id, created_by)
        VALUES ($1, 'FRONT_DESK', $2, $3)
        RETURNING booking_id;
      `, [ref, gAlice, uColomboFD]);
      const bookingId = bRes.rows[0].booking_id;

      const createdLineIds = [];
      for (const lineInfo of lines) {
        const { roomId, checkIn = false, rate = 10000.00 } = lineInfo;

        const lRes = await client.query(`
          INSERT INTO booking_room_line (booking_id, stay_start_date, stay_end_date, guest_count, rate_snapshot, status)
          VALUES ($1, CURRENT_DATE - 1, CURRENT_DATE, 1, $2, 'BOOKED')
          RETURNING line_id;
        `, [bookingId, rate]);
        const lineId = lRes.rows[0].line_id;
        createdLineIds.push(lineId);

        await client.query(`
          INSERT INTO booking_room_line_status_history (line_id, old_status, new_status, changed_by, reason)
          VALUES ($1, NULL, 'BOOKED', $2, 'Initial reservation');
        `, [lineId, uColomboFD]);

        await client.query(`
          INSERT INTO booking_room_assignment (line_id, room_id)
          VALUES ($1, $2);
        `, [lineId, roomId]);

        if (checkIn) {
          await client.query(`
            UPDATE booking_room_assignment
               SET occupied_from = CURRENT_TIMESTAMP - interval '2 hours'
             WHERE line_id = $1 AND unassigned_at IS NULL;
          `, [lineId]);

          await client.query(`
            UPDATE booking_room_line
               SET status = 'CHECKED_IN'
             WHERE line_id = $1;
          `, [lineId]);

          await client.query(`
            INSERT INTO booking_room_line_status_history (line_id, old_status, new_status, changed_by, reason)
            VALUES ($1, 'BOOKED', 'CHECKED_IN', $2, 'Check-in');
          `, [lineId, uColomboFD]);
        }
      }

      await client.query('COMMIT');

      // Create draft invoice linked to effective policy
      await client.query(`SELECT fn_create_booking_draft_invoice($1, $2)`, [bookingId, uColomboFD]);

      return { bookingId, lineIds: createdLineIds };
    }

    // Setup Express App with custom test database client
    const { createCheckoutRouter } = await import('../src/routes/checkoutRoutes');
    const { createPaymentRouter } = await import('../src/routes/paymentRoutes');

    const app = express();
    app.use(express.json());

    const testDb = {
      query: (sql, values) => client.query(sql, values),
    };

    app.use('/api', createCheckoutRouter(undefined, testDb));
    app.use('/api', createPaymentRouter(undefined, testDb));

    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const addr = server.address();
    assert.ok(addr && typeof addr !== 'string');
    baseUrl = `http://127.0.0.1:${addr.port}`;

    async function reqApi(pathName, options = {}) {
      const { method = 'POST', headers = {}, body = null } = options;
      const res = await fetch(`${baseUrl}${pathName}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: body ? JSON.stringify(body) : null,
      });
      const data = await res.json().catch(() => null);
      return { status: res.status, data };
    }

    // Create a shared Colombo booking with 2 checked-in rooms for primary tests
    const rAColombo = await createCleanRoom(bColombo);
    const rBColombo = await createCleanRoom(bColombo);
    const twoRoomBooking = await createBookingWithLines({
      ref: 'REF-TWO-ROOM-API',
      branchId: bColombo,
      lines: [
        { roomId: rAColombo, checkIn: true },
        { roomId: rBColombo, checkIn: true },
      ],
    });
    const mainBookingId = twoRoomBooking.bookingId;
    const [lineAId, lineBId] = twoRoomBooking.lineIds;

    // SUBTEST 1: Authentication Guard
    await t.test('1. Unauthenticated request without actor headers fails with 401', async () => {
      const res = await reqApi(`/api/bookings/${mainBookingId}/lines/${lineAId}/checkout`, {
        method: 'POST',
        headers: {}, // no x-user-id
      });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.data.error.code, 'AUTHENTICATION_REQUIRED');
    });

    // SUBTEST 2: Online Guest Guard
    await t.test('2. Online guest cannot perform staff checkout (403 Forbidden)', async () => {
      const res = await reqApi(`/api/bookings/${mainBookingId}/lines/${lineAId}/checkout`, {
        method: 'POST',
        headers: { 'x-user-id': uAlice },
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.data.error.code, 'FORBIDDEN');
      assert.match(res.data.error.message, /online guests are not authorized/i);
    });

    // SUBTEST 3: Service Staff Role Guard
    await t.test('3. Service staff cannot perform checkout (403 Forbidden)', async () => {
      const res = await reqApi(`/api/bookings/${mainBookingId}/lines/${lineAId}/checkout`, {
        method: 'POST',
        headers: { 'x-user-id': uServiceStaff },
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.data.error.code, 'FORBIDDEN');
      assert.match(res.data.error.message, /SERVICE_STAFF role is not authorized/i);
    });

    // SUBTEST 4: Auditor Role Guard
    await t.test('4. Auditor cannot perform checkout (403 Forbidden)', async () => {
      const res = await reqApi(`/api/bookings/${mainBookingId}/lines/${lineAId}/checkout`, {
        method: 'POST',
        headers: { 'x-user-id': uAuditor },
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.data.error.code, 'FORBIDDEN');
      assert.match(res.data.error.message, /AUDITOR role is not authorized/i);
    });

    // SUBTEST 5: Cross-branch Staff Guard
    await t.test('5. Cross-branch Front Desk cannot checkout other branch stay (403 Forbidden)', async () => {
      const res = await reqApi(`/api/bookings/${mainBookingId}/lines/${lineAId}/checkout`, {
        method: 'POST',
        headers: { 'x-user-id': uKandyFD }, // Kandy staff accessing Colombo booking
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.data.error.code, 'FORBIDDEN');
      assert.match(res.data.error.message, /restricted to own branch/i);
    });

    // SUBTEST 6: Invalid/non-existent booking
    await t.test('6. Non-existent booking ID fails with 404 (BOOKING_NOT_FOUND)', async () => {
      const dummyBooking = '00000000-0000-0000-0000-000000000000';
      const res = await reqApi(`/api/bookings/${dummyBooking}/lines/${lineAId}/checkout`, {
        method: 'POST',
        headers: { 'x-user-id': uColomboFD },
      });
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.data.error.code, 'BOOKING_NOT_FOUND');
    });

    // SUBTEST 7: Malformed line ID
    await t.test('7. Malformed room line ID fails with 400 (INVALID_LINE_ID)', async () => {
      const res = await reqApi(`/api/bookings/${mainBookingId}/lines/not-a-valid-uuid/checkout`, {
        method: 'POST',
        headers: { 'x-user-id': uColomboFD },
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.error.code, 'INVALID_LINE_ID');
    });

    // SUBTEST 8: Non-existent line UUID
    await t.test('8. Non-existent line UUID fails with 404 (ROOM_LINE_NOT_FOUND)', async () => {
      const dummyLine = 'a0000000-0000-0000-0000-000000000000';
      const res = await reqApi(`/api/bookings/${mainBookingId}/lines/${dummyLine}/checkout`, {
        method: 'POST',
        headers: { 'x-user-id': uColomboFD },
      });
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.data.error.code, 'ROOM_LINE_NOT_FOUND');
    });

    // SUBTEST 9: Cross-booking line mismatch
    await t.test('9. Line belonging to another booking fails with 400 (LINE_BOOKING_MISMATCH)', async () => {
      const rOther = await createCleanRoom(bColombo);
      const otherBooking = await createBookingWithLines({
        ref: 'REF-OTHER-BOOKING',
        branchId: bColombo,
        lines: [{ roomId: rOther, checkIn: true }],
      });

      const res = await reqApi(`/api/bookings/${mainBookingId}/lines/${otherBooking.lineIds[0]}/checkout`, {
        method: 'POST',
        headers: { 'x-user-id': uColomboFD },
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.error.code, 'LINE_BOOKING_MISMATCH');
    });

    // SUBTEST 10: Line in BOOKED (not checked in) status
    await t.test('10. Line in BOOKED status fails with 400 (INVALID_LINE_STATUS)', async () => {
      const rBooked = await createCleanRoom(bColombo);
      const bookedStay = await createBookingWithLines({
        ref: 'REF-BOOKED-STAY',
        branchId: bColombo,
        lines: [{ roomId: rBooked, checkIn: false }], // not checked in
      });

      const res = await reqApi(`/api/bookings/${bookedStay.bookingId}/lines/${bookedStay.lineIds[0]}/checkout`, {
        method: 'POST',
        headers: { 'x-user-id': uColomboFD },
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.error.code, 'INVALID_LINE_STATUS');
      assert.match(res.data.error.message, /must be CHECKED_IN/i);
    });

    // SUBTEST 11: Positive balance due blocks checkout (FR-059, BR-008)
    await t.test('11. Positive balance due blocks checkout with 400 (OUTSTANDING_BALANCE_DUE)', async () => {
      // 2 rooms @ 10,000 = 20,000 gross + 5% SC (1,000) + 10% Tax (2,100) = 23,100.00 LKR due.
      const res = await reqApi(`/api/bookings/${mainBookingId}/lines/${lineAId}/checkout`, {
        method: 'POST',
        headers: { 'x-user-id': uColomboFD },
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.error.code, 'OUTSTANDING_BALANCE_DUE');
      assert.match(res.data.error.message, /outstanding balance of LKR 23100\.00/i);
    });

    // SUBTEST 12: Negative unrefunded credit blocks checkout (FR-059, BR-008)
    await t.test('12. Negative unrefunded credit blocks checkout with 400 (UNREFUNDED_CREDIT_REMAINING)', async () => {
      const rCredit = await createCleanRoom(bColombo);
      const creditBooking = await createBookingWithLines({
        ref: 'REF-CREDIT-STAY',
        branchId: bColombo,
        lines: [{ roomId: rCredit, checkIn: true }],
      });
      const cBookingId = creditBooking.bookingId;
      const cLineId = creditBooking.lineIds[0];

      // 1 room @ 10,000 = 10,000 gross + 5% SC (500) + 10% Tax (1,050) = 11,550.00
      // Pay exact 11,550
      await reqApi(`/api/bookings/${cBookingId}/payments`, {
        method: 'POST',
        headers: { 'x-user-id': uColomboFD },
        body: { amount: 11550.00, method: 'CASH' },
      });

      // Insert -2,000 courtesy rebate adjustment to create credit of -2,000.00
      const invId = (await client.query(`SELECT invoice_id FROM invoice WHERE booking_id = $1`, [cBookingId])).rows[0].invoice_id;
      await client.query(`
        INSERT INTO invoice_line (invoice_id, line_type, description, amount)
        VALUES ($1, 'PRICE_ADJUSTMENT', 'Courtesy credit rebate', -2000.00);
      `, [invId]);

      // Attempt checkout on credit balance
      const res = await reqApi(`/api/bookings/${cBookingId}/lines/${cLineId}/checkout`, {
        method: 'POST',
        headers: { 'x-user-id': uColomboFD },
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.error.code, 'UNREFUNDED_CREDIT_REMAINING');
      assert.match(res.data.error.message, /unrefunded credit balance of LKR 2000\.00/i);

      // Refund the 2,000 credit
      const refRes = await reqApi(`/api/bookings/${cBookingId}/refunds`, {
        method: 'POST',
        headers: { 'x-user-id': uColomboFD },
        body: { amount: 2000.00, method: 'CASH' },
      });
      assert.strictEqual(refRes.status, 201);

      // Balance is now 0.00 -> checkout succeeds!
      const coRes = await reqApi(`/api/bookings/${cBookingId}/lines/${cLineId}/checkout`, {
        method: 'POST',
        headers: { 'x-user-id': uColomboFD },
      });
      assert.strictEqual(coRes.status, 200);
      assert.strictEqual(coRes.data.success, true);
      assert.strictEqual(coRes.data.is_finalized, true);
      assert.strictEqual(coRes.data.room_condition, 'CLEANING');
    });

    // SUBTEST 13: Partial Checkout of Line A in Two-Room Booking (Own-branch Front Desk)
    await t.test('13. Partial checkout of Line A succeeds, keeps invoice DRAFT with provisional ref', async () => {
      // Settle the 23,100 balance on mainBookingId
      const payRes = await reqApi(`/api/bookings/${mainBookingId}/payments`, {
        method: 'POST',
        headers: { 'x-user-id': uColomboFD },
        body: { amount: 23100.00, method: 'BANK_TRANSFER', reference: 'PAY-SETTLE-MAIN' },
      });
      assert.strictEqual(payRes.status, 201);
      assert.strictEqual(payRes.data.receipt.is_settled, true);

      // Check out Line A
      const res = await reqApi(`/api/bookings/${mainBookingId}/lines/${lineAId}/checkout`, {
        method: 'POST',
        headers: { 'x-user-id': uColomboFD },
        body: { reason: 'Guest A departed morning flight' },
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.line_id, lineAId);
      assert.strictEqual(res.data.room_condition, 'CLEANING');
      assert.strictEqual(res.data.remaining_active_lines, 1);
      assert.strictEqual(res.data.is_finalized, false);
      assert.strictEqual(res.data.invoice_number, null);
      assert.match(res.data.provisional_statement_ref, /^PROV-\d{8}-/);
      assert.ok(res.data.receipt);
      assert.strictEqual(res.data.receipt.statement_reference, res.data.provisional_statement_ref);

      // Verify Line A in DB is CHECKED_OUT
      const lA = (await client.query(`SELECT status FROM booking_room_line WHERE line_id = $1`, [lineAId])).rows[0];
      assert.strictEqual(lA.status, 'CHECKED_OUT');

      // Verify Room A in DB is CLEANING
      const rA = (await client.query(`SELECT operational_status FROM room WHERE room_id = $1`, [rAColombo])).rows[0];
      assert.strictEqual(rA.operational_status, 'CLEANING');

      // Verify Line B remains CHECKED_IN and Room B remains READY
      const lB = (await client.query(`SELECT status FROM booking_room_line WHERE line_id = $1`, [lineBId])).rows[0];
      assert.strictEqual(lB.status, 'CHECKED_IN');
      const rB = (await client.query(`SELECT operational_status FROM room WHERE room_id = $1`, [rBColombo])).rows[0];
      assert.strictEqual(rB.operational_status, 'READY');

      // Verify Invoice remains DRAFT
      const inv = (await client.query(`SELECT status, invoice_number FROM invoice WHERE booking_id = $1`, [mainBookingId])).rows[0];
      assert.strictEqual(inv.status, 'DRAFT');
      assert.strictEqual(inv.invoice_number, null);
    });

    // SUBTEST 14: Final Checkout of Line B by Chain Manager (universal access) finalizes invoice
    await t.test('14. Final checkout of Line B finalizes invoice and assigns sequential invoice number', async () => {
      const res = await reqApi(`/api/bookings/${mainBookingId}/lines/${lineBId}/checkout`, {
        method: 'POST',
        headers: { 'x-user-id': uChainMgr }, // Chain Manager has universal branch access
        body: { reason: 'Guest B departed afternoon' },
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.line_id, lineBId);
      assert.strictEqual(res.data.room_condition, 'CLEANING');
      assert.strictEqual(res.data.remaining_active_lines, 0);
      assert.strictEqual(res.data.is_finalized, true);
      assert.match(res.data.invoice_number, /^INV-\d{8}-\d{5}$/);
      assert.strictEqual(res.data.provisional_statement_ref, res.data.invoice_number);

      // Verify Line B in DB is CHECKED_OUT and Room B is CLEANING
      const lB = (await client.query(`SELECT status FROM booking_room_line WHERE line_id = $1`, [lineBId])).rows[0];
      assert.strictEqual(lB.status, 'CHECKED_OUT');
      const rB = (await client.query(`SELECT operational_status FROM room WHERE room_id = $1`, [rBColombo])).rows[0];
      assert.strictEqual(rB.operational_status, 'CLEANING');

      // Verify Invoice in DB is FINAL
      const invFinal = (await client.query(`SELECT status, invoice_number, issued_at FROM invoice WHERE booking_id = $1`, [mainBookingId])).rows[0];
      assert.strictEqual(invFinal.status, 'FINAL');
      assert.strictEqual(invFinal.invoice_number, res.data.invoice_number);
      assert.ok(invFinal.issued_at);
    });

    // SUBTEST 15: Repeated checkout on already CHECKED_OUT line fails with 409 Conflict (FR-065)
    await t.test('15. Repeated checkout on already CHECKED_OUT line fails with 409 Conflict (LINE_ALREADY_CHECKED_OUT)', async () => {
      // Repeat checkout on Line A
      const resA = await reqApi(`/api/bookings/${mainBookingId}/lines/${lineAId}/checkout`, {
        method: 'POST',
        headers: { 'x-user-id': uColomboFD },
      });

      assert.strictEqual(resA.status, 409);
      assert.strictEqual(resA.data.error.code, 'LINE_ALREADY_CHECKED_OUT');
      assert.match(resA.data.error.message, /already CHECKED_OUT/i);
      assert.ok(resA.data.error.details);
      assert.strictEqual(resA.data.error.details.line_id, lineAId);
      assert.strictEqual(resA.data.error.details.status, 'CHECKED_OUT');
      assert.strictEqual(resA.data.error.details.is_terminal, true);

      // Repeat checkout on Line B
      const resB = await reqApi(`/api/bookings/${mainBookingId}/lines/${lineBId}/checkout`, {
        method: 'POST',
        headers: { 'x-user-id': uColomboFD },
      });
      assert.strictEqual(resB.status, 409);
      assert.match(resB.data.error.code, /(LINE_ALREADY_CHECKED_OUT|INVOICE_ALREADY_FINAL)/);
    });

    // SUBTEST 16: Idempotent repeat request with ?idempotent=true returns 200 OK
    await t.test('16. Idempotent repeat request (?idempotent=true) returns 200 OK with existing receipt', async () => {
      const res = await reqApi(`/api/bookings/${mainBookingId}/lines/${lineAId}/checkout?idempotent=true`, {
        method: 'POST',
        headers: { 'x-user-id': uColomboFD },
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.repeated, true);
      assert.strictEqual(res.data.line_id, lineAId);
      assert.strictEqual(res.data.room_condition, 'CLEANING');
      assert.ok(res.data.receipt);
    });

    // SUBTEST 17: Booking reference resolution in URL
    await t.test('17. Booking reference in URL resolves cleanly and executes checkout', async () => {
      const rRef = await createCleanRoom(bColombo);
      const bRefBooking = await createBookingWithLines({
        ref: 'REF-HUMAN-URL-17',
        branchId: bColombo,
        lines: [{ roomId: rRef, checkIn: true }],
      });
      const bRefLineId = bRefBooking.lineIds[0];

      // Settle 11,550
      await reqApi(`/api/bookings/${bRefBooking.bookingId}/payments`, {
        method: 'POST',
        headers: { 'x-user-id': uColomboFD },
        body: { amount: 11550.00, method: 'CASH' },
      });

      // Call checkout using 'REF-HUMAN-URL-17' instead of UUID in URL
      const res = await reqApi(`/api/bookings/REF-HUMAN-URL-17/lines/${bRefLineId}/checkout`, {
        method: 'POST',
        headers: { 'x-user-id': uColomboFD },
        body: { reason: 'Reference URL checkout' },
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.booking_id, bRefBooking.bookingId);
      assert.strictEqual(res.data.line_id, bRefLineId);
      assert.strictEqual(res.data.is_finalized, true);
    });

    // SUBTEST 18: Read checkout status via GET endpoint
    await t.test('18. GET /bookings/:bookingId/lines/:lineId/checkout reads existing checkout receipt', async () => {
      const res = await reqApi(`/api/bookings/${mainBookingId}/lines/${lineAId}/checkout`, {
        method: 'GET',
        headers: { 'x-user-id': uColomboFD },
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.ok(res.data.receipt);
      assert.strictEqual(res.data.receipt.line_id, lineAId);
      assert.strictEqual(res.data.receipt.room_condition, 'CLEANING');
    });

  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await client.query(`DROP SCHEMA IF EXISTS ${scratchSchema} CASCADE`);
    await client.end();
  }
});
