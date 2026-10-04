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

test('M4-S07: Locked payment and refund posting with balance reconciliation', async (t) => {
  const connectionString = loadDatabaseUrl();
  assert.ok(connectionString, 'Database connection string must be defined');

  const client = new Client({ connectionString });
  await client.connect();

  const scratchSchema = `test_m4_s07_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  try {
    await client.query(`CREATE SCHEMA ${scratchSchema}`);
    await client.query(`SET search_path TO ${scratchSchema}, public`);

    // Apply migrations in order
    const migrationFiles = [
      '0000_create_audit_and_config.sql',
      'm1_001_create_branch_and_role.sql',
      'm1_002_create_user_account_and_officer.sql',
      'm1_003_create_guest_and_guest_account.sql',
      'm1_004_billing_policy_mock.sql',
      'm2_001_room_catalogue.sql',
      'm2_002_booking.sql',
      'm3_001_service_usage_mock.sql',
      'm4_001_invoice_and_lines.sql',
      'm4_002_payment.sql',
      'm4_003_billing_calculation.sql',
      'm4_004_invoice_lifecycle.sql',
      'm4_005_invoice_query_indexes.sql',
      'm4_006_payment_posting.sql',
    ];

    for (const file of migrationFiles) {
      const filePath = path.resolve(__dirname, '../migrations', file);
      if (fs.existsSync(filePath)) {
        const sql = fs.readFileSync(filePath, 'utf8');
        await client.query(sql);
      }
    }

    // Seed shared test data
    const branchRes = await client.query(`
      INSERT INTO branch (name, city, address)
      VALUES ('Colombo Grand', 'Colombo', '123 Galle Face, Colombo')
      RETURNING branch_id;
    `);
    const branchId = branchRes.rows[0].branch_id;

    const roleRes = await client.query(`SELECT role_id FROM role WHERE role_name = 'FRONT_DESK' LIMIT 1;`);
    const frontDeskRoleId = roleRes.rows[0].role_id;

    const userRes = await client.query(`
      INSERT INTO user_account (username, password_hash)
      VALUES ('frontdesk_m4s07', 'hashed_pwd_123')
      RETURNING user_id;
    `);
    const frontDeskUserId = userRes.rows[0].user_id;

    await client.query(`
      INSERT INTO officer (officer_id, full_name, role_id, branch_id)
      VALUES ($1, 'Front Desk Officer Chamikara', $2, $3);
    `, [frontDeskUserId, frontDeskRoleId, branchId]);

    const guestRes = await client.query(`
      INSERT INTO guest (full_name, email, phone)
      VALUES ('Alice Perera', 'alice.m4s07@example.com', '+94770000001')
      RETURNING guest_id;
    `);
    const guestId = guestRes.rows[0].guest_id;

    const roomTypeRes = await client.query(`
      INSERT INTO room_type (name, base_daily_rate, capacity)
      VALUES ('Deluxe Ocean View', 6000.00, 2)
      RETURNING room_type_id;
    `);
    const roomTypeId = roomTypeRes.rows[0].room_type_id;

    // Seed Billing Policy
    await client.query(`
      INSERT INTO billing_policy (
        effective_from, tax_percent, service_charge_percent, max_discount_percent,
        cancellation_fee, no_show_fee, late_checkout_fee, no_show_grace_days,
        is_demo, created_by
      ) VALUES (
        CURRENT_DATE - 1, 0.00, 0.00, 20.00,
        1500.00, 3000.00, 2500.00, 1,
        false, $1
      );
    `, [frontDeskUserId]);

    // Helper to create a test booking with room lines and DRAFT invoice
    async function createTestBooking(stayNights = 2, roomCount = 1, bookingRef = null) {
      const ref = bookingRef || `BK-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
      const bRes = await client.query(`
        INSERT INTO booking (guest_id, created_by, booking_ref, booking_channel)
        VALUES ($1, $2, $3, 'FRONT_DESK')
        RETURNING booking_id;
      `, [guestId, frontDeskUserId, ref]);
      const bookingId = bRes.rows[0].booking_id;

      for (let i = 0; i < roomCount; i++) {
        await client.query(`
          INSERT INTO booking_room_line (
            booking_id, rate_snapshot, stay_start_date, stay_end_date, guest_count, status
          ) VALUES (
            $1, 6000.00, CURRENT_DATE, CURRENT_DATE + $2::integer, 2, 'BOOKED'
          );
        `, [bookingId, stayNights]);
      }

      // Initialize DRAFT invoice
      const invIdRes = await client.query(`
        SELECT fn_create_booking_draft_invoice($1, $2) AS invoice_id;
      `, [bookingId, frontDeskUserId]);

      const invoiceId = invIdRes.rows[0].invoice_id;
      return { bookingId, invoiceId };
    }

    // --- Scenario 1: Three partial payments reconcile to exact zero ---
    await t.test('Scenario 1: Three partial payments reconcile to exact zero', async () => {
      // 2 nights * 1 room * 6000.00 = 12000.00 total
      const { bookingId } = await createTestBooking(2, 1, 'BK-S07-PARTIAL');

      // Initial balance check
      const bal0 = await client.query(`SELECT * FROM fn_booking_balance($1)`, [bookingId]);
      assert.equal(Number(bal0.rows[0].total_amount), 12000.00);
      assert.equal(Number(bal0.rows[0].balance), 12000.00);
      assert.equal(bal0.rows[0].is_settled, false);

      // Helper to test fn_outstanding_balance
      const fnBal0 = await client.query(`SELECT fn_outstanding_balance($1) AS bal`, [bookingId]);
      assert.equal(Number(fnBal0.rows[0].bal), 12000.00);

      // Payment 1: 4000.00 CASH
      const pay1 = await client.query(`
        SELECT * FROM fn_record_payment(
          $1, $2, 'PAYMENT', 4000.00, 'CASH', 'REF-PART-1'
        );
      `, [bookingId, frontDeskUserId]);
      assert.equal(Number(pay1.rows[0].amount), 4000.00);
      assert.equal(Number(pay1.rows[0].previous_balance), 12000.00);
      assert.equal(Number(pay1.rows[0].new_balance), 8000.00);
      assert.equal(pay1.rows[0].is_credit, false);

      // Payment 2: 5000.00 BANK_TRANSFER
      const pay2 = await client.query(`
        SELECT * FROM fn_record_payment(
          $1, $2, 'PAYMENT', 5000.00, 'BANK_TRANSFER', 'REF-PART-2'
        );
      `, [bookingId, frontDeskUserId]);
      assert.equal(Number(pay2.rows[0].amount), 5000.00);
      assert.equal(Number(pay2.rows[0].previous_balance), 8000.00);
      assert.equal(Number(pay2.rows[0].new_balance), 3000.00);
      assert.equal(pay2.rows[0].is_credit, false);

      // Payment 3: 3000.00 CASH
      const pay3 = await client.query(`
        SELECT * FROM fn_record_payment(
          $1, $2, 'PAYMENT', 3000.00, 'CASH', 'REF-PART-3'
        );
      `, [bookingId, frontDeskUserId]);
      assert.equal(Number(pay3.rows[0].amount), 3000.00);
      assert.equal(Number(pay3.rows[0].previous_balance), 3000.00);
      assert.equal(Number(pay3.rows[0].new_balance), 0.00);
      assert.equal(pay3.rows[0].is_credit, false);

      // Final balance check: settled!
      const balFinal = await client.query(`SELECT * FROM fn_booking_balance($1)`, [bookingId]);
      assert.equal(Number(balFinal.rows[0].successful_payments), 12000.00);
      assert.equal(Number(balFinal.rows[0].successful_refunds), 0.00);
      assert.equal(Number(balFinal.rows[0].net_paid), 12000.00);
      assert.equal(Number(balFinal.rows[0].balance), 0.00);
      assert.equal(balFinal.rows[0].is_settled, true);

      // Attempting an additional payment when balance is 0 must fail
      await assert.rejects(
        async () => {
          await client.query(`
            SELECT * FROM fn_record_payment($1, $2, 'PAYMENT', 100.00, 'CASH', 'REF-EXTRA');
          `, [bookingId, frontDeskUserId]);
        },
        /has no positive balance due/
      );
    });

    // --- Scenario 2: Overpayment above positive balance is rejected ---
    await t.test('Scenario 2: Overpayment above positive balance is rejected', async () => {
      // 1 night * 1 room * 6000 = 6000.00 total
      const { bookingId } = await createTestBooking(1, 1, 'BK-S07-OVERPAY');

      // Attempt payment of 6001.00 (exceeds balance 6000.00)
      await assert.rejects(
        async () => {
          await client.query(`
            SELECT * FROM fn_record_payment($1, $2, 'PAYMENT', 6001.00, 'CASH', 'REF-OVER-1');
          `, [bookingId, frontDeskUserId]);
        },
        /exceeds current outstanding balance/
      );

      // Partial payment of 4000.00 leaves 2000.00 balance
      await client.query(`
        SELECT * FROM fn_record_payment($1, $2, 'PAYMENT', 4000.00, 'CASH', 'REF-PART-4K');
      `, [bookingId, frontDeskUserId]);

      // Attempt payment of 2001.00 (exceeds remaining balance 2000.00)
      await assert.rejects(
        async () => {
          await client.query(`
            SELECT * FROM fn_record_payment($1, $2, 'PAYMENT', 2001.00, 'CASH', 'REF-OVER-2');
          `, [bookingId, frontDeskUserId]);
        },
        /exceeds current outstanding balance/
      );

      // Exact payment of 2000.00 succeeds
      const resOk = await client.query(`
        SELECT * FROM fn_record_payment($1, $2, 'PAYMENT', 2000.00, 'CASH', 'REF-EXACT-2K');
      `, [bookingId, frontDeskUserId]);
      assert.equal(Number(resOk.rows[0].new_balance), 0.00);
    });

    // --- Scenario 3: Charge reduction creating credit and staff manual refund ---
    await t.test('Scenario 3: Charge reduction creating credit and staff manual refund', async () => {
      // 2 nights * 1 room = 12000.00
      const { bookingId, invoiceId } = await createTestBooking(2, 1, 'BK-S07-CREDIT');

      // Guest pays in full (12000.00)
      await client.query(`
        SELECT * FROM fn_record_payment($1, $2, 'PAYMENT', 12000.00, 'BANK_TRANSFER', 'REF-FULL-12K');
      `, [bookingId, frontDeskUserId]);

      // Verify balance is 0
      const bal0 = await client.query(`SELECT fn_outstanding_balance($1) AS bal`, [bookingId]);
      assert.equal(Number(bal0.rows[0].bal), 0.00);

      // Charge reduction: add approved negative PRICE_ADJUSTMENT line of -3000.00
      await client.query(`
        INSERT INTO invoice_line (invoice_id, line_type, description, amount)
        VALUES ($1, 'PRICE_ADJUSTMENT', 'Special Manager Credit Adjustment', -3000.00);
      `, [invoiceId]);

      // New invoice total: 12000 - 3000 = 9000.00
      // Net paid: 12000.00
      // Balance: 9000 - 12000 = -3000.00 (credit of 3000.00!)
      const balCredit = await client.query(`SELECT * FROM fn_booking_balance($1)`, [bookingId]);
      assert.equal(Number(balCredit.rows[0].total_amount), 9000.00);
      assert.equal(Number(balCredit.rows[0].net_paid), 12000.00);
      assert.equal(Number(balCredit.rows[0].balance), -3000.00);
      assert.equal(balCredit.rows[0].is_settled, false);

      // Attempt to post payment against credit -> fails!
      await assert.rejects(
        async () => {
          await client.query(`
            SELECT * FROM fn_record_payment($1, $2, 'PAYMENT', 500.00, 'CASH', 'REF-PAY-CREDIT');
          `, [bookingId, frontDeskUserId]);
        },
        /has no positive balance due/
      );

      // Attempt to refund more than available credit (3001.00 > 3000.00) -> fails!
      await assert.rejects(
        async () => {
          await client.query(`
            SELECT * FROM fn_record_payment($1, $2, 'REFUND', 3001.00, 'CASH', 'REF-OVER-REF');
          `, [bookingId, frontDeskUserId]);
        },
        /exceeds available credit/
      );

      // Post partial manual refund of 1000.00
      const refPart = await client.query(`
        SELECT * FROM fn_record_payment($1, $2, 'REFUND', 1000.00, 'CASH', 'REFUND-PART-1K');
      `, [bookingId, frontDeskUserId]);
      assert.equal(Number(refPart.rows[0].amount), 1000.00);
      assert.equal(Number(refPart.rows[0].previous_balance), -3000.00);
      assert.equal(Number(refPart.rows[0].new_balance), -2000.00);
      assert.equal(refPart.rows[0].is_credit, true);
      assert.equal(Number(refPart.rows[0].credit_amount), 2000.00);

      // Post remaining manual refund of 2000.00
      const refFinal = await client.query(`
        SELECT * FROM fn_record_payment($1, $2, 'REFUND', 2000.00, 'BANK_TRANSFER', 'REFUND-FINAL-2K');
      `, [bookingId, frontDeskUserId]);
      assert.equal(Number(refFinal.rows[0].amount), 2000.00);
      assert.equal(Number(refFinal.rows[0].previous_balance), -2000.00);
      assert.equal(Number(refFinal.rows[0].new_balance), 0.00);
      assert.equal(refFinal.rows[0].is_credit, false);
      assert.equal(Number(refFinal.rows[0].credit_amount), 0.00);

      // Verify final settled state
      const balSettled = await client.query(`SELECT * FROM fn_booking_balance($1)`, [bookingId]);
      assert.equal(Number(balSettled.rows[0].total_amount), 9000.00);
      assert.equal(Number(balSettled.rows[0].successful_payments), 12000.00);
      assert.equal(Number(balSettled.rows[0].successful_refunds), 3000.00);
      assert.equal(Number(balSettled.rows[0].net_paid), 9000.00);
      assert.equal(Number(balSettled.rows[0].balance), 0.00);
      assert.equal(balSettled.rows[0].is_settled, true);
    });

    // --- Scenario 4: Reject refund when booking has positive balance (no credit) ---
    await t.test('Scenario 4: Reject refund when booking has positive balance', async () => {
      const { bookingId } = await createTestBooking(1, 1, 'BK-S07-NO-CRED');

      // Balance is positive (6000.00 due)
      await assert.rejects(
        async () => {
          await client.query(`
            SELECT * FROM fn_record_payment($1, $2, 'REFUND', 500.00, 'CASH', 'REF-NO-CRED');
          `, [bookingId, frontDeskUserId]);
        },
        /has no credit balance to refund/
      );
    });

    // --- Scenario 5: Failed records do not alter balance ---
    await t.test('Scenario 5: Failed records do not alter balance', async () => {
      const { bookingId } = await createTestBooking(1, 1, 'BK-S07-FAILED');

      // Record a FAILED payment attempt
      const failedPay = await client.query(`
        SELECT * FROM fn_record_payment(
          $1, $2, 'PAYMENT', 6000.00, 'BANK_TRANSFER', 'REF-FAIL-1', 'FAILED'
        );
      `, [bookingId, frontDeskUserId]);
      assert.equal(failedPay.rows[0].status, 'FAILED');
      assert.equal(Number(failedPay.rows[0].new_balance), 6000.00);

      // Verify balance is unchanged at 6000.00
      const balCheck = await client.query(`SELECT fn_outstanding_balance($1) AS bal`, [bookingId]);
      assert.equal(Number(balCheck.rows[0].bal), 6000.00);

      // Now record a SUCCESSFUL payment
      const okPay = await client.query(`
        SELECT * FROM fn_record_payment(
          $1, $2, 'PAYMENT', 6000.00, 'CASH', 'REF-OK-AFTER-FAIL'
        );
      `, [bookingId, frontDeskUserId]);
      assert.equal(okPay.rows[0].status, 'SUCCESSFUL');
      assert.equal(Number(okPay.rows[0].new_balance), 0.00);
    });

    // --- Scenario 6: Reversals exclude payment and reopen balance ---
    await t.test('Scenario 6: Reversals exclude payment and reopen balance', async () => {
      const { bookingId } = await createTestBooking(1, 1, 'BK-S07-REVERSE');

      // Pay 6000.00 in full
      const payRes = await client.query(`
        SELECT * FROM fn_record_payment($1, $2, 'PAYMENT', 6000.00, 'CASH', 'REF-REV-TARGET');
      `, [bookingId, frontDeskUserId]);
      const paymentId = payRes.rows[0].payment_id;

      // Balance is 0
      assert.equal(Number(payRes.rows[0].new_balance), 0.00);

      // Reverse the payment
      const revRes = await client.query(`
        SELECT * FROM fn_reverse_payment($1, $2);
      `, [paymentId, frontDeskUserId]);
      assert.equal(revRes.rows[0].status, 'REVERSED');
      assert.equal(Number(revRes.rows[0].previous_balance), 0.00);
      assert.equal(Number(revRes.rows[0].new_balance), 6000.00);

      // Verify balance is back to 6000.00
      const balCheck = await client.query(`SELECT fn_outstanding_balance($1) AS bal`, [bookingId]);
      assert.equal(Number(balCheck.rows[0].bal), 6000.00);

      // Cannot reverse an already reversed payment
      await assert.rejects(
        async () => {
          await client.query(`SELECT * FROM fn_reverse_payment($1, $2)`, [paymentId, frontDeskUserId]);
        },
        /Only SUCCESSFUL payments can be reversed/
      );
    });

    // --- Scenario 7: Duplicate references are rejected ---
    await t.test('Scenario 7: Duplicate references are rejected', async () => {
      const { bookingId } = await createTestBooking(2, 1, 'BK-S07-DUP');

      await client.query(`
        SELECT * FROM fn_record_payment($1, $2, 'PAYMENT', 1000.00, 'CASH', 'UNIQUE-REF-999');
      `, [bookingId, frontDeskUserId]);

      // Attempting exact same reference fails with unique_violation
      await assert.rejects(
        async () => {
          await client.query(`
            SELECT * FROM fn_record_payment($1, $2, 'PAYMENT', 1000.00, 'CASH', 'UNIQUE-REF-999');
          `, [bookingId, frontDeskUserId]);
        },
        (err) => err.code === '23505'
      );

      // Whitespace padded reference should also be trimmed and conflict
      await assert.rejects(
        async () => {
          await client.query(`
            SELECT * FROM fn_record_payment($1, $2, 'PAYMENT', 1000.00, 'CASH', '  UNIQUE-REF-999  ');
          `, [bookingId, frontDeskUserId]);
        },
        (err) => err.code === '23505'
      );
    });

    // --- Scenario 8: Stored procedure sp_record_payment per Table 45 ---
    await t.test('Scenario 8: Stored procedure sp_record_payment works per Table 45', async () => {
      const { bookingId } = await createTestBooking(1, 1, 'BK-S07-SP');

      const spRes = await client.query(`
        CALL sp_record_payment(
          $1::uuid, $2::uuid, 'PAYMENT'::payment_kind_enum, 2500.00, 'CASH'::payment_method_enum, 'REF-SP-TEST', NULL
        );
      `, [bookingId, frontDeskUserId]);

      assert.ok(spRes.rows[0].p_payment_id, 'sp_record_payment should return generated payment_id in INOUT parameter');

      const balCheck = await client.query(`SELECT fn_outstanding_balance($1) AS bal`, [bookingId]);
      assert.equal(Number(balCheck.rows[0].bal), 3500.00); // 6000 - 2500 = 3500
    });

    // --- Scenario 9: Posting is prohibited on FINAL invoices ---
    await t.test('Scenario 9: Posting is prohibited on FINAL invoices', async () => {
      const { bookingId } = await createTestBooking(1, 1, 'BK-S07-FINAL');

      // Pay in full
      await client.query(`
        SELECT * FROM fn_record_payment($1, $2, 'PAYMENT', 6000.00, 'CASH', 'REF-PAY-FINAL');
      `, [bookingId, frontDeskUserId]);

      // Set line terminal (CHECKED_OUT)
      await client.query(`
        UPDATE booking_room_line SET status = 'CHECKED_OUT' WHERE booking_id = $1;
      `, [bookingId]);

      // Finalize invoice
      await client.query(`
        SELECT * FROM fn_issue_final_invoice($1, $2);
      `, [bookingId, frontDeskUserId]);

      // Attempting payment on finalized booking fails
      await assert.rejects(
        async () => {
          await client.query(`
            SELECT * FROM fn_record_payment($1, $2, 'PAYMENT', 100.00, 'CASH', 'REF-AFTER-FINAL');
          `, [bookingId, frontDeskUserId]);
        },
        /Posting payments or refunds is prohibited/
      );
    });

    // --- Scenario 10: Concurrent payment posting serializes under row locks ---
    await t.test('Scenario 10: Concurrent payment posting serializes under row locks', async () => {
      // 1 room * 6000.00 = 6000.00 total
      const { bookingId } = await createTestBooking(1, 1, 'BK-S07-CONCURRENT');

      // We will launch two concurrent payments of 4000.00 simultaneously using separate client connections.
      // Total amount is 6000.00, so 4000 + 4000 = 8000.00 > 6000.00.
      // Under proper row locking, one transaction must acquire the lock first, succeed and leave balance = 2000.00.
      // The second transaction, waiting on the lock, will then see balance = 2000.00 and FAIL with overpayment check!
      const client1 = new Client({ connectionString });
      const client2 = new Client({ connectionString });
      await client1.connect();
      await client2.connect();

      await client1.query(`SET search_path TO ${scratchSchema}, public`);
      await client2.query(`SET search_path TO ${scratchSchema}, public`);

      const p1Promise = client1.query(`
        SELECT * FROM fn_record_payment($1, $2, 'PAYMENT', 4000.00, 'CASH', 'CONC-PAY-A');
      `, [bookingId, frontDeskUserId]);

      const p2Promise = client2.query(`
        SELECT * FROM fn_record_payment($1, $2, 'PAYMENT', 4000.00, 'CASH', 'CONC-PAY-B');
      `, [bookingId, frontDeskUserId]);

      const results = await Promise.allSettled([p1Promise, p2Promise]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      assert.equal(fulfilled.length, 1, 'Exactly one concurrent payment should succeed');
      assert.equal(rejected.length, 1, 'Exactly one concurrent payment should be rejected');
      assert.match(rejected[0].reason.message, /exceeds current outstanding balance/);

      // Verify the resulting balance is 2000.00
      const balCheck = await client.query(`SELECT fn_outstanding_balance($1::uuid) AS bal`, [bookingId]);
      assert.equal(Number(balCheck.rows[0].bal), 2000.00);

      await client1.end();
      await client2.end();
    });

  } finally {
    try {
      await client.query(`DROP SCHEMA IF EXISTS ${scratchSchema} CASCADE`);
    } finally {
      await client.end();
    }
  }
});
