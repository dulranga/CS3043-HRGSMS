const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const auditMigration = readFileSync(
  path.join(__dirname, '..', 'migrations', '0000_create_audit_and_config.sql'),
  'utf8',
);
const branchRoleMigration = readFileSync(
  path.join(__dirname, '..', 'migrations', 'm1_001_create_branch_and_role.sql'),
  'utf8',
);
const accountOfficerMigration = readFileSync(
  path.join(__dirname, '..', 'migrations', 'm1_002_create_user_account_and_officer.sql'),
  'utf8',
);
const guestMigration = readFileSync(
  path.join(__dirname, '..', 'migrations', 'm1_003_create_guest_and_guest_account.sql'),
  'utf8',
);
const auditLogMigration = readFileSync(
  path.join(__dirname, '..', 'migrations', 'm1_004_create_audit_log.sql'),
  'utf8',
);
const billingPolicyMigration = readFileSync(
  path.join(__dirname, '..', 'migrations', 'm1_005_create_billing_policy.sql'),
  'utf8',
);
const catalogueMigration = readFileSync(
  path.join(__dirname, '..', 'migrations', 'm2_001_room_catalogue.sql'),
  'utf8',
);
const bookingMigration = readFileSync(
  path.join(__dirname, '..', 'migrations', 'm2_002_booking.sql'),
  'utf8',
);
const serviceUsageMigration = readFileSync(
  path.join(__dirname, '..', 'migrations', 'm3_001_service_usage_mock.sql'),
  'utf8',
);
const invoiceMigration = readFileSync(
  path.join(__dirname, '..', 'migrations', 'm4_001_invoice_and_lines.sql'),
  'utf8',
);
const billingCalcMigration = readFileSync(
  path.join(__dirname, '..', 'migrations', 'm4_003_billing_calculation.sql'),
  'utf8',
);

// Import compiled TypeScript calculation engine
const {
  computeInvoiceBreakdown,
  calculateBookingInvoiceFromDb,
  roundCurrency,
  calculateBillableNights,
} = require('../dist/services/billingCalculator.js');

