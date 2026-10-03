const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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

test('M4-S09: One-line checkout transaction with zero-balance gate, assignment closure, room cleaning transition, and conditional finalization', async (t) => {
  const connectionString = loadDatabaseUrl();
  assert.ok(connectionString, 'Database connection string must be defined');

  const client = new Client({ connectionString });
  await client.connect();

  const scratchSchema = `test_m4_s09_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  try {
    await client.query(`CREATE SCHEMA ${scratchSchema}`);
    await client.query(`SET search_path TO ${scratchSchema}, public`);

    // Apply all migrations in order
    const migrationFiles = [
      '0000_create_audit_and_config.sql',
      'm1_001_create_branch_and_role.sql',
      'm1_002_create_user_account_and_officer.sql',
      'm1_003_create_guest_and_guest_account.sql',
      'm1_004_billing_policy_mock.sql',
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

    // 1. Seed Branch & Staff
    const bRes = await client.query(`
      INSERT INTO branch (name, city, address)
      VALUES ('Colombo Luxury Bay', 'Colombo', '100 Galle Face, Colombo')
      RETURNING branch_id;
    `);
    const branchId = bRes.rows[0].branch_id;

    const roleFrontDesk = (await client.query(`SELECT role_id FROM role WHERE role_name = 'FRONT_DESK'`)).rows[0].role_id;
    const uStaff = (await client.query(`INSERT INTO user_account (username, password_hash) VALUES ('staff_checkout', 'pw') RETURNING user_id`)).rows[0].user_id;
    await client.query(`INSERT INTO officer (officer_id, full_name, role_id, branch_id) VALUES ($1, 'Front Desk Officer', $2, $3)`, [uStaff, roleFrontDesk, branchId]);

    // 2. Seed Guest
    const uGuest = (await client.query(`INSERT INTO user_account (username, password_hash) VALUES ('guest_checkout', 'pw') RETURNING user_id`)).rows[0].user_id;
    const g = (await client.query(`INSERT INTO guest (full_name, email, phone, nic) VALUES ('Kamal Fernando', 'kamal@test.com', '0773333333', '198533333333') RETURNING guest_id`)).rows[0].guest_id;
    await client.query(`INSERT INTO guest_account (user_id, guest_id) VALUES ($1, $2)`, [uGuest, g]);

    // 3. Seed Policy & Rooms
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
    `, [uStaff]);

    const rtRes = await client.query(`
      INSERT INTO room_type (name, base_daily_rate, capacity)
      VALUES ('Deluxe Ocean View', 10000.00, 2)
      RETURNING room_type_id;
    `);
    const roomTypeId = rtRes.rows[0].room_type_id;

    let roomCounter = 100;
    async function createCleanRoom() {
      roomCounter++;
      const r = (await client.query(`
        INSERT INTO room (room_number, branch_id, room_type_id, operational_status)
        VALUES ($1, $2, $3, 'READY')
        RETURNING room_id;
      `, [String(roomCounter), branchId, roomTypeId])).rows[0].room_id;
      return r;
    }

    // Helper: Creates a booking with an assigned room line cleanly within an atomic transaction
    // to satisfy M2 deferred lifecycle and status history triggers.
    async function createBookingWithLine({ ref, roomId, checkIn = false }) {
      await client.query('BEGIN');
      const bRes = await client.query(`
        INSERT INTO booking (booking_ref, booking_channel, guest_id, created_by)
        VALUES ($1, 'FRONT_DESK', $2, $3)
        RETURNING booking_id;
      `, [ref, g, uStaff]);
      const bookingId = bRes.rows[0].booking_id;

      const lRes = await client.query(`
        INSERT INTO booking_room_line (booking_id, stay_start_date, stay_end_date, guest_count, rate_snapshot, status)
        VALUES ($1, CURRENT_DATE - 1, CURRENT_DATE, 1, 10000.00, 'BOOKED')
        RETURNING line_id;
      `, [bookingId]);
      const lineId = lRes.rows[0].line_id;

      await client.query(`
        INSERT INTO booking_room_line_status_history (line_id, old_status, new_status, changed_by, reason)
        VALUES ($1, NULL, 'BOOKED', $2, 'Initial reservation');
      `, [lineId, uStaff]);

      await client.query(`
        INSERT INTO booking_room_assignment (line_id, room_id)
        VALUES ($1, $2);
      `, [lineId, roomId]);

      if (checkIn) {
        await client.query(`
          UPDATE booking_room_assignment
             SET occupied_from = $2
           WHERE line_id = $1 AND unassigned_at IS NULL;
        `, [lineId, new Date(Date.now() - 3600000).toISOString()]);

        await client.query(`
          UPDATE booking_room_line
             SET status = 'CHECKED_IN'
           WHERE line_id = $1;
        `, [lineId]);

        await client.query(`
          INSERT INTO booking_room_line_status_history (line_id, old_status, new_status, changed_by, reason)
          VALUES ($1, 'BOOKED', 'CHECKED_IN', $2, 'Check-in');
        `, [lineId, uStaff]);
      }

      await client.query('COMMIT');

      // Create draft invoice linked to effective policy
      await client.query(`SELECT fn_create_booking_draft_invoice($1, $2)`, [bookingId, uStaff]);

      return { bookingId, lineId };
    }

    // SCENARIO 1: Positive balance blocks checkout (FR-059, BR-008)
    let s1BookingId;
    let s1LineId;
    let s1RoomId;
    await t.test('Scenario 1: Positive balance due blocks checkout (23514)', async () => {
      s1RoomId = await createCleanRoom();
      const b = await createBookingWithLine({
        ref: 'REF-UNPAID-01',
        roomId: s1RoomId,
        checkIn: true,
      });
      s1BookingId = b.bookingId;
      s1LineId = b.lineId;

      // 10,000 + 5% SC (500) + 10% Tax on 10,500 (1,050) = 11,550.00 LKR
      // Balance is 11,550.00 > 0.
      await assert.rejects(
        async () => {
          await client.query(`SELECT * FROM fn_checkout_room_line($1, $2, $3)`, [s1BookingId, s1LineId, uStaff]);
        },
        (err) => {
          assert.strictEqual(err.code, '23514');
          assert.match(err.message, /outstanding balance of LKR 11550\.00 that must be settled first/i);
          return true;
        },
      );

      // Verify line status remains CHECKED_IN and room remains READY
      const lineRes = await client.query(`SELECT status FROM booking_room_line WHERE line_id = $1`, [s1LineId]);
      assert.strictEqual(lineRes.rows[0].status, 'CHECKED_IN');

      const roomRes = await client.query(`SELECT operational_status FROM room WHERE room_id = $1`, [s1RoomId]);
      assert.strictEqual(roomRes.rows[0].operational_status, 'READY');

      const assignRes = await client.query(`SELECT unassigned_at, occupied_to FROM booking_room_assignment WHERE line_id = $1`, [s1LineId]);
      assert.strictEqual(assignRes.rows[0].unassigned_at, null);
      assert.strictEqual(assignRes.rows[0].occupied_to, null);
    });

    // SCENARIO 2: Negative unrefunded credit blocks checkout (FR-059, BR-008)
    await t.test('Scenario 2: Negative unrefunded credit blocks checkout (23514)', async () => {
      const roomId = await createCleanRoom();
      const { bookingId, lineId } = await createBookingWithLine({
        ref: 'REF-CREDIT-02',
        roomId,
        checkIn: true,
      });

      // Pay 11,550.00
      await client.query(`
        INSERT INTO payment (booking_id, recorded_by, kind, amount, method, status, reference)
        VALUES ($1, $2, 'PAYMENT', 11550.00, 'CASH', 'SUCCESSFUL', 'PAY-EXACT-02');
      `, [bookingId, uStaff]);

      // Add -2,000 price adjustment to create credit of -2,000.00
      const invId = (await client.query(`SELECT invoice_id FROM invoice WHERE booking_id = $1`, [bookingId])).rows[0].invoice_id;
      await client.query(`
        INSERT INTO invoice_line (invoice_id, line_type, description, amount)
        VALUES ($1, 'PRICE_ADJUSTMENT', 'Special courtesy rebate', -2000.00);
      `, [invId]);

      // Checkout blocked on credit
      await assert.rejects(
        async () => {
          await client.query(`SELECT * FROM fn_checkout_room_line($1, $2, $3)`, [bookingId, lineId, uStaff]);
        },
        (err) => {
          assert.strictEqual(err.code, '23514');
          assert.match(err.message, /unrefunded credit balance of LKR 2000\.00 that must be refunded first/i);
          return true;
        },
      );

      // Refund the 2,000 credit
      await client.query(`
        INSERT INTO payment (booking_id, recorded_by, kind, amount, method, status, reference)
        VALUES ($1, $2, 'REFUND', 2000.00, 'CASH', 'SUCCESSFUL', 'REF-CLEAR-CREDIT-02');
      `, [bookingId, uStaff]);

      // Balance is now 0.00 -> checkout succeeds!
      const coRes = await client.query(`SELECT * FROM fn_checkout_room_line($1, $2, $3)`, [bookingId, lineId, uStaff]);
      assert.strictEqual(coRes.rows[0].is_finalized, true);
      assert.strictEqual(coRes.rows[0].room_condition, 'CLEANING');
    });

    // SCENARIO 3 & 4: Multi-room booking: partial checkout keeps invoice DRAFT, subsequent checkout finalizes invoice
    let s3BookingId;
    let s3LineAId;
    let s3LineBId;
    let s3RoomAId;
    let s3RoomBId;
    await t.test('Scenario 3 & 4: Partial checkout keeps invoice DRAFT, subsequent checkout finalizes invoice', async () => {
      s3RoomAId = await createCleanRoom();
      s3RoomBId = await createCleanRoom();

      // Create 2-room booking in atomic block
      await client.query('BEGIN');
      const bRes = await client.query(`
        INSERT INTO booking (booking_ref, booking_channel, guest_id, created_by)
        VALUES ('REF-TWO-ROOM-03', 'FRONT_DESK', $1, $2)
        RETURNING booking_id;
      `, [g, uStaff]);
      s3BookingId = bRes.rows[0].booking_id;

      // Line A (starts as BOOKED)
      s3LineAId = (await client.query(`
        INSERT INTO booking_room_line (booking_id, stay_start_date, stay_end_date, guest_count, rate_snapshot, status)
        VALUES ($1, CURRENT_DATE - 1, CURRENT_DATE, 1, 10000.00, 'BOOKED')
        RETURNING line_id;
      `, [s3BookingId])).rows[0].line_id;

      // Line B (starts as BOOKED)
      s3LineBId = (await client.query(`
        INSERT INTO booking_room_line (booking_id, stay_start_date, stay_end_date, guest_count, rate_snapshot, status)
        VALUES ($1, CURRENT_DATE - 1, CURRENT_DATE, 1, 10000.00, 'BOOKED')
        RETURNING line_id;
      `, [s3BookingId])).rows[0].line_id;

      // Initial status histories for both lines (NULL -> BOOKED)
      await client.query(`INSERT INTO booking_room_line_status_history (line_id, old_status, new_status, changed_by, reason) VALUES ($1, NULL, 'BOOKED', $2, 'Initial')`, [s3LineAId, uStaff]);
      await client.query(`INSERT INTO booking_room_line_status_history (line_id, old_status, new_status, changed_by, reason) VALUES ($1, NULL, 'BOOKED', $2, 'Initial')`, [s3LineBId, uStaff]);

      // Open assignments
      await client.query(`
        INSERT INTO booking_room_assignment (line_id, room_id)
        VALUES ($1, $2);
      `, [s3LineAId, s3RoomAId]);

      await client.query(`
        INSERT INTO booking_room_assignment (line_id, room_id)
        VALUES ($1, $2);
      `, [s3LineBId, s3RoomBId]);

      // Transition both assignments to occupied
      await client.query(`
        UPDATE booking_room_assignment
           SET occupied_from = CURRENT_TIMESTAMP - interval '2 hours'
         WHERE line_id IN ($1, $2) AND unassigned_at IS NULL;
      `, [s3LineAId, s3LineBId]);

      // Transition both lines to CHECKED_IN
      await client.query(`
        UPDATE booking_room_line
           SET status = 'CHECKED_IN'
         WHERE line_id IN ($1, $2);
      `, [s3LineAId, s3LineBId]);

      // Check-in status histories for both lines (BOOKED -> CHECKED_IN)
      await client.query(`INSERT INTO booking_room_line_status_history (line_id, old_status, new_status, changed_by, reason) VALUES ($1, 'BOOKED', 'CHECKED_IN', $2, 'Check-in')`, [s3LineAId, uStaff]);
      await client.query(`INSERT INTO booking_room_line_status_history (line_id, old_status, new_status, changed_by, reason) VALUES ($1, 'BOOKED', 'CHECKED_IN', $2, 'Check-in')`, [s3LineBId, uStaff]);

      await client.query('COMMIT');

      // Create draft invoice
      await client.query(`SELECT fn_create_booking_draft_invoice($1, $2)`, [s3BookingId, uStaff]);

      // Two rooms = 20,000 Gross + 5% SC (1,000) + 10% Tax on 21,000 (2,100) = 23,100.00 LKR
      await client.query(`
        INSERT INTO payment (booking_id, recorded_by, kind, amount, method, status, reference)
        VALUES ($1, $2, 'PAYMENT', 23100.00, 'BANK_TRANSFER', 'SUCCESSFUL', 'PAY-TWO-ROOM-03');
      `, [s3BookingId, uStaff]);

      // PARTIAL CHECKOUT: Check out Line A
      const coARes = await client.query(`
        SELECT * FROM fn_checkout_room_line($1, $2, $3, 'Guest A departed early morning')
      `, [s3BookingId, s3LineAId, uStaff]);

      const coA = coARes.rows[0];
      assert.strictEqual(coA.line_id, s3LineAId);
      assert.strictEqual(coA.room_condition, 'CLEANING');
      assert.strictEqual(Number(coA.remaining_active_lines), 1, '1 active line (Line B) must remain');
      assert.strictEqual(coA.is_finalized, false, 'Invoice must not be finalized during partial checkout');
      assert.strictEqual(coA.invoice_number, null, 'Invoice number must remain unassigned while DRAFT');
      assert.match(coA.provisional_statement_ref, /^PROV-\d{8}-/);

      // Verify Line A status is CHECKED_OUT and assignment is closed
      const laLine = (await client.query(`SELECT status FROM booking_room_line WHERE line_id = $1`, [s3LineAId])).rows[0];
      assert.strictEqual(laLine.status, 'CHECKED_OUT');

      const laAssign = (await client.query(`SELECT unassigned_at, occupied_to FROM booking_room_assignment WHERE line_id = $1`, [s3LineAId])).rows[0];
      assert.ok(laAssign.unassigned_at, 'Assignment unassigned_at must be populated');
      assert.ok(laAssign.occupied_to, 'Assignment occupied_to must be populated');

      // Verify Room A condition is CLEANING and room_status_history exists
      const rAStatus = (await client.query(`SELECT operational_status FROM room WHERE room_id = $1`, [s3RoomAId])).rows[0];
      assert.strictEqual(rAStatus.operational_status, 'CLEANING');

      const rAHist = await client.query(`
        SELECT old_status, new_status, reason FROM room_status_history
         WHERE room_id = $1 ORDER BY changed_at DESC LIMIT 1
      `, [s3RoomAId]);
      assert.strictEqual(rAHist.rows[0].old_status, 'READY');
      assert.strictEqual(rAHist.rows[0].new_status, 'CLEANING');

      // Verify Line B is UNTOUCHED
      const lbLine = (await client.query(`SELECT status FROM booking_room_line WHERE line_id = $1`, [s3LineBId])).rows[0];
      assert.strictEqual(lbLine.status, 'CHECKED_IN');

      const rBStatus = (await client.query(`SELECT operational_status FROM room WHERE room_id = $1`, [s3RoomBId])).rows[0];
      assert.strictEqual(rBStatus.operational_status, 'READY');

      // Verify Invoice is still DRAFT
      const invRes = (await client.query(`SELECT status, invoice_number FROM invoice WHERE booking_id = $1`, [s3BookingId])).rows[0];
      assert.strictEqual(invRes.status, 'DRAFT');
      assert.strictEqual(invRes.invoice_number, null);

      // FINAL CHECKOUT: Check out Line B (the last remaining line)
      const coBRes = await client.query(`
        SELECT * FROM fn_checkout_room_line($1, $2, $3, 'Guest B departed afternoon')
      `, [s3BookingId, s3LineBId, uStaff]);

      const coB = coBRes.rows[0];
      assert.strictEqual(coB.line_id, s3LineBId);
      assert.strictEqual(coB.room_condition, 'CLEANING');
      assert.strictEqual(Number(coB.remaining_active_lines), 0, 'No active lines should remain');
      assert.strictEqual(coB.is_finalized, true, 'Invoice must be finalized when all lines are terminal');
      assert.match(coB.invoice_number, /^INV-\d{8}-\d{5}$/, 'Final invoice number must be assigned');
      assert.ok(coB.issued_at, 'issued_at must be populated');

      // Verify Invoice in database is FINAL
      const invFinalRes = (await client.query(`SELECT status, invoice_number, issued_at FROM invoice WHERE booking_id = $1`, [s3BookingId])).rows[0];
      assert.strictEqual(invFinalRes.status, 'FINAL');
      assert.strictEqual(invFinalRes.invoice_number, coB.invoice_number);

      // Verify Room B condition is CLEANING
      const rBFinalStatus = (await client.query(`SELECT operational_status FROM room WHERE room_id = $1`, [s3RoomBId])).rows[0];
      assert.strictEqual(rBFinalStatus.operational_status, 'CLEANING');
    });

    // SCENARIO 5: Transaction rollback on failure preserves prior state (DBR-018, Table 43 Atomicity)
    await t.test('Scenario 5: Injected transaction failure rolls back all checkout changes', async () => {
      const roomId = await createCleanRoom();
      const { bookingId, lineId } = await createBookingWithLine({
        ref: 'REF-ROLLBACK-05',
        roomId,
        checkIn: true,
      });

      // Settle 11,550
      await client.query(`
        INSERT INTO payment (booking_id, recorded_by, kind, amount, method, status, reference)
        VALUES ($1, $2, 'PAYMENT', 11550.00, 'CASH', 'SUCCESSFUL', 'PAY-RB-SETTLE-05');
      `, [bookingId, uStaff]);

      // Run checkout inside transaction and abort
      await client.query('BEGIN');
      await client.query(`SELECT * FROM fn_checkout_room_line($1, $2, $3)`, [bookingId, lineId, uStaff]);
      await client.query('ROLLBACK');

      // Verify that after rollback, line is still CHECKED_IN and room is still READY
      const linePostRb = (await client.query(`SELECT status FROM booking_room_line WHERE line_id = $1`, [lineId])).rows[0];
      assert.strictEqual(linePostRb.status, 'CHECKED_IN');

      const roomPostRb = (await client.query(`SELECT operational_status FROM room WHERE room_id = $1`, [roomId])).rows[0];
      assert.strictEqual(roomPostRb.operational_status, 'READY');

      const assignPostRb = (await client.query(`SELECT unassigned_at, occupied_to FROM booking_room_assignment WHERE line_id = $1`, [lineId])).rows[0];
      assert.strictEqual(assignPostRb.unassigned_at, null);
      assert.strictEqual(assignPostRb.occupied_to, null);
    });

    // SCENARIO 6: Repeated checkout on already CHECKED_OUT line fails (FR-065)
    await t.test('Scenario 6: Repeated checkout on already CHECKED_OUT line fails (23514)', async () => {
      // s3LineAId from Scenario 3 is already CHECKED_OUT
      await assert.rejects(
        async () => {
          await client.query(`SELECT * FROM fn_checkout_room_line($1, $2, $3)`, [s3BookingId, s3LineAId, uStaff]);
        },
        (err) => {
          assert.strictEqual(err.code, '23514');
          assert.match(err.message, /already CHECKED_OUT/i);
          return true;
        },
      );
    });

    // SCENARIO 7: Checkout on BOOKED line fails
    await t.test('Scenario 7: Checkout on BOOKED line fails (23514)', async () => {
      const roomId = await createCleanRoom();
      const { bookingId, lineId } = await createBookingWithLine({
        ref: 'REF-BOOKED-07',
        roomId,
        checkIn: false, // status: BOOKED
      });

      await assert.rejects(
        async () => {
          await client.query(`SELECT * FROM fn_checkout_room_line($1, $2, $3)`, [bookingId, lineId, uStaff]);
        },
        (err) => {
          assert.strictEqual(err.code, '23514');
          assert.match(err.message, /must be CHECKED_IN/i);
          return true;
        },
      );
    });

    // SCENARIO 8: Cross-booking line mismatch fails
    await t.test('Scenario 8: Cross-booking line mismatch fails (23514)', async () => {
      const roomId = await createCleanRoom();
      const bOther = await createBookingWithLine({
        ref: 'REF-OTHER-08',
        roomId,
        checkIn: true,
      });

      // Pass s1BookingId with bOther.lineId
      await assert.rejects(
        async () => {
          await client.query(`SELECT * FROM fn_checkout_room_line($1, $2, $3)`, [s1BookingId, bOther.lineId, uStaff]);
        },
        (err) => {
          assert.strictEqual(err.code, '23514');
          assert.match(err.message, /does not belong to booking/i);
          return true;
        },
      );
    });

    // SCENARIO 9: Stored procedure sp_checkout_booking works per Table 45
    await t.test('Scenario 9: Stored procedure sp_checkout_booking executes cleanly', async () => {
      const roomId = await createCleanRoom();
      const { bookingId, lineId } = await createBookingWithLine({
        ref: 'REF-PROC-09',
        roomId,
        checkIn: true,
      });

      // Settle 11,550
      await client.query(`
        INSERT INTO payment (booking_id, recorded_by, kind, amount, method, status, reference)
        VALUES ($1, $2, 'PAYMENT', 11550.00, 'CASH', 'SUCCESSFUL', 'PAY-PROC-SETTLE-09');
      `, [bookingId, uStaff]);

      // Call procedure
      await client.query(`CALL sp_checkout_booking($1, $2, $3, 'Procedure checkout test')`, [bookingId, lineId, uStaff]);

      // Verify line is CHECKED_OUT and invoice is FINAL
      const lineRes = (await client.query(`SELECT status FROM booking_room_line WHERE line_id = $1`, [lineId])).rows[0];
      assert.strictEqual(lineRes.status, 'CHECKED_OUT');

      const invRes = (await client.query(`SELECT status, invoice_number FROM invoice WHERE booking_id = $1`, [bookingId])).rows[0];
      assert.strictEqual(invRes.status, 'FINAL');
      assert.match(invRes.invoice_number, /^INV-\d{8}-\d{5}$/);
    });

    // SCENARIO 10: TypeScript service checkoutRoomLine execution
    await t.test('Scenario 10: TypeScript checkoutRoomLine service returns formatted receipt', async () => {
      const { checkoutRoomLine } = await import('../src/services/checkoutService');

      const roomId = await createCleanRoom();
      const { bookingId, lineId } = await createBookingWithLine({
        ref: 'REF-TS-SERVICE-10',
        roomId,
        checkIn: true,
      });

      // Settle 11,550
      await client.query(`
        INSERT INTO payment (booking_id, recorded_by, kind, amount, method, status, reference)
        VALUES ($1, $2, 'PAYMENT', 11550.00, 'CASH', 'SUCCESSFUL', 'PAY-TS-SETTLE-10');
      `, [bookingId, uStaff]);

      const testDb = {
        query: (sql, values) => client.query(sql, values),
      };

      const result = await checkoutRoomLine(testDb, {
        bookingId,
        lineId,
        actorId: uStaff,
        reason: 'Service checkout call',
      });

      assert.strictEqual(result.booking_id, bookingId);
      assert.strictEqual(result.line_id, lineId);
      assert.strictEqual(result.room_condition, 'CLEANING');
      assert.strictEqual(result.is_finalized, true);
      assert.strictEqual(result.remaining_active_lines, 0);
      assert.ok(result.receipt, 'Receipt must be generated');
      assert.strictEqual(result.receipt.statement_reference, result.invoice_number);
      assert.strictEqual(result.receipt.room_condition, 'CLEANING');
    });

  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${scratchSchema} CASCADE`);
    await client.end();
  }
});
