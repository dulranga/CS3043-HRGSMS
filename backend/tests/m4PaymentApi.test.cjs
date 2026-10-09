const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { Client } = require('pg');

function loadDatabaseUrl() {
  if (process.env.PG_TEST_URL || process.env.PG_URL) return process.env.PG_TEST_URL || process.env.PG_URL;
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

test('M4-S08: Payment and refund REST API with validation, staff authorization, and safe error mapping', async (t) => {
  const connectionString = loadDatabaseUrl();
  assert.ok(connectionString, 'Database connection string must be defined');

  const client = new Client({ connectionString });
  await client.connect();

  const scratchSchema = `test_m4_s08_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  let server;
  let baseUrl;

  try {
    await client.query(`CREATE SCHEMA ${scratchSchema}`);
    await client.query(`SET search_path TO ${scratchSchema}`);

    // Apply all migrations in order
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

    // 1. Seed Branches
    const b1Res = await client.query(`
      INSERT INTO branch (name, city, address)
      VALUES ('Colombo Grand', 'Colombo', '10 Galle Road, Colombo')
      RETURNING branch_id;
    `);
    const branchColomboId = b1Res.rows[0].branch_id;

    const b2Res = await client.query(`
      INSERT INTO branch (name, city, address)
      VALUES ('Kandy Hills', 'Kandy', '20 Peradeniya Road, Kandy')
      RETURNING branch_id;
    `);
    const branchKandyId = b2Res.rows[0].branch_id;

    // 2. Seed Staff User Accounts & Officers
    const roleFrontDesk = (await client.query(`SELECT role_id FROM role WHERE role_name = 'FRONT_DESK'`)).rows[0].role_id;
    const roleBranchMgr = (await client.query(`SELECT role_id FROM role WHERE role_name = 'BRANCH_MANAGER'`)).rows[0].role_id;
    const roleChainMgr = (await client.query(`SELECT role_id FROM role WHERE role_name = 'CHAIN_MANAGER'`)).rows[0].role_id;
    const roleAuditor = (await client.query(`SELECT role_id FROM role WHERE role_name = 'AUDITOR'`)).rows[0].role_id;

    // Staff Colombo Front Desk
    const uColomboFD = (await client.query(`INSERT INTO user_account (username, password_hash) VALUES ('colombo_fd', 'pw') RETURNING user_id`)).rows[0].user_id;
    await client.query(`INSERT INTO officer (officer_id, full_name, role_id, branch_id) VALUES ($1, 'Colombo Desk', $2, $3)`, [uColomboFD, roleFrontDesk, branchColomboId]);

    // Staff Colombo Manager
    const uColomboMgr = (await client.query(`INSERT INTO user_account (username, password_hash) VALUES ('colombo_mgr', 'pw') RETURNING user_id`)).rows[0].user_id;
    await client.query(`INSERT INTO officer (officer_id, full_name, role_id, branch_id) VALUES ($1, 'Colombo Mgr', $2, $3)`, [uColomboMgr, roleBranchMgr, branchColomboId]);

    // Staff Kandy Front Desk
    const uKandyFD = (await client.query(`INSERT INTO user_account (username, password_hash) VALUES ('kandy_fd', 'pw') RETURNING user_id`)).rows[0].user_id;
    await client.query(`INSERT INTO officer (officer_id, full_name, role_id, branch_id) VALUES ($1, 'Kandy Desk', $2, $3)`, [uKandyFD, roleFrontDesk, branchKandyId]);

    // Staff Chain Manager
    const uChainMgr = (await client.query(`INSERT INTO user_account (username, password_hash) VALUES ('chain_mgr', 'pw') RETURNING user_id`)).rows[0].user_id;
    await client.query(`INSERT INTO officer (officer_id, full_name, role_id, branch_id) VALUES ($1, 'Chain Exec', $2, $3)`, [uChainMgr, roleChainMgr, branchColomboId]);

    // 3. Seed Online Guests (user_account + guest + guest_account)
    // Guest 1 (Alice)
    const uGuest1 = (await client.query(`INSERT INTO user_account (username, password_hash) VALUES ('alice_guest', 'pw') RETURNING user_id`)).rows[0].user_id;
    const g1 = (await client.query(`INSERT INTO guest (full_name, email, phone, nic) VALUES ('Alice Perera', 'alice@test.com', '0771111111', '199011111111') RETURNING guest_id`)).rows[0].guest_id;
    await client.query(`INSERT INTO guest_account (user_id, guest_id) VALUES ($1, $2)`, [uGuest1, g1]);

    // 4. Seed Policy & Rooms
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

    const rtRes = await client.query(`
      INSERT INTO room_type (name, base_daily_rate, capacity)
      VALUES ('Deluxe Ocean', 20000.00, 2)
      RETURNING room_type_id;
    `);
    const roomTypeId = rtRes.rows[0].room_type_id;

    const rColombo = (await client.query(`
      INSERT INTO room (room_number, branch_id, room_type_id)
      VALUES ('101', $1, $2)
      RETURNING room_id;
    `, [branchColomboId, roomTypeId])).rows[0].room_id;

    const rKandy = (await client.query(`
      INSERT INTO room (room_number, branch_id, room_type_id)
      VALUES ('201', $1, $2)
      RETURNING room_id;
    `, [branchKandyId, roomTypeId])).rows[0].room_id;

    // 5. Seed Booking 1 (Alice in Colombo):
    // 2 nights @ 20,000 = 40,000 room charge.
    // DRAFT invoice with 5,000 discount.
    // Gross 40,000 - 5,000 = 35,000 base.
    // SC 5% = 1,750. Tax 10% on (35,000 + 1,750) = 3,675.
    // Total = 40,425.00.
    const b1 = (await client.query(`
      INSERT INTO booking (booking_ref, booking_channel, guest_id, created_by)
      VALUES ('REF-ALICE-COLOMBO', 'DIRECT_ONLINE', $1, $2)
      RETURNING booking_id;
    `, [g1, uGuest1])).rows[0].booking_id;

    const line1 = (await client.query(`
      INSERT INTO booking_room_line (booking_id, stay_start_date, stay_end_date, guest_count, rate_snapshot, status)
      VALUES ($1, CURRENT_DATE + 1, CURRENT_DATE + 3, 2, 20000.00, 'BOOKED')
      RETURNING line_id;
    `, [b1])).rows[0].line_id;

    await client.query(`
      INSERT INTO booking_room_assignment (line_id, room_id)
      VALUES ($1, $2);
    `, [line1, rColombo]);

    await client.query(`SELECT fn_create_booking_draft_invoice($1, $2) AS invoice_id`, [b1, uGuest1]);
    await client.query(`SELECT fn_refresh_draft_invoice($1, $2, 5000.00)`, [b1, uGuest1]);

    // 6. Seed Booking 2 (Bob in Kandy):
    // 1 night @ 20,000. Terminal (CHECKED_OUT).
    // Gross = 20,000. SC = 1,000. Tax = 2,100. Total = 23,100.
    // Overpaid 30,000 => Credit of -6,900.00.
    const g2 = (await client.query(`INSERT INTO guest (full_name, email, phone, nic) VALUES ('Bob Silva', 'bob@test.com', '0772222222', '199022222222') RETURNING guest_id`)).rows[0].guest_id;
    const b2 = (await client.query(`
      INSERT INTO booking (booking_ref, booking_channel, guest_id, created_by)
      VALUES ('REF-BOB-KANDY', 'FRONT_DESK', $1, $2)
      RETURNING booking_id;
    `, [g2, uKandyFD])).rows[0].booking_id;

    const line2 = (await client.query(`
      INSERT INTO booking_room_line (booking_id, stay_start_date, stay_end_date, guest_count, rate_snapshot, status)
      VALUES ($1, CURRENT_DATE - 2, CURRENT_DATE - 1, 1, 20000.00, 'CHECKED_OUT')
      RETURNING line_id;
    `, [b2])).rows[0].line_id;

    await client.query(`
      INSERT INTO booking_room_assignment (line_id, room_id)
      VALUES ($1, $2);
    `, [line2, rKandy]);

    await client.query(`SELECT fn_create_booking_draft_invoice($1, $2) AS invoice_id`, [b2, uKandyFD]);

    // Overpayment of 30,000
    await client.query(`
      INSERT INTO payment (booking_id, recorded_by, kind, amount, method, status, reference)
      VALUES ($1, $2, 'PAYMENT', 30000.00, 'CASH', 'SUCCESSFUL', 'PAY-BOB-INIT-OVERPAY');
    `, [b2, uKandyFD]);

    // Setup Express App with custom database client connected to scratchSchema
    const { createPaymentRouter } = await import('../src/routes/paymentRoutes');

    const app = express();
    app.use(express.json());

    const testDb = {
      query: (sql, values) => client.query(sql, values),
    };

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
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      return { status: res.status, data };
    }

    // SCENARIO 1: Unauthenticated request fails with 401
    await t.test('1. Unauthenticated request without actor header fails with 401', async () => {
      const res = await reqApi(`/api/bookings/${b1}/payments`, {
        body: { amount: 1000, method: 'CASH' },
      });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.data.error.code, 'AUTHENTICATION_REQUIRED');
    });

    // SCENARIO 2: Online guest attempt to record payment fails with 403 Forbidden
    await t.test('2. Online guest cannot record manual staff payment (403 Forbidden)', async () => {
      const res = await reqApi(`/api/bookings/${b1}/payments`, {
        headers: { 'x-user-id': uGuest1 },
        body: { amount: 1000, method: 'BANK_TRANSFER' },
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.data.error.code, 'FORBIDDEN');
      assert.match(res.data.error.message, /online guests are not authorized/i);
    });

    // SCENARIO 3: Cross-branch staff attempt fails with 403 Forbidden
    await t.test('3. Cross-branch staff cannot record payment on other branch (403 Forbidden)', async () => {
      const res = await reqApi(`/api/bookings/${b1}/payments`, {
        headers: { 'x-user-id': uKandyFD }, // Kandy staff on Colombo booking
        body: { amount: 1000, method: 'CASH' },
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.data.error.code, 'FORBIDDEN');
      assert.match(res.data.error.message, /branch/i);
    });

    // SCENARIO 4: Amount and input validations (zero, negative, >2 decimals, invalid method/kind)
    await t.test('4. Input validation: zero, negative, excess precision, and invalid methods fail with 400', async () => {
      const baseHeaders = { 'x-user-id': uColomboFD };

      // Missing amount
      let res = await reqApi(`/api/bookings/${b1}/payments`, {
        headers: baseHeaders,
        body: { method: 'CASH' },
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.error.code, 'INVALID_AMOUNT');

      // Zero amount
      res = await reqApi(`/api/bookings/${b1}/payments`, {
        headers: baseHeaders,
        body: { amount: 0, method: 'CASH' },
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.error.code, 'INVALID_AMOUNT');

      // Negative amount
      res = await reqApi(`/api/bookings/${b1}/payments`, {
        headers: baseHeaders,
        body: { amount: -500, method: 'CASH' },
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.error.code, 'INVALID_AMOUNT');

      // More than 2 decimal places
      res = await reqApi(`/api/bookings/${b1}/payments`, {
        headers: baseHeaders,
        body: { amount: 100.555, method: 'CASH' },
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.error.code, 'INVALID_AMOUNT_PRECISION');

      // Invalid payment method
      res = await reqApi(`/api/bookings/${b1}/payments`, {
        headers: baseHeaders,
        body: { amount: 100.0, method: 'CREDIT_CARD' }, // Only CASH and BANK_TRANSFER supported
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.error.code, 'INVALID_PAYMENT_METHOD');

      // Invalid payment kind
      res = await reqApi(`/api/bookings/${b1}/payments`, {
        headers: baseHeaders,
        body: { amount: 100.0, method: 'CASH', kind: 'CHARGE' },
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.error.code, 'INVALID_PAYMENT_KIND');

      // Invalid status
      res = await reqApi(`/api/bookings/${b1}/payments`, {
        headers: baseHeaders,
        body: { amount: 100.0, method: 'CASH', status: 'REVERSED' },
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.error.code, 'INVALID_PAYMENT_STATUS');
    });

    // SCENARIO 5: Own-branch staff records valid partial payment (with auto-generated reference)
    let p1Id;
    let autoRef;
    await t.test('5. Own-branch staff records valid partial payment with structured auto reference (201 Created)', async () => {
      const res = await reqApi(`/api/bookings/${b1}/payments`, {
        headers: { 'x-user-id': uColomboFD },
        body: { amount: 15000.0, method: 'CASH' },
      });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.kind, 'PAYMENT');
      assert.strictEqual(res.data.amount, 15000.0);
      assert.strictEqual(res.data.previous_balance, 40425.0);
      assert.strictEqual(res.data.new_balance, 25425.0);
      assert.strictEqual(res.data.is_credit, false);
      assert.strictEqual(res.data.credit_amount, 0);

      // Verify receipt structure
      const r = res.data.receipt;
      assert.ok(r, 'Receipt must be returned');
      assert.match(r.receipt_reference, /^PAY-\d{8}-\d{6}$/);
      assert.strictEqual(r.is_settled, false);
      assert.strictEqual(r.recorded_by, uColomboFD);

      p1Id = res.data.payment_id;
      autoRef = res.data.reference;
    });

    // SCENARIO 6: Chain manager records partial payment with explicit reference
    const explicitRef = 'PAY-CHAIN-REF-001';
    await t.test('6. Chain manager records payment with explicit reference (201 Created)', async () => {
      const res = await reqApi(`/api/bookings/${b1}/payments`, {
        headers: { 'x-user-id': uChainMgr },
        body: {
          amount: 10000.0,
          method: 'BANK_TRANSFER',
          reference: explicitRef,
        },
      });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.amount, 10000.0);
      assert.strictEqual(res.data.reference, explicitRef);
      assert.strictEqual(res.data.previous_balance, 25425.0);
      assert.strictEqual(res.data.new_balance, 15425.0);
      assert.strictEqual(res.data.receipt.receipt_reference, explicitRef);
    });

    // SCENARIO 7: Duplicate reference is rejected with 409 Conflict
    await t.test('7. Duplicate payment reference fails with 409 Conflict', async () => {
      const res = await reqApi(`/api/bookings/${b1}/payments`, {
        headers: { 'x-user-id': uColomboMgr },
        body: {
          amount: 1000.0,
          method: 'BANK_TRANSFER',
          reference: explicitRef, // Already used
        },
      });
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.data.error.code, 'DUPLICATE_REFERENCE');
    });

    // SCENARIO 8: Overpayment above positive balance is rejected with 400 Bad Request
    await t.test('8. Overpayment above remaining balance fails with 400 Bad Request', async () => {
      // Current balance is 15,425.00. Attempt 20,000.00
      const res = await reqApi(`/api/bookings/${b1}/payments`, {
        headers: { 'x-user-id': uColomboFD },
        body: {
          amount: 20000.0,
          method: 'CASH',
        },
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.error.code, 'OVERPAYMENT_NOT_ALLOWED');
      assert.match(res.data.error.message, /exceeds current outstanding balance/i);
    });

    // SCENARIO 9: Settle balance exactly to 0.00
    await t.test('9. Exact payment settles balance to 0.00 (receipt.is_settled: true)', async () => {
      const res = await reqApi(`/api/bookings/${b1}/payments`, {
        headers: { 'x-user-id': uColomboFD },
        body: {
          amount: 15425.0,
          method: 'CASH',
        },
      });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.new_balance, 0.0);
      assert.strictEqual(res.data.receipt.is_settled, true);
    });

    // SCENARIO 10: Payment on zero balance fails with 400 Bad Request
    await t.test('10. Payment on settled zero balance fails with 400 Bad Request', async () => {
      const res = await reqApi(`/api/bookings/${b1}/payments`, {
        headers: { 'x-user-id': uColomboFD },
        body: {
          amount: 500.0,
          method: 'CASH',
        },
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.error.code, 'NO_OUTSTANDING_BALANCE');
      assert.match(res.data.error.message, /no positive balance due/i);
    });

    // SCENARIO 11: Refund on zero balance fails with 400 Bad Request
    await t.test('11. Refund on zero balance fails with 400 Bad Request', async () => {
      const res = await reqApi(`/api/bookings/${b1}/refunds`, {
        headers: { 'x-user-id': uColomboFD },
        body: {
          amount: 500.0,
          method: 'CASH',
        },
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.error.code, 'NO_CREDIT_TO_REFUND');
      assert.match(res.data.error.message, /no credit balance to refund/i);
    });

    // SCENARIO 12: Manual staff refund on credit balance (Booking 2: -6900 credit)
    await t.test('12. Over-refund rejected, and partial/full refund against credit succeeds (201 Created)', async () => {
      // Booking 2 has credit -6,900.00
      // 12a. Over-refund of 7,000 fails
      let res = await reqApi(`/api/bookings/${b2}/refunds`, {
        headers: { 'x-user-id': uKandyFD },
        body: {
          amount: 7000.0,
          method: 'CASH',
        },
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.error.code, 'OVER_REFUND_NOT_ALLOWED');

      // 12b. Partial refund of 3,000.00 succeeds
      res = await reqApi(`/api/bookings/${b2}/refunds`, {
        headers: { 'x-user-id': uKandyFD },
        body: {
          amount: 3000.0,
          method: 'CASH',
        },
      });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.kind, 'REFUND');
      assert.strictEqual(res.data.amount, 3000.0);
      assert.strictEqual(res.data.previous_balance, -6900.0);
      assert.strictEqual(res.data.new_balance, -3900.0);
      assert.strictEqual(res.data.is_credit, true);
      assert.strictEqual(res.data.credit_amount, 3900.0);
      assert.match(res.data.receipt.receipt_reference, /^REF-\d{8}-\d{6}$/);

      // 12c. Full remaining refund of 3,900.00 settles credit to exactly 0.00
      res = await reqApi(`/api/bookings/${b2}/refunds`, {
        headers: { 'x-user-id': uKandyFD },
        body: {
          amount: 3900.0,
          method: 'CASH',
        },
      });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.new_balance, 0.0);
      assert.strictEqual(res.data.is_credit, false);
      assert.strictEqual(res.data.credit_amount, 0.0);
      assert.strictEqual(res.data.receipt.is_settled, true);
    });

    // SCENARIO 13: Payment reversal reopens balance
    await t.test('13. Payment reversal reopens outstanding balance (200 OK)', async () => {
      // Reverse payment p1Id (15,000.00) from Booking 1
      const res = await reqApi(`/api/payments/${p1Id}/reverse`, {
        headers: { 'x-user-id': uColomboFD },
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.status, 'REVERSED');
      assert.strictEqual(res.data.amount, 15000.0);
      assert.strictEqual(res.data.previous_balance, 0.0);
      assert.strictEqual(res.data.new_balance, 15000.0);
      assert.ok(res.data.reversal_receipt, 'Reversal receipt must be returned');
      assert.strictEqual(res.data.reversal_receipt.reopened_balance, 15000.0);
    });

    // SCENARIO 14: Payment reversal restrictions (already reversed, cross branch, online guest)
    await t.test('14. Payment reversal restrictions: already reversed (400), cross-branch (403), guest (403)', async () => {
      // 14a. Already reversed -> 400 INVALID_PAYMENT_STATE
      let res = await reqApi(`/api/payments/${p1Id}/reverse`, {
        headers: { 'x-user-id': uColomboFD },
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.error.code, 'INVALID_PAYMENT_STATE');

      // 14b. Online guest attempting reversal
      res = await reqApi(`/api/payments/${p1Id}/reverse`, {
        headers: { 'x-user-id': uGuest1 },
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.data.error.code, 'FORBIDDEN');

      // 14c. Cross-branch staff attempting reversal
      res = await reqApi(`/api/payments/${p1Id}/reverse`, {
        headers: { 'x-user-id': uKandyFD },
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.data.error.code, 'FORBIDDEN');
    });

    // SCENARIO 15: Post payment against a FINAL invoice fails with 409 Conflict
    await t.test('15. Posting payment or refund against a FINAL invoice fails with 409 Conflict', async () => {
      // Booking 2 has all lines CHECKED_OUT and balance is settled 0.00.
      // Finalize invoice for Booking 2:
      await client.query(`SELECT fn_issue_final_invoice($1, $2)`, [b2, uKandyFD]);

      // Attempt payment against finalized booking
      const res = await reqApi(`/api/bookings/${b2}/payments`, {
        headers: { 'x-user-id': uKandyFD },
        body: {
          amount: 500.0,
          method: 'CASH',
        },
      });
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.data.error.code, 'INVOICE_FINAL');
      assert.match(res.data.error.message, /final/i);
    });

  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await client.query(`DROP SCHEMA IF EXISTS ${scratchSchema} CASCADE`);
    await client.end();
  }
});
