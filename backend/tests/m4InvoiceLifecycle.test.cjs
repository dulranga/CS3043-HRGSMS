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

test('M4-S05: Audited DRAFT invoice lifecycle, balance calculation, and single FINAL issuance', async (t) => {
  const connectionString = loadDatabaseUrl();
  assert.ok(connectionString, 'Database connection string must be defined');

  const client = new Client({ connectionString });
  await client.connect();

  const scratchSchema = `test_m4_s05_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  try {
    await client.query(`CREATE SCHEMA ${scratchSchema}`);
    await client.query(`SET search_path TO ${scratchSchema}, public`);

    // Apply migrations in order: 0000, m1_001, m1_002, m1_003, m1_004, m2_001, m2_002, m3_001, m4_001, m4_002, m4_003, m4_004
    const migrationFiles = [
      '0000_create_audit_and_config.sql',
      'm1_001_create_branch_and_role.sql',
      'm1_002_create_user_account_and_officer.sql',
      'm1_003_create_guest_and_guest_account.sql',
      'm1_004_create_audit_log.sql',
      'm1_005_create_billing_policy.sql',
      'm2_001_room_catalogue.sql',
      'm2_002_booking.sql',
      'm3_001_service_usage_mock.sql',
      'm4_001_invoice_and_lines.sql',
      'm4_002_payment.sql',
      'm4_003_billing_calculation.sql',
      'm4_004_invoice_lifecycle.sql',
    ];

    for (const file of migrationFiles) {
      const filePath = path.resolve(__dirname, '../migrations', file);
      if (fs.existsSync(filePath)) {
        const sql = fs.readFileSync(filePath, 'utf8');
        await client.query(sql);
      }
    }

    // Seed base data
    const branchRes = await client.query(`
      INSERT INTO branch (name, city, address)
      VALUES ('Colombo Grand', 'Colombo', 'Galle Face, Colombo')
      RETURNING branch_id;
    `);
    const branchId = branchRes.rows[0].branch_id;

    const roleRes = await client.query(`SELECT role_id FROM role WHERE role_name = 'FRONT_DESK' LIMIT 1;`);
    const roleId = roleRes.rows[0].role_id;

    const roleCMRes = await client.query(`SELECT role_id FROM role WHERE role_name = 'CHAIN_MANAGER' LIMIT 1;`);
    const cmRoleId = roleCMRes.rows[0].role_id;

    const userRes = await client.query(`
      INSERT INTO user_account (username, password_hash)
      VALUES ('frontdesk_m4', 'hash123')
      RETURNING user_id;
    `);
    const userId = userRes.rows[0].user_id;

    await client.query(`
      INSERT INTO officer (officer_id, full_name, role_id, branch_id)
      VALUES ($1, 'Front Desk Staff', $2, $3);
    `, [userId, roleId, branchId]);

    const cmUserRes = await client.query(`
      INSERT INTO user_account (username, password_hash)
      VALUES ('cm_m4', 'hash123')
      RETURNING user_id;
    `);
    const cmUserId = cmUserRes.rows[0].user_id;

    await client.query(`
      INSERT INTO officer (officer_id, full_name, role_id, branch_id)
      VALUES ($1, 'Chain Manager Staff', $2, $3);
    `, [cmUserId, cmRoleId, branchId]);

    const guestRes = await client.query(`
      INSERT INTO guest (full_name, email, phone, nic)
      VALUES ('Alice Perera', 'alice.m4@example.com', '0771234567', '199012345678')
      RETURNING guest_id;
    `);
    const guestId = guestRes.rows[0].guest_id;

    // Room type
    const rtRes = await client.query(`
      INSERT INTO room_type (name, base_daily_rate, capacity)
      VALUES ('Deluxe Ocean', 20000.00, 2)
      RETURNING room_type_id;
    `);
    const typeId = rtRes.rows[0].room_type_id;

    // Service
    const sRes = await client.query(`
      INSERT INTO service (name, category, current_price, active)
      VALUES ('Buffet Dinner', 'FOOD', 5000.00, true)
      RETURNING service_id;
    `);
    const serviceId = sRes.rows[0].service_id;

    // =========================================================================
    // Scenario 1: Missing-Policy Rollback
    // =========================================================================
    await t.test('Scenario 1: Missing-policy rollback during booking confirmation', async () => {
      // With NO billing policies in the table
      const bRes = await client.query(`
        INSERT INTO booking (booking_ref, booking_channel, guest_id, created_by)
        VALUES ('REF-MISSING-POLICY', 'FRONT_DESK', $1, $2)
        RETURNING booking_id;
      `, [guestId, userId]);
      const bId = bRes.rows[0].booking_id;

      let rollbackPassed = false;
      try {
        await client.query('BEGIN');
        await client.query(`
          INSERT INTO booking_room_line (booking_id, stay_start_date, stay_end_date, guest_count, rate_snapshot, status)
          VALUES ($1, CURRENT_DATE + 5, CURRENT_DATE + 7, 2, 20000.00, 'BOOKED');
        `, [bId]);

        // Attempt hook
        await client.query('SELECT fn_create_booking_draft_invoice($1, $2)', [bId, userId]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        rollbackPassed = true;
        assert.match(err.message, /No applicable billing policy found/);
      }
      assert.ok(rollbackPassed, 'Must throw exception and rollback when billing policy is missing');

      // Verify no invoice was created for bId
      const checkInv = await client.query('SELECT * FROM invoice WHERE booking_id = $1', [bId]);
      assert.equal(checkInv.rows.length, 0, 'No invoice should exist after rollback');
    });

    // Seed Billing Policy
    const polRes = await client.query(`
      INSERT INTO billing_policy (
        effective_from, tax_percent, service_charge_percent, max_discount_percent,
        cancellation_fee, no_show_fee, late_checkout_fee, no_show_grace_days,
        is_demo, created_by
      ) VALUES (
        CURRENT_DATE - 1, 10.00, 5.00, 20.00,
        1500.00, 3000.00, 2500.00, 1,
        false, $1
      ) RETURNING billing_policy_id;
    `, [cmUserId]);
    const policyId = polRes.rows[0].billing_policy_id;

    // =========================================================================
    // Scenario 2: Audited DRAFT Invoice Creation (Booking-Confirmation Hook)
    // =========================================================================
    let booking1Id;
    let line1Id;
    let invoice1Id;

    await t.test('Scenario 2: Booking-confirmation hook creates audited DRAFT invoice with lines', async () => {
      const bRes = await client.query(`
        INSERT INTO booking (booking_ref, booking_channel, guest_id, created_by)
        VALUES ('REF-CONFIRM-001', 'FRONT_DESK', $1, $2)
        RETURNING booking_id;
      `, [guestId, userId]);
      booking1Id = bRes.rows[0].booking_id;

      const lRes = await client.query(`
        INSERT INTO booking_room_line (booking_id, stay_start_date, stay_end_date, guest_count, rate_snapshot, status)
        VALUES ($1, CURRENT_DATE + 1, CURRENT_DATE + 3, 2, 20000.00, 'BOOKED')
        RETURNING line_id;
      `, [booking1Id]);
      line1Id = lRes.rows[0].line_id;

      // Call hook
      const hookRes = await client.query('SELECT fn_create_booking_draft_invoice($1, $2) AS invoice_id', [booking1Id, userId]);
      invoice1Id = hookRes.rows[0].invoice_id;
      assert.ok(invoice1Id, 'Must return generated invoice_id');

      // Check invoice row
      const invRow = (await client.query('SELECT * FROM invoice WHERE invoice_id = $1', [invoice1Id])).rows[0];
      assert.equal(invRow.status, 'DRAFT', 'Initial status must be DRAFT');
      assert.equal(invRow.invoice_number, null, 'invoice_number must be NULL for DRAFT');
      assert.equal(invRow.issued_at, null, 'issued_at must be NULL for DRAFT');
      assert.equal(invRow.billing_policy_id, policyId, 'Must link to effective billing policy');

      // Check audit_log
      const auditRes = await client.query(`
        SELECT * FROM audit_log
         WHERE entity_name = 'invoice' AND entity_id = $1 AND action = 'CREATE';
      `, [invoice1Id]);
      assert.equal(auditRes.rows.length, 1, 'Invoice creation must be logged to audit_log');
      assert.equal(auditRes.rows[0].user_id, userId, 'Audit log user_id must match recording user');

      // Check lines created: 2 nights @ 20,000 = 40,000 room charge
      // Service charge 5% on 40,000 = 2,000
      // Tax 10% on (40,000 + 2,000) = 4,200
      // Total = 46,200.00
      const lines = (await client.query('SELECT * FROM invoice_line WHERE invoice_id = $1 ORDER BY amount DESC', [invoice1Id])).rows;
      assert.equal(lines.length, 3, 'Must create ROOM, SERVICE_CHARGE, and TAX lines');
      const roomLine = lines.find((l) => l.line_type === 'ROOM');
      assert.equal(Number(roomLine.amount), 40000.00);
      assert.equal(roomLine.booking_room_line_id, line1Id);

      const scLine = lines.find((l) => l.line_type === 'PERCENT_SERVICE_CHARGE');
      assert.equal(Number(scLine.amount), 2000.00);

      const taxLine = lines.find((l) => l.line_type === 'TAX');
      assert.equal(Number(taxLine.amount), 4200.00);
    });

    // =========================================================================
    // Scenario 3: Idempotent Retry Behavior
    // =========================================================================
    await t.test('Scenario 3: Retry behavior is idempotent and returns existing DRAFT invoice', async () => {
      const retryRes = await client.query('SELECT fn_create_booking_draft_invoice($1, $2) AS invoice_id', [booking1Id, userId]);
      assert.equal(retryRes.rows[0].invoice_id, invoice1Id, 'Retry must return the same invoice_id');

      const countRes = await client.query('SELECT count(*) FROM invoice WHERE booking_id = $1', [booking1Id]);
      assert.equal(Number(countRes.rows[0].count), 1, 'Only one invoice record must exist for the booking');
    });

    // =========================================================================
    // Scenario 4: Duplicate Invoice Prevention
    // =========================================================================
    await t.test('Scenario 4: Direct duplicate invoice creation fails unique constraint', async () => {
      let threw = false;
      try {
        await client.query('INSERT INTO invoice (booking_id, billing_policy_id) VALUES ($1, $2)', [booking1Id, policyId]);
      } catch (err) {
        threw = true;
        assert.equal(err.code, '23505', 'Must fail with unique_violation (23505)');
      }
      assert.ok(threw, 'Direct duplicate invoice creation must fail');
    });

    // =========================================================================
    // Scenario 5: Later Draft Charges & Refresh
    // =========================================================================
    await t.test('Scenario 5: Later draft charges update lines and draft total on refresh', async () => {
      // Add a service usage (Buffet dinner 2 @ 5,000 = 10,000)
      await client.query(`
        INSERT INTO service_usage (booking_id, service_id, booking_room_line_id, quantity, unit_price_snapshot, voided, recorded_by)
        VALUES ($1, $2, $3, 2, 5000.00, false, $4);
      `, [booking1Id, serviceId, line1Id, userId]);

      // Refresh draft invoice
      await client.query('SELECT fn_refresh_draft_invoice($1, $2)', [booking1Id, userId]);

      // Gross = Room 40,000 + Service 10,000 = 50,000
      // SC 5% on 50,000 = 2,500
      // Tax 10% on 52,500 = 5,250
      // Total = 57,750.00
      const lines = (await client.query('SELECT * FROM invoice_line WHERE invoice_id = $1', [invoice1Id])).rows;
      assert.equal(lines.length, 4, 'Must now have 4 lines including SERVICE');

      const serviceLine = lines.find((l) => l.line_type === 'SERVICE');
      assert.equal(Number(serviceLine.amount), 10000.00);

      const balRes = (await client.query('SELECT * FROM fn_booking_balance($1)', [booking1Id])).rows[0];
      assert.equal(Number(balRes.total_amount), 57750.00, 'Total amount must reflect later draft charges');
      assert.equal(Number(balRes.balance), 57750.00);
      assert.equal(balRes.is_settled, false);
    });

    // =========================================================================
    // Scenario 6: Partial Checkout Keeps DRAFT (Cannot finalize)
    // =========================================================================
    let booking2Id;
    let line2A;
    let line2B;

    await t.test('Scenario 6: Partial checkout keeps invoice in DRAFT', async () => {
      const bRes = await client.query(`
        INSERT INTO booking (booking_ref, booking_channel, guest_id, created_by)
        VALUES ('REF-TWO-ROOM-002', 'FRONT_DESK', $1, $2)
        RETURNING booking_id;
      `, [guestId, userId]);
      booking2Id = bRes.rows[0].booking_id;

      // Two rooms
      const l1 = await client.query(`
        INSERT INTO booking_room_line (booking_id, stay_start_date, stay_end_date, guest_count, rate_snapshot, status)
        VALUES ($1, CURRENT_DATE, CURRENT_DATE + 2, 1, 10000.00, 'CHECKED_OUT')
        RETURNING line_id;
      `, [booking2Id]);
      line2A = l1.rows[0].line_id;

      const l2 = await client.query(`
        INSERT INTO booking_room_line (booking_id, stay_start_date, stay_end_date, guest_count, rate_snapshot, status)
        VALUES ($1, CURRENT_DATE, CURRENT_DATE + 2, 1, 10000.00, 'CHECKED_IN')
        RETURNING line_id;
      `, [booking2Id]);
      line2B = l2.rows[0].line_id;

      // Hook
      await client.query('SELECT fn_create_booking_draft_invoice($1, $2)', [booking2Id, userId]);

      // Pay the full balance
      const bal = (await client.query('SELECT * FROM fn_booking_balance($1)', [booking2Id])).rows[0];
      await client.query(`
        INSERT INTO payment (booking_id, recorded_by, kind, amount, method, status, reference)
        VALUES ($1, $2, 'PAYMENT', $3, 'CASH', 'SUCCESSFUL', 'PAY-PARTIAL-SETTLED');
      `, [booking2Id, userId, bal.total_amount]);

      // Verify balance is 0.00
      const checkBal = (await client.query('SELECT * FROM fn_booking_balance($1)', [booking2Id])).rows[0];
      assert.equal(Number(checkBal.balance), 0.00);

      // Attempt to issue FINAL invoice while line2B is CHECKED_IN
      let threw = false;
      try {
        await client.query('SELECT * FROM fn_issue_final_invoice($1, $2)', [booking2Id, userId]);
      } catch (err) {
        threw = true;
        assert.match(err.message, /Partial checkout keeps invoice in DRAFT/);
      }
      assert.ok(threw, 'Must block FINAL issuance when active room lines remain');

      const invCheck = (await client.query('SELECT status FROM invoice WHERE booking_id = $1', [booking2Id])).rows[0];
      assert.equal(invCheck.status, 'DRAFT', 'Invoice must remain DRAFT');
    });

    // =========================================================================
    // Scenario 7: Balance Gate on Final Issuance (Unpaid Balance)
    // =========================================================================
    await t.test('Scenario 7: Unpaid balance blocks FINAL issuance', async () => {
      // Mark line2B also terminal (CHECKED_OUT)
      await client.query(`UPDATE booking_room_line SET status = 'CHECKED_OUT' WHERE line_id = $1`, [line2B]);

      // Add another charge creating positive balance
      await client.query(`
        INSERT INTO service_usage (booking_id, service_id, booking_room_line_id, quantity, unit_price_snapshot, voided, recorded_by)
        VALUES ($1, $2, $3, 1, 5000.00, false, $4);
      `, [booking2Id, serviceId, line2B, userId]);

      let threw = false;
      try {
        await client.query('SELECT * FROM fn_issue_final_invoice($1, $2)', [booking2Id, userId]);
      } catch (err) {
        threw = true;
        assert.match(err.message, /outstanding balance of .* must be settled first/);
      }
      assert.ok(threw, 'Must block FINAL issuance when outstanding positive balance exists');
    });

    // =========================================================================
    // Scenario 8: Balance Gate on Final Issuance (Unrefunded Credit)
    // =========================================================================
    await t.test('Scenario 8: Unrefunded credit blocks FINAL issuance until refunded', async () => {
      // Overpay by 20,000 LKR
      await client.query(`
        INSERT INTO payment (booking_id, recorded_by, kind, amount, method, status, reference)
        VALUES ($1, $2, 'PAYMENT', 20000.00, 'CASH', 'SUCCESSFUL', 'PAY-OVERPAY');
      `, [booking2Id, userId]);

      let threw = false;
      try {
        await client.query('SELECT * FROM fn_issue_final_invoice($1, $2)', [booking2Id, userId]);
      } catch (err) {
        threw = true;
        assert.match(err.message, /credit balance of .* must be refunded first/);
      }
      assert.ok(threw, 'Must block FINAL issuance when credit exists');

      // Refresh draft to reflect the service usage added in Scenario 7
      await client.query('SELECT fn_refresh_draft_invoice($1)', [booking2Id]);

      // Issue refund to bring balance to exactly 0.00
      const bal = (await client.query('SELECT * FROM fn_booking_balance($1)', [booking2Id])).rows[0];
      const creditToRefund = -Number(bal.balance);
      assert.ok(creditToRefund > 0, 'Credit must be positive value to refund');

      await client.query(`
        INSERT INTO payment (booking_id, recorded_by, kind, amount, method, status, reference)
        VALUES ($1, $2, 'REFUND', $3, 'CASH', 'SUCCESSFUL', 'REFUND-CREDIT-001');
      `, [booking2Id, userId, creditToRefund]);

      const balAfterRefund = (await client.query('SELECT * FROM fn_booking_balance($1)', [booking2Id])).rows[0];
      assert.equal(Number(balAfterRefund.balance), 0.00, 'Balance must now be exactly zero');
    });

    // =========================================================================
    // Scenario 9: Single FINAL Issuance
    // =========================================================================
    let finalInvNum;
    await t.test('Scenario 9: Single FINAL invoice issuance succeeds when terminal and settled', async () => {
      const finalRes = await client.query('SELECT * FROM fn_issue_final_invoice($1, $2)', [booking2Id, userId]);
      assert.equal(finalRes.rows.length, 1);
      const row = finalRes.rows[0];
      assert.equal(row.status, 'FINAL');
      assert.match(row.invoice_number, /^INV-\d{8}-\d{5}$/, 'Invoice number must match sequential format');
      assert.ok(row.issued_at, 'issued_at must be populated');
      finalInvNum = row.invoice_number;

      // Verify audit_log STATUS_CHANGE
      const auditLog = (await client.query(`
        SELECT * FROM audit_log
         WHERE entity_name = 'invoice' AND action = 'STATUS_CHANGE'
         ORDER BY changed_at DESC LIMIT 1;
      `)).rows[0];
      assert.ok(auditLog, 'STATUS_CHANGE must be logged');
      const afterVal = JSON.parse(auditLog.after_value);
      assert.equal(afterVal.status, 'FINAL');
      assert.equal(afterVal.invoice_number, finalInvNum);
    });

    // =========================================================================
    // Scenario 10: Immutable FINAL Lines and Invoice
    // =========================================================================
    await t.test('Scenario 10: Immutable FINAL invoice and lines prevent all mutations', async () => {
      const inv = (await client.query('SELECT invoice_id FROM invoice WHERE booking_id = $1', [booking2Id])).rows[0];

      // 1. Insert line into FINAL invoice fails
      let threw = false;
      try {
        await client.query(`
          INSERT INTO invoice_line (invoice_id, line_type, description, amount)
          VALUES ($1, 'TAX', 'Late tax', 500.00);
        `, [inv.invoice_id]);
      } catch (err) {
        threw = true;
        assert.match(err.message, /Invoice is FINAL/);
      }
      assert.ok(threw, 'Cannot INSERT line into FINAL invoice');

      // 2. Update line on FINAL invoice fails
      threw = false;
      try {
        await client.query(`
          UPDATE invoice_line SET amount = 99999.00 WHERE invoice_id = $1;
        `, [inv.invoice_id]);
      } catch (err) {
        threw = true;
        assert.match(err.message, /Invoice is FINAL/);
      }
      assert.ok(threw, 'Cannot UPDATE line on FINAL invoice');

      // 3. Delete line on FINAL invoice fails
      threw = false;
      try {
        await client.query(`
          DELETE FROM invoice_line WHERE invoice_id = $1;
        `, [inv.invoice_id]);
      } catch (err) {
        threw = true;
        assert.match(err.message, /Invoice is FINAL/);
      }
      assert.ok(threw, 'Cannot DELETE line on FINAL invoice');

      // 4. Update FINAL invoice row fails
      threw = false;
      try {
        await client.query(`
          UPDATE invoice SET status = 'DRAFT' WHERE invoice_id = $1;
        `, [inv.invoice_id]);
      } catch (err) {
        threw = true;
        assert.match(err.message, /Cannot modify FINAL invoice/);
      }
      assert.ok(threw, 'Cannot UPDATE FINAL invoice row');

      // 5. Delete FINAL invoice row fails
      threw = false;
      try {
        await client.query(`
          DELETE FROM invoice WHERE invoice_id = $1;
        `, [inv.invoice_id]);
      } catch (err) {
        threw = true;
        assert.match(err.message, /Cannot delete FINAL invoice/);
      }
      assert.ok(threw, 'Cannot DELETE FINAL invoice row');

      // 6. Refreshing FINAL invoice fails
      threw = false;
      try {
        await client.query('SELECT fn_refresh_draft_invoice($1)', [booking2Id]);
      } catch (err) {
        threw = true;
        assert.match(err.message, /is FINAL. Cannot refresh lines/);
      }
      assert.ok(threw, 'Cannot refresh FINAL invoice');

      // 7. Issuing FINAL again fails
      threw = false;
      try {
        await client.query('SELECT * FROM fn_issue_final_invoice($1)', [booking2Id]);
      } catch (err) {
        threw = true;
        assert.match(err.message, /is already FINAL/);
      }
      assert.ok(threw, 'Cannot re-finalize already FINAL invoice');
    });

    // =========================================================================
    // Scenario 11: Unique Invoice Numbers
    // =========================================================================
    await t.test('Scenario 11: Consecutive FINAL invoices receive distinct sequential numbers', async () => {
      // Settle booking1 and finalize it
      // First, set line to terminal
      await client.query(`UPDATE booking_room_line SET status = 'CHECKED_OUT' WHERE booking_id = $1`, [booking1Id]);
      const bal1 = (await client.query('SELECT * FROM fn_booking_balance($1)', [booking1Id])).rows[0];
      await client.query(`
        INSERT INTO payment (booking_id, recorded_by, kind, amount, method, status, reference)
        VALUES ($1, $2, 'PAYMENT', $3, 'BANK_TRANSFER', 'SUCCESSFUL', 'PAY-SETTLE-B1');
      `, [booking1Id, userId, bal1.total_amount]);

      const final1Res = await client.query('SELECT * FROM fn_issue_final_invoice($1, $2)', [booking1Id, userId]);
      const num1 = final1Res.rows[0].invoice_number;
      assert.notEqual(num1, finalInvNum, 'Each finalized invoice must have a distinct unique number');
    });

  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${scratchSchema} CASCADE`);
    await client.end();
  }
});
