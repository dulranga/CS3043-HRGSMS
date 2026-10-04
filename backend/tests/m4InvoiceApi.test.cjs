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

test('M4-S06: Invoice detail and payment history read API with branch scope and guest ownership', async (t) => {
  const connectionString = loadDatabaseUrl();
  assert.ok(connectionString, 'Database connection string must be defined');

  const client = new Client({ connectionString });
  await client.connect();

  const scratchSchema = `test_m4_s06_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  let server;
  let baseUrl;

  try {
    await client.query(`CREATE SCHEMA ${scratchSchema}`);
    await client.query(`SET search_path TO ${scratchSchema}, public`);

    // Apply all migrations in order
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
      'm3_001_service_usage_mock.sql',
      'm4_001_invoice_and_lines.sql',
      'm4_002_payment.sql',
      'm4_003_billing_calculation.sql',
      'm4_004_invoice_lifecycle.sql',
      'm4_005_invoice_query_indexes.sql',
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

    // Staff Auditor
    const uAuditor = (await client.query(`INSERT INTO user_account (username, password_hash) VALUES ('auditor_user', 'pw') RETURNING user_id`)).rows[0].user_id;
    await client.query(`INSERT INTO officer (officer_id, full_name, role_id, branch_id) VALUES ($1, 'Auditor Staff', $2, $3)`, [uAuditor, roleAuditor, branchColomboId]);

    // 3. Seed Online Guests (user_account + guest + guest_account)
    // Guest 1 (Alice)
    const uGuest1 = (await client.query(`INSERT INTO user_account (username, password_hash) VALUES ('alice_guest', 'pw') RETURNING user_id`)).rows[0].user_id;
    const g1 = (await client.query(`INSERT INTO guest (full_name, email, phone, nic) VALUES ('Alice Perera', 'alice@test.com', '0771111111', '199011111111') RETURNING guest_id`)).rows[0].guest_id;
    await client.query(`INSERT INTO guest_account (user_id, guest_id) VALUES ($1, $2)`, [uGuest1, g1]);

    // Guest 2 (Bob)
    const uGuest2 = (await client.query(`INSERT INTO user_account (username, password_hash) VALUES ('bob_guest', 'pw') RETURNING user_id`)).rows[0].user_id;
    const g2 = (await client.query(`INSERT INTO guest (full_name, email, phone, nic) VALUES ('Bob Silva', 'bob@test.com', '0772222222', '199022222222') RETURNING guest_id`)).rows[0].guest_id;
    await client.query(`INSERT INTO guest_account (user_id, guest_id) VALUES ($1, $2)`, [uGuest2, g2]);

    // 4. Seed Policy
    const polRes = await client.query(`
      INSERT INTO billing_policy (
        effective_from, tax_percent, service_charge_percent, max_discount_percent,
        cancellation_fee, no_show_fee, late_checkout_fee, no_show_grace_days,
        is_demo, created_by
      ) VALUES (
        CURRENT_DATE - 1, 10.00, 5.00, 20.00,
        1000.00, 2000.00, 1500.00, 1,
        false, $1
      ) RETURNING billing_policy_id;
    `, [uChainMgr]);
    const policyId = polRes.rows[0].billing_policy_id;

    // Room type
    const rtRes = await client.query(`
      INSERT INTO room_type (name, base_daily_rate, capacity)
      VALUES ('Deluxe Ocean', 20000.00, 2)
      RETURNING room_type_id;
    `);
    const roomTypeId = rtRes.rows[0].room_type_id;

    // Rooms for Branch Colombo and Branch Kandy
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
    // 2 nights @ 20,000 = 40,000 Room charge.
    // DRAFT invoice, discount 5,000.
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

    // Create DRAFT invoice for Booking 1 with discount 5000
    const inv1Id = (await client.query(`SELECT fn_create_booking_draft_invoice($1, $2) AS invoice_id`, [b1, uGuest1])).rows[0].invoice_id;
    await client.query(`SELECT fn_refresh_draft_invoice($1, $2, 5000.00)`, [b1, uGuest1]);

    // Gross = 40,000. Discount = 5,000.
    // Base = 35,000. SC 5% = 1,750. Tax 10% on (35,000 + 1,750 = 36,750) = 3,675.
    // Total = 40,425.00
    // Record payment of 30,000 LKR
    await client.query(`
      INSERT INTO payment (booking_id, recorded_by, kind, amount, method, status, reference)
      VALUES ($1, $2, 'PAYMENT', 30000.00, 'BANK_TRANSFER', 'SUCCESSFUL', 'PAY-ALICE-01');
    `, [b1, uGuest1]);

    // 6. Seed Booking 2 (Bob in Kandy):
    // 1 night @ 20,000. CHECKED_OUT.
    // FINAL invoice.
    // Gross = 20,000. SC = 1,000. Tax = 2,100. Total = 23,100.
    // Overpaid 30,000, unrefunded credit 6,900.
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

    const inv2Id = (await client.query(`SELECT fn_create_booking_draft_invoice($1, $2) AS invoice_id`, [b2, uKandyFD])).rows[0].invoice_id;

    // Overpayment of 30,000
    await client.query(`
      INSERT INTO payment (booking_id, recorded_by, kind, amount, method, status, reference)
      VALUES ($1, $2, 'PAYMENT', 30000.00, 'CASH', 'SUCCESSFUL', 'PAY-BOB-OVERPAY');
    `, [b2, uKandyFD]);

    // Settle 23,100 by refunding 6,900 to test FINAL issuance on Booking 3 later,
    // but keep Booking 2 with credit to test distinct credit labeling!

    // Setup Express App with custom database client connected to scratchSchema
    const { createInvoiceRouter } = await import('../src/routes/invoiceRoutes');

    const app = express();
    app.use(express.json());

    // Wrap client in DbClient interface
    const testDb = {
      query: (sql, values) => client.query(sql, values),
    };

    app.use('/api', createInvoiceRouter(undefined, testDb));

    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const addr = server.address();
    assert.ok(addr && typeof addr !== 'string');
    baseUrl = `http://127.0.0.1:${addr.port}`;

    async function reqApi(pathName, headers = {}) {
      const res = await fetch(`${baseUrl}${pathName}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      });
      const data = await res.json();
      return { status: res.status, data };
    }

    // =========================================================================
    // Scenario 1: Unauthenticated request fails (401)
    // =========================================================================
    await t.test('Scenario 1: Unauthenticated requests require authentication', async () => {
      const resInv = await reqApi(`/api/bookings/${b1}/invoice`);
      assert.equal(resInv.status, 401);
      assert.equal(resInv.data.error.code, 'AUTHENTICATION_REQUIRED');

      const resPay = await reqApi(`/api/bookings/${b1}/payments`);
      assert.equal(resPay.status, 401);
      assert.equal(resPay.data.error.code, 'AUTHENTICATION_REQUIRED');
    });

    // =========================================================================
    // Scenario 2: Online guest reads own booking invoice (200)
    // =========================================================================
    await t.test('Scenario 2: Online guest reads own booking invoice with signed lines and provisional DRAFT label', async () => {
      const res = await reqApi(`/api/bookings/${b1}/invoice`, { 'x-user-id': uGuest1 });
      assert.equal(res.status, 200);

      const inv = res.data;
      assert.equal(inv.booking_id, b1);
      assert.equal(inv.status, 'DRAFT');
      assert.equal(inv.is_provisional, true, 'DRAFT invoice must be labeled provisional');
      assert.equal(inv.invoice_number, null, 'DRAFT invoice has no issued number');

      // Verify signed lines exist
      assert.ok(Array.isArray(inv.lines) && inv.lines.length >= 4);
      const roomLine = inv.lines.find((l) => l.line_type === 'ROOM');
      assert.equal(Number(roomLine.amount), 40000.00);

      const discountLine = inv.lines.find((l) => l.line_type === 'DISCOUNT');
      assert.equal(Number(discountLine.amount), -5000.00, 'Discount must be negative signed amount');

      const scLine = inv.lines.find((l) => l.line_type === 'PERCENT_SERVICE_CHARGE');
      assert.equal(Number(scLine.amount), 1750.00);

      const taxLine = inv.lines.find((l) => l.line_type === 'TAX');
      assert.equal(Number(taxLine.amount), 3675.00);

      // Verify totals match signed lines
      const computedTotal = inv.lines.reduce((acc, line) => acc + Number(line.amount), 0);
      assert.equal(inv.summary.total_amount, 40425.00);
      assert.equal(inv.summary.total_amount, computedTotal, 'Total amount must match sum of signed lines');

      // Verify summary numbers
      assert.equal(inv.summary.successful_payments, 30000.00);
      assert.equal(inv.summary.successful_refunds, 0.00);
      assert.equal(inv.summary.net_payments, 30000.00);
      assert.equal(inv.summary.outstanding_balance, 10425.00);
      assert.equal(inv.summary.is_credit, false);
      assert.equal(inv.summary.credit_amount, 0.00);
      assert.equal(inv.summary.is_settled, false);
      assert.equal(inv.summary.is_provisional, true);
    });

    // =========================================================================
    // Scenario 3: Cross-guest read fails (403)
    // =========================================================================
    await t.test('Scenario 3: Cross-guest read is forbidden', async () => {
      // Bob tries to read Alice's invoice
      const resInv = await reqApi(`/api/bookings/${b1}/invoice`, { 'x-user-id': uGuest2 });
      assert.equal(resInv.status, 403);
      assert.match(resInv.data.error.message, /only access their own bookings/);

      // Bob tries to read Alice's payments
      const resPay = await reqApi(`/api/bookings/${b1}/payments`, { 'x-user-id': uGuest2 });
      assert.equal(resPay.status, 403);
      assert.match(resPay.data.error.message, /only access their own bookings/);
    });

    // =========================================================================
    // Scenario 4: Own-branch staff reads booking invoice (200)
    // =========================================================================
    await t.test('Scenario 4: Own-branch staff can read invoice and payments', async () => {
      // Colombo front desk staff reads Colombo booking
      const resInv = await reqApi(`/api/bookings/${b1}/invoice`, { 'x-user-id': uColomboFD });
      assert.equal(resInv.status, 200);
      assert.equal(resInv.data.booking_id, b1);

      // Colombo manager reads Colombo booking
      const resMgr = await reqApi(`/api/bookings/${b1}/invoice`, { 'x-user-id': uColomboMgr });
      assert.equal(resMgr.status, 200);
    });

    // =========================================================================
    // Scenario 5: Cross-branch staff read fails (403)
    // =========================================================================
    await t.test('Scenario 5: Cross-branch staff read is denied', async () => {
      // Kandy front desk staff tries to read Colombo booking
      const resInv = await reqApi(`/api/bookings/${b1}/invoice`, { 'x-user-id': uKandyFD });
      assert.equal(resInv.status, 403);
      assert.match(resInv.data.error.message, /restricted to own branch/);

      const resPay = await reqApi(`/api/bookings/${b1}/payments`, { 'x-user-id': uKandyFD });
      assert.equal(resPay.status, 403);
      assert.match(resPay.data.error.message, /restricted to own branch/);

      // Colombo manager tries to read Kandy booking
      const resCrossMgr = await reqApi(`/api/bookings/${b2}/invoice`, { 'x-user-id': uColomboMgr });
      assert.equal(resCrossMgr.status, 403);
    });

    // =========================================================================
    // Scenario 6: Chain-wide staff reads cross-branch bookings (200)
    // =========================================================================
    await t.test('Scenario 6: Chain manager and auditor have cross-branch read access', async () => {
      // Chain manager reads Colombo and Kandy
      const resChain1 = await reqApi(`/api/bookings/${b1}/invoice`, { 'x-user-id': uChainMgr });
      assert.equal(resChain1.status, 200);

      const resChain2 = await reqApi(`/api/bookings/${b2}/invoice`, { 'x-user-id': uChainMgr });
      assert.equal(resChain2.status, 200);

      // Auditor reads Colombo and Kandy
      const resAudit1 = await reqApi(`/api/bookings/${b1}/payments`, { 'x-user-id': uAuditor });
      assert.equal(resAudit1.status, 200);

      const resAudit2 = await reqApi(`/api/bookings/${b2}/payments`, { 'x-user-id': uAuditor });
      assert.equal(resAudit2.status, 200);
    });

    // =========================================================================
    // Scenario 7: Payment and Refund History with Distinct Credit Labeling
    // =========================================================================
    await t.test('Scenario 7: Payment history labels credits distinctly and matches net payments', async () => {
      // Bob reads his booking (Booking 2 in Kandy)
      const resPay = await reqApi(`/api/bookings/${b2}/payments`, { 'x-user-id': uGuest2 });
      assert.equal(resPay.status, 200);

      const data = resPay.data;
      assert.equal(data.booking_id, b2);
      assert.equal(data.payments.length, 1);
      assert.equal(data.payments[0].kind, 'PAYMENT');
      assert.equal(Number(data.payments[0].amount), 30000.00);

      // Bill total = 23,100. Paid = 30,000.
      // Net payments = 30,000. Outstanding balance = -6,900.00
      assert.equal(data.summary.successful_payments_total, 30000.00);
      assert.equal(data.summary.net_payments, 30000.00);
      assert.equal(data.summary.invoice_total, 23100.00);
      assert.equal(data.summary.outstanding_balance, -6900.00);

      // Credit distinctly labeled
      assert.equal(data.summary.is_credit, true, 'Credit must be distinctly labeled when balance < 0');
      assert.equal(data.summary.credit_amount, 6900.00, 'Credit amount must reflect absolute unrefunded credit');
      assert.equal(data.summary.is_settled, false);

      // Also check invoice endpoint for Booking 2 to verify distinct credit labeling there
      const resInv = await reqApi(`/api/bookings/${b2}/invoice`, { 'x-user-id': uGuest2 });
      assert.equal(resInv.status, 200);
      assert.equal(resInv.data.summary.is_credit, true);
      assert.equal(resInv.data.summary.credit_amount, 6900.00);
    });

    // =========================================================================
    // Scenario 8: Direct Invoice Lookup by invoiceId
    // =========================================================================
    await t.test('Scenario 8: Direct invoice lookup by invoice_id respects authorization', async () => {
      // Alice reads invoice 1
      const resOwn = await reqApi(`/api/invoices/${inv1Id}`, { 'x-user-id': uGuest1 });
      assert.equal(resOwn.status, 200);
      assert.equal(resOwn.data.invoice_id, inv1Id);

      // Bob tries to read invoice 1
      const resDenied = await reqApi(`/api/invoices/${inv1Id}`, { 'x-user-id': uGuest2 });
      assert.equal(resDenied.status, 403);

      // Non-existent invoice returns 404
      const fakeId = '01924f0c-b26a-7236-a149-1a065c71b3e9';
      const resNotFound = await reqApi(`/api/invoices/${fakeId}`, { 'x-user-id': uGuest1 });
      assert.equal(resNotFound.status, 404);
      assert.equal(resNotFound.data.error.code, 'INVOICE_NOT_FOUND');
    });

  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await client.query(`DROP SCHEMA IF EXISTS ${scratchSchema} CASCADE`);
    await client.end();
  }
});