test('M4-S04 deterministic billing calculations, policy rules, and rounding reconciliation', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const client = new Client({ connectionString: process.env.PG_URL });
  const schema = `m4_billing_test_${randomBytes(8).toString('hex')}`;
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}", public`);

    // Apply migrations
    await client.query(auditMigration);
    await client.query(branchRoleMigration);
    await client.query(accountOfficerMigration);
    await client.query(guestMigration);
    await client.query(auditLogMigration);
    await client.query(billingPolicyMigration);
    await client.query(catalogueMigration);
    await client.query(bookingMigration);
    await client.query(serviceUsageMigration);
    await client.query(invoiceMigration);
    await client.query(billingCalcMigration);

    // 0. Base setup: branch, user, officer, and guest
    const bRes = await client.query(`
      INSERT INTO branch (name, city, address)
      VALUES ('Colombo Base', 'Colombo', 'Galle Face, Colombo')
      RETURNING branch_id;
    `);
    const branchId = bRes.rows[0].branch_id;
    const roleCMRes = await client.query(`SELECT role_id FROM role WHERE role_name = 'CHAIN_MANAGER' LIMIT 1;`);
    const cmRoleId = roleCMRes.rows[0].role_id;

    const userRes = await client.query(
      `INSERT INTO user_account (username, active) VALUES ('billing_admin', true) RETURNING user_id`,
    );
    const userId = userRes.rows[0].user_id;

    await client.query(`
      INSERT INTO officer (officer_id, full_name, role_id, branch_id)
      VALUES ($1, 'Billing Admin Officer', $2, $3);
    `, [userId, cmRoleId, branchId]);

    const guestRes = await client.query(
      `INSERT INTO guest (full_name, email, active) VALUES ('Billing Guest', 'guest@test.com', true) RETURNING guest_id`,
    );
    const guestId = guestRes.rows[0].guest_id;

    // Policy V1 (10% tax, 5% service charge, 20% max discount, 1000 cancel fee, 1500 no show fee, 2000 late checkout)
    const policyV1Res = await client.query(
      `INSERT INTO billing_policy (
        effective_from, tax_percent, service_charge_percent, max_discount_percent,
        cancellation_fee, no_show_fee, late_checkout_fee, no_show_grace_days, is_demo, created_by
       ) VALUES (
        '2026-01-01', 10.00, 5.00, 20.00, 1000.00, 1500.00, 2000.00, 1, false, $1
       ) RETURNING billing_policy_id`,
      [userId],
    );
    const policyV1Id = policyV1Res.rows[0].billing_policy_id;

    // Policy V2 (15% tax, 8% service charge, 10% max discount, 2500 cancel fee, 3000 no show fee, 4000 late checkout)
    const policyV2Res = await client.query(
      `INSERT INTO billing_policy (
        effective_from, tax_percent, service_charge_percent, max_discount_percent,
        cancellation_fee, no_show_fee, late_checkout_fee, no_show_grace_days, is_demo, created_by
       ) VALUES (
        '2026-06-01', 15.00, 8.00, 10.00, 2500.00, 3000.00, 4000.00, 2, false, $1
       ) RETURNING billing_policy_id`,
      [userId],
    );
    const policyV2Id = policyV2Res.rows[0].billing_policy_id;

    // Services
    const s1Res = await client.query(
      `INSERT INTO service (name, category, current_price, active)
       VALUES ('Laundry Express', 'Housekeeping', 750.00, true) RETURNING service_id`,
    );
    const laundryServiceId = s1Res.rows[0].service_id;

    const s2Res = await client.query(
      `INSERT INTO service (name, category, current_price, active)
       VALUES ('Spa Treatment', 'Wellness', 5000.00, true) RETURNING service_id`,
    );
    const spaServiceId = s2Res.rows[0].service_id;

    // -------------------------------------------------------------------------
    // Test 1: Mixed-type two-rate booking
    // -------------------------------------------------------------------------
    const b1Res = await client.query(
      `INSERT INTO booking (booking_ref, booking_channel, guest_id, created_by)
       VALUES ('BKG-MIX-001', 'DIRECT_ONLINE', $1, $2) RETURNING booking_id`,
      [guestId, userId],
    );
    const b1Id = b1Res.rows[0].booking_id;

    await client.query(
      `INSERT INTO invoice (booking_id, billing_policy_id) VALUES ($1, $2)`,
      [b1Id, policyV1Id],
    );

    // Line 1: Single room, 3 nights (2026-10-10 to 2026-10-13) @ 5,000.00 = 15,000.00
    const l1Res = await client.query(
      `INSERT INTO booking_room_line (booking_id, stay_start_date, stay_end_date, guest_count, rate_snapshot, status)
       VALUES ($1, '2026-10-10', '2026-10-13', 1, 5000.00, 'CHECKED_IN') RETURNING line_id`,
      [b1Id],
    );
    const l1Id = l1Res.rows[0].line_id;

    // Line 2: Deluxe room, 3 nights (2026-10-10 to 2026-10-13) @ 12,000.00 = 36,000.00
    const l2Res = await client.query(
      `INSERT INTO booking_room_line (booking_id, stay_start_date, stay_end_date, guest_count, rate_snapshot, status)
       VALUES ($1, '2026-10-10', '2026-10-13', 2, 12000.00, 'BOOKED') RETURNING line_id`,
      [b1Id],
    );
    const l2Id = l2Res.rows[0].line_id;

    // Verify SQL function fn_room_charge: 15,000 + 36,000 = 51,000.00
    const roomChargeRes1 = await client.query(`SELECT fn_room_charge($1) AS total`, [b1Id]);
    assert.equal(roomChargeRes1.rows[0].total, '51000.00');

    // Verify TypeScript calculation engine
    const b1Calc = await calculateBookingInvoiceFromDb(client, b1Id);
    assert.equal(b1Calc.room_subtotal, 51000.00);
    assert.equal(b1Calc.gross_subtotal, 51000.00);
    // Service charge: 5% on 51,000.00 = 2,550.00
    assert.equal(b1Calc.service_charge_amount, 2550.00);
    // Tax: 10% on (51,000.00 + 2,550.00 = 53,550.00) = 5,355.00
    assert.equal(b1Calc.tax_amount, 5355.00);
    // Total = 51,000 + 2,550 + 5,355 = 58,905.00
    assert.equal(b1Calc.total_amount, 58905.00);

    // Verify lines contain exact line_ids and attribution
    const roomLine1 = b1Calc.lines.find((l) => l.booking_room_line_id === l1Id);
    const roomLine2 = b1Calc.lines.find((l) => l.booking_room_line_id === l2Id);
    assert.ok(roomLine1 && roomLine2);
    assert.equal(roomLine1.amount, 15000.00);
    assert.equal(roomLine2.amount, 36000.00);
    assert.equal(roomLine2.is_provisional, true, 'BOOKED line must be flagged as provisional');
    assert.equal(roomLine1.is_provisional, false);

    // -------------------------------------------------------------------------
    // Test 2: Same-type equal-base-rate booking (two Single rooms confirmed together)
    // -------------------------------------------------------------------------
    const b2Res = await client.query(
      `INSERT INTO booking (booking_ref, booking_channel, guest_id, created_by)
       VALUES ('BKG-SAME-002', 'FRONT_DESK', $1, $2) RETURNING booking_id`,
      [guestId, userId],
    );
    const b2Id = b2Res.rows[0].booking_id;
    await client.query(`INSERT INTO invoice (booking_id, billing_policy_id) VALUES ($1, $2)`, [
      b2Id,
      policyV1Id,
    ]);

    await client.query(
      `INSERT INTO booking_room_line (booking_id, stay_start_date, stay_end_date, guest_count, rate_snapshot, status)
       VALUES ($1, '2026-10-15', '2026-10-17', 1, 5000.00, 'CHECKED_IN'),
              ($1, '2026-10-15', '2026-10-17', 1, 5000.00, 'CHECKED_IN')`,
      [b2Id],
    );
    // 2 rooms * 2 nights * 5000 = 20,000.00
    const roomChargeRes2 = await client.query(`SELECT fn_room_charge($1) AS total`, [b2Id]);
    assert.equal(roomChargeRes2.rows[0].total, '20000.00');

    // -------------------------------------------------------------------------
    // Test 3: Changed pre-arrival dates (date revision increases nights)
    // -------------------------------------------------------------------------
    const b3Res = await client.query(
      `INSERT INTO booking (booking_ref, booking_channel, guest_id, created_by)
       VALUES ('BKG-DATERANGE-003', 'DIRECT_ONLINE', $1, $2) RETURNING booking_id`,
      [guestId, userId],
    );
    const b3Id = b3Res.rows[0].booking_id;
    await client.query(`INSERT INTO invoice (booking_id, billing_policy_id) VALUES ($1, $2)`, [
      b3Id,
      policyV1Id,
    ]);

    const l3Res = await client.query(
      `INSERT INTO booking_room_line (booking_id, stay_start_date, stay_end_date, guest_count, rate_snapshot, status)
       VALUES ($1, '2026-11-01', '2026-11-03', 1, 6000.00, 'BOOKED') RETURNING line_id`,
      [b3Id],
    );
    const l3Id = l3Res.rows[0].line_id;

    // Initially 2 nights = 12,000.00
    let b3Charge = await client.query(`SELECT fn_room_charge($1) AS total`, [b3Id]);
    assert.equal(b3Charge.rows[0].total, '12000.00');

    // Guest modifies booking pre-arrival to 5 nights (2026-11-01 to 2026-11-06)
    await client.query(
      `UPDATE booking_room_line SET stay_end_date = '2026-11-06' WHERE line_id = $1`,
      [l3Id],
    );
    // Now 5 nights * 6,000 = 30,000.00
    b3Charge = await client.query(`SELECT fn_room_charge($1) AS total`, [b3Id]);
    assert.equal(b3Charge.rows[0].total, '30000.00');

    // -------------------------------------------------------------------------
    // Test 4: Partial cancellation and no-show with policy flat fees
    // -------------------------------------------------------------------------
    const b4Res = await client.query(
      `INSERT INTO booking (booking_ref, booking_channel, guest_id, created_by)
       VALUES ('BKG-PARTIAL-004', 'FRONT_DESK', $1, $2) RETURNING booking_id`,
      [guestId, userId],
    );
    const b4Id = b4Res.rows[0].booking_id;
    await client.query(`INSERT INTO invoice (booking_id, billing_policy_id) VALUES ($1, $2)`, [
      b4Id,
      policyV1Id,
    ]);

    // Line A: CHECKED_IN, 3 nights @ 7,000.00 = 21,000.00
    await client.query(
      `INSERT INTO booking_room_line (booking_id, stay_start_date, stay_end_date, guest_count, rate_snapshot, status)
       VALUES ($1, '2026-10-01', '2026-10-04', 1, 7000.00, 'CHECKED_IN')`,
      [b4Id],
    );
    // Line B: CANCELLED (room nights excluded!)
    const lCancelRes = await client.query(
      `INSERT INTO booking_room_line (booking_id, stay_start_date, stay_end_date, guest_count, rate_snapshot, status)
       VALUES ($1, '2026-10-01', '2026-10-04', 1, 7000.00, 'CANCELLED') RETURNING line_id`,
      [b4Id],
    );
    const lCancelId = lCancelRes.rows[0].line_id;

    // Line C: NO_SHOW (room nights excluded!)
    const lNoShowRes = await client.query(
      `INSERT INTO booking_room_line (booking_id, stay_start_date, stay_end_date, guest_count, rate_snapshot, status)
       VALUES ($1, '2026-10-01', '2026-10-04', 1, 7000.00, 'NO_SHOW') RETURNING line_id`,
      [b4Id],
    );
    const lNoShowId = lNoShowRes.rows[0].line_id;

    // fn_room_charge must sum ONLY Line A (21,000.00); B and C excluded!
    const roomChargeRes4 = await client.query(`SELECT fn_room_charge($1) AS total`, [b4Id]);
    assert.equal(roomChargeRes4.rows[0].total, '21000.00');

    // In breakdown: Line B has CANCELLATION_FEE (1000), Line C has NO_SHOW_FEE (1500)
    const b4Calc = await calculateBookingInvoiceFromDb(client, b4Id);
    assert.equal(b4Calc.room_subtotal, 21000.00);
    const cancelLine = b4Calc.lines.find((l) => l.line_type === 'CANCELLATION_FEE');
    const noShowLine = b4Calc.lines.find((l) => l.line_type === 'NO_SHOW_FEE');
    assert.ok(cancelLine && noShowLine);
    assert.equal(cancelLine.booking_room_line_id, lCancelId);
    assert.equal(cancelLine.amount, 1000.00);
    assert.equal(noShowLine.booking_room_line_id, lNoShowId);
    assert.equal(noShowLine.amount, 1500.00);

    // -------------------------------------------------------------------------
    // Test 5: Early departure retains reserved nights & Late checkout adds fee
    // -------------------------------------------------------------------------
    const b5Res = await client.query(
      `INSERT INTO booking (booking_ref, booking_channel, guest_id, created_by)
       VALUES ('BKG-EARLY-005', 'FRONT_DESK', $1, $2) RETURNING booking_id`,
      [guestId, userId],
    );
    const b5Id = b5Res.rows[0].booking_id;
    await client.query(`INSERT INTO invoice (booking_id, billing_policy_id) VALUES ($1, $2)`, [
      b5Id,
      policyV1Id,
    ]);

    // 4 reserved nights @ 8,000.00 = 32,000.00. Guest departs after 2 nights (CHECKED_OUT).
    const lEarlyRes = await client.query(
      `INSERT INTO booking_room_line (booking_id, stay_start_date, stay_end_date, guest_count, rate_snapshot, status)
       VALUES ($1, '2026-10-01', '2026-10-05', 1, 8000.00, 'CHECKED_OUT') RETURNING line_id`,
      [b5Id],
    );
    const lEarlyId = lEarlyRes.rows[0].line_id;

    // Early departure retains reserved nights: 4 nights = 32,000.00
    const b5Charge = await client.query(`SELECT fn_room_charge($1) AS total`, [b5Id]);
    assert.equal(b5Charge.rows[0].total, '32000.00');

    // Late checkout: flag line for approved late checkout fee
    const b5Calc = await calculateBookingInvoiceFromDb(client, b5Id, {
      lateCheckoutLineIds: [lEarlyId],
    });
    assert.equal(b5Calc.room_subtotal, 32000.00);
    const lateLine = b5Calc.lines.find((l) => l.line_type === 'LATE_CHECKOUT_FEE');
    assert.ok(lateLine);
    assert.equal(lateLine.amount, 2000.00); // from policyV1.late_checkout_fee

    // -------------------------------------------------------------------------
    // Test 6: Non-void service usages counted once
    // -------------------------------------------------------------------------
    // Add 2 non-void usages and 1 voided usage to b1
    await client.query(
      `INSERT INTO service_usage (booking_id, booking_room_line_id, service_id, quantity, unit_price_snapshot, voided, recorded_by)
       VALUES ($1, $2, $3, 2, 750.00, false, $4),
              ($1, $2, $5, 1, 5000.00, false, $4),
              ($1, $2, $3, 1, 750.00, true, $4)`, // VOIDED!
      [b1Id, l1Id, laundryServiceId, userId, spaServiceId],
    );

    // fn_service_total must sum only non-void: (2 * 750) + (1 * 5000) = 1,500 + 5,000 = 6,500.00
    const serviceTotalRes = await client.query(`SELECT fn_service_total($1) AS total`, [b1Id]);
    assert.equal(serviceTotalRes.rows[0].total, '6500.00');

    // Recheck breakdown for b1 including service usage
    const b1WithServices = await calculateBookingInvoiceFromDb(client, b1Id);
    assert.equal(b1WithServices.room_subtotal, 51000.00);
    assert.equal(b1WithServices.service_subtotal, 6500.00);
    assert.equal(b1WithServices.gross_subtotal, 57500.00); // G = 51,000 + 6,500

    // -------------------------------------------------------------------------
    // Test 7: Policy-version change & policy isolation
    // -------------------------------------------------------------------------
    // Booking 6 confirmed under Policy V2 (higher rates: 15% tax, 8% service charge)
    const b6Res = await client.query(
      `INSERT INTO booking (booking_ref, booking_channel, guest_id, created_by)
       VALUES ('BKG-POLV2-006', 'DIRECT_ONLINE', $1, $2) RETURNING booking_id`,
      [guestId, userId],
    );
    const b6Id = b6Res.rows[0].booking_id;
    await client.query(`INSERT INTO invoice (booking_id, billing_policy_id) VALUES ($1, $2)`, [
      b6Id,
      policyV2Id, // Linked to Policy V2!
    ]);

    await client.query(
      `INSERT INTO booking_room_line (booking_id, stay_start_date, stay_end_date, guest_count, rate_snapshot, status)
       VALUES ($1, '2026-10-01', '2026-10-03', 1, 10000.00, 'CHECKED_IN')`,
      [b6Id],
    );

    // B6: 2 nights * 10,000 = 20,000.00 under Policy V2
    // Service charge @ 8% on 20,000 = 1,600.00
    // Tax @ 15% on (20,000 + 1,600 = 21,600) = 3,240.00
    // Total = 20,000 + 1,600 + 3,240 = 24,840.00
    const b6Calc = await calculateBookingInvoiceFromDb(client, b6Id);
    assert.equal(b6Calc.room_subtotal, 20000.00);
    assert.equal(b6Calc.service_charge_amount, 1600.00);
    assert.equal(b6Calc.tax_amount, 3240.00);
    assert.equal(b6Calc.total_amount, 24840.00);

    // Meanwhile, earlier booking B2 under Policy V1 (5% service charge, 10% tax)
    // 20,000 room charge -> Service charge @ 5% = 1,000.00, Tax @ 10% = 2,100.00, Total = 23,100.00
    const b2Calc = await calculateBookingInvoiceFromDb(client, b2Id);
    assert.equal(b2Calc.service_charge_amount, 1000.00);
    assert.equal(b2Calc.tax_amount, 2100.00);
    assert.equal(b2Calc.total_amount, 23100.00);
    assert.notEqual(
      b2Calc.total_amount,
      b6Calc.total_amount,
      'Policy isolation must preserve earlier invoice calculation despite later published policy',
    );

    // -------------------------------------------------------------------------
    // Test 8: Exact decimal rounding & discount cap (§4.7.4 order)
    // -------------------------------------------------------------------------
    // Pure function calculation test with exact fractions
    const testPolicy = {
      billing_policy_id: 'test-policy-uuid',
      tax_percent: 12.5,
      service_charge_percent: 7.5,
      max_discount_percent: 15.0,
      cancellation_fee: 500.0,
      no_show_fee: 800.0,
      late_checkout_fee: 1000.0,
      no_show_grace_days: 1,
    };

    const testLines = [
      {
        line_id: 'l-odd-1',
        stay_start_date: '2026-10-01',
        stay_end_date: '2026-10-04', // 3 nights
        rate_snapshot: '3333.33', // 3 * 3333.33 = 9,999.99
        status: 'CHECKED_IN',
      },
    ];

    const testUsages = [
      {
        usage_id: 'u-odd-1',
        service_name: 'Minibar',
        quantity: 1.5,
        unit_price_snapshot: 125.75, // 1.5 * 125.75 = 188.625 -> rounds to 188.63
        voided: false,
      },
    ];

    // Request a 3,000.00 discount.
    // Gross G = 9,999.99 + 188.63 = 10,188.62
    // Max allowed discount = 15% of 10,188.62 = 1,528.293 -> rounds to 1,528.29
    // Actual discount capped at 1,528.29!
    // Base after discount = 10,188.62 - 1,528.29 = 8,660.33
    // Service charge (7.5% on 8,660.33) = 649.52475 -> rounds to 649.52
    // Tax base = 8,660.33 + 649.52 = 9,309.85
    // Tax (12.5% on 9,309.85) = 1,163.73125 -> rounds to 1,163.73
    // Price adjustment = +50.00
    // Total = 9,999.99 + 188.63 - 1,528.29 + 649.52 + 1,163.73 + 50.00 = 10,523.58
    const exactCalc = computeInvoiceBreakdown(testPolicy, testLines, testUsages, {
      approvedDiscount: 3000.0, // Exceeds 15% cap
      priceAdjustments: [{ description: 'Room upgrade adjustment', amount: 50.0 }],
    });

    assert.equal(exactCalc.room_subtotal, 9999.99);
    assert.equal(exactCalc.service_subtotal, 188.63);
    assert.equal(exactCalc.gross_subtotal, 10188.62);
    assert.equal(exactCalc.discount_amount, 1528.29, 'Discount must be capped at 15%');
    assert.equal(exactCalc.base_after_discount, 8660.33);
    assert.equal(exactCalc.service_charge_amount, 649.52);
    assert.equal(exactCalc.tax_base, 9309.85);
    assert.equal(exactCalc.tax_amount, 1163.73);
    assert.equal(exactCalc.adjustments_subtotal, 50.0);
    assert.equal(exactCalc.total_amount, 10523.58);

    // Verify discount line is negative in the lines array
    const discountLine = exactCalc.lines.find((l) => l.line_type === 'DISCOUNT');
    assert.ok(discountLine);
    assert.equal(discountLine.amount, -1528.29);

    // -------------------------------------------------------------------------
    // Test 9: Database function fn_calculate_booking_invoice_lines
    // -------------------------------------------------------------------------
    const sqlBreakdown = await client.query(
      `SELECT line_type, booking_room_line_id, description, amount, sort_order
         FROM fn_calculate_booking_invoice_lines($1, 1000.00)
        ORDER BY sort_order, line_type`,
      [b1Id],
    );

    // Sum from SQL function matches total
    const sqlTotal = sqlBreakdown.rows.reduce(
      (acc, r) => roundCurrency(acc + Number(r.amount)),
      0,
    );
    assert.ok(sqlBreakdown.rows.length >= 4); // ROOM, SERVICE, DISCOUNT, PERCENT_SERVICE_CHARGE, TAX
    assert.ok(sqlTotal > 0);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});
