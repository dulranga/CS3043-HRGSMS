const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const auditMigration = readFileSync(
  path.join(__dirname, '..', 'migrations', 'm1_004_create_audit_log.sql'),
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
const bookingMigration = readFileSync(
  path.join(__dirname, '..', 'migrations', 'm2_002_booking.sql'),
  'utf8',
);
const paymentMigration = readFileSync(
  path.join(__dirname, '..', 'migrations', 'm4_002_payment.sql'),
  'utf8',
);

async function expectSqlError(client, sql, values, code) {
  await client.query('SAVEPOINT expected_error');
  try {
    await assert.rejects(
      client.query(sql, values),
      (error) => {
        if (code && error.code !== code) {
          throw new Error(`Expected PostgreSQL error code ${code}, but got ${error.code} (${error.message})`);
        }
        return true;
      },
      `Expected PostgreSQL error ${code}`,
    );
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT expected_error');
    await client.query('RELEASE SAVEPOINT expected_error');
  }
}

test('M4-S03 payment schema, constraints, immutability, and audit in a clean isolated schema', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const client = new Client({ connectionString: process.env.PG_URL });
  const schema = `m4_payment_test_${randomBytes(8).toString('hex')}`;
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);

    // Apply prerequisites and target migration
    await client.query(branchRoleMigration);
    await client.query(accountOfficerMigration);
    await client.query(guestMigration);
    await client.query(auditMigration);
    await client.query(bookingMigration);
    await client.query(paymentMigration);

    // 1. Verify columns and data types in information_schema
    const columns = await client.query(
      `SELECT column_name, data_type, udt_name, numeric_precision, numeric_scale, is_nullable
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'payment'
        ORDER BY ordinal_position`,
      [schema],
    );

    const columnMap = new Map(columns.rows.map((row) => [row.column_name, row]));
    assert.deepEqual(
      Array.from(columnMap.keys()),
      [
        'payment_id',
        'booking_id',
        'recorded_by',
        'kind',
        'amount',
        'method',
        'status',
        'reference',
        'paid_at',
        'recorded_at',
      ],
      'payment columns must match Table 40 plus target kind amendment',
    );

    assert.equal(columnMap.get('payment_id').data_type, 'uuid');
    assert.equal(columnMap.get('booking_id').data_type, 'uuid');
    assert.equal(columnMap.get('recorded_by').data_type, 'uuid');
    assert.equal(columnMap.get('kind').udt_name, 'payment_kind_enum');
    assert.equal(columnMap.get('amount').data_type, 'numeric');
    assert.equal(columnMap.get('amount').numeric_precision, 14);
    assert.equal(columnMap.get('amount').numeric_scale, 2);
    assert.equal(columnMap.get('method').udt_name, 'payment_method_enum');
    assert.equal(columnMap.get('status').udt_name, 'payment_status_enum');
    assert.equal(columnMap.get('reference').data_type, 'character varying');
    assert.equal(columnMap.get('paid_at').data_type, 'timestamp with time zone');
    assert.equal(columnMap.get('recorded_at').data_type, 'timestamp with time zone');

    // 2. Set up test actors and parent records
    const userRes = await client.query(
      `INSERT INTO user_account (username, active)
       VALUES ('staff_cashier_01', true)
       RETURNING user_id`,
    );
    const userId = userRes.rows[0].user_id;

    const guestRes = await client.query(
      `INSERT INTO guest (full_name, email, active)
       VALUES ('Alice Test Guest', 'alice@example.com', true)
       RETURNING guest_id`,
    );
    const guestId = guestRes.rows[0].guest_id;

    const bookingRes = await client.query(
      `INSERT INTO booking (booking_ref, booking_channel, guest_id, created_by)
       VALUES ('BKG-M4-001', 'FRONT_DESK', $1, $2)
       RETURNING booking_id`,
      [guestId, userId],
    );
    const bookingId = bookingRes.rows[0].booking_id;

    // 3. Test successful CASH PAYMENT insertion
    const payment1Res = await client.query(
      `INSERT INTO payment (booking_id, recorded_by, kind, amount, method, status, reference)
       VALUES ($1, $2, 'PAYMENT', 15000.00, 'CASH', 'SUCCESSFUL', 'REC-20261001-0001')
       RETURNING payment_id, kind, amount, method, status, reference,
                 (uuid_extract_version(payment_id) = 7) AS is_v7`,
      [bookingId, userId],
    );
    assert.equal(payment1Res.rows.length, 1);
    const p1 = payment1Res.rows[0];
    assert.equal(p1.is_v7, true, 'Default generated payment_id must be UUIDv7');
    assert.equal(p1.kind, 'PAYMENT');
    assert.equal(p1.amount, '15000.00');
    assert.equal(p1.method, 'CASH');
    assert.equal(p1.status, 'SUCCESSFUL');
    assert.equal(p1.reference, 'REC-20261001-0001');

    // Verify audit_log entry for p1
    const p1Audit = await client.query(
      `SELECT entity_name, entity_id, action, user_id, after_value
         FROM audit_log
        WHERE entity_name = 'payment' AND entity_id = $1`,
      [p1.payment_id],
    );
    assert.equal(p1Audit.rows.length, 1, 'Payment creation must be audited');
    assert.equal(p1Audit.rows[0].action, 'CREATE');
    assert.equal(p1Audit.rows[0].user_id, userId);

    // 4. Test successful BANK_TRANSFER REFUND insertion
    const refundRes = await client.query(
      `INSERT INTO payment (booking_id, recorded_by, kind, amount, method, status, reference)
       VALUES ($1, $2, 'REFUND', 2500.50, 'BANK_TRANSFER', 'SUCCESSFUL', 'BT-REF-998877')
       RETURNING payment_id, kind, amount, method, status`,
      [bookingId, userId],
    );
    assert.equal(refundRes.rows.length, 1);
    assert.equal(refundRes.rows[0].kind, 'REFUND');
    assert.equal(refundRes.rows[0].amount, '2500.50');
    assert.equal(refundRes.rows[0].method, 'BANK_TRANSFER');
    assert.equal(refundRes.rows[0].status, 'SUCCESSFUL');

    // 5. Test FAILED payment recording
    const failedRes = await client.query(
      `INSERT INTO payment (booking_id, recorded_by, kind, amount, method, status, reference)
       VALUES ($1, $2, 'PAYMENT', 8000.00, 'BANK_TRANSFER', 'FAILED', 'BT-FAIL-001')
       RETURNING payment_id, status`,
      [bookingId, userId],
    );
    assert.equal(failedRes.rows.length, 1);
    assert.equal(failedRes.rows[0].status, 'FAILED');

    // 6. Constraint checks: Invalid Kind
    await expectSqlError(
      client,
      `INSERT INTO payment (booking_id, recorded_by, kind, amount, method, reference)
       VALUES ($1, $2, 'CHARGE', 1000.00, 'CASH', 'REC-ERR-01')`,
      [bookingId, userId],
      '22P02', // invalid enum
    );
    await expectSqlError(
      client,
      `INSERT INTO payment (booking_id, recorded_by, kind, amount, method, reference)
       VALUES ($1, $2, NULL, 1000.00, 'CASH', 'REC-ERR-02')`,
      [bookingId, userId],
      '23502', // not-null violation
    );

    // 7. Constraint checks: Invalid Amount (<= 0, NaN, null)
    await expectSqlError(
      client,
      `INSERT INTO payment (booking_id, recorded_by, kind, amount, method, reference)
       VALUES ($1, $2, 'PAYMENT', 0.00, 'CASH', 'REC-ERR-03')`,
      [bookingId, userId],
      '23514', // check_violation
    );
    await expectSqlError(
      client,
      `INSERT INTO payment (booking_id, recorded_by, kind, amount, method, reference)
       VALUES ($1, $2, 'PAYMENT', -500.00, 'CASH', 'REC-ERR-04')`,
      [bookingId, userId],
      '23514', // check_violation
    );
    await expectSqlError(
      client,
      `INSERT INTO payment (booking_id, recorded_by, kind, amount, method, reference)
       VALUES ($1, $2, 'PAYMENT', 'NaN'::numeric, 'CASH', 'REC-ERR-05')`,
      [bookingId, userId],
      '23514', // check_violation
    );
    await expectSqlError(
      client,
      `INSERT INTO payment (booking_id, recorded_by, kind, amount, method, reference)
       VALUES ($1, $2, 'PAYMENT', NULL, 'CASH', 'REC-ERR-06')`,
      [bookingId, userId],
      '23502', // not-null violation
    );

    // 8. Constraint checks: Invalid Status
    await expectSqlError(
      client,
      `INSERT INTO payment (booking_id, recorded_by, kind, amount, method, status, reference)
       VALUES ($1, $2, 'PAYMENT', 1000.00, 'CASH', 'PENDING', 'REC-ERR-07')`,
      [bookingId, userId],
      '22P02', // invalid enum
    );

    // 9. Constraint checks: Invalid Method
    await expectSqlError(
      client,
      `INSERT INTO payment (booking_id, recorded_by, kind, amount, method, reference)
       VALUES ($1, $2, 'PAYMENT', 1000.00, 'CREDIT_CARD', 'REC-ERR-08')`,
      [bookingId, userId],
      '22P02', // invalid enum
    );

    // 10. Constraint checks: Missing or blank Reference
    await expectSqlError(
      client,
      `INSERT INTO payment (booking_id, recorded_by, kind, amount, method, reference)
       VALUES ($1, $2, 'PAYMENT', 1000.00, 'CASH', NULL)`,
      [bookingId, userId],
      '23502', // not-null violation
    );
    await expectSqlError(
      client,
      `INSERT INTO payment (booking_id, recorded_by, kind, amount, method, reference)
       VALUES ($1, $2, 'PAYMENT', 1000.00, 'CASH', '')`,
      [bookingId, userId],
      '23514', // check_violation (btrim(reference) <> '')
    );
    await expectSqlError(
      client,
      `INSERT INTO payment (booking_id, recorded_by, kind, amount, method, reference)
       VALUES ($1, $2, 'PAYMENT', 1000.00, 'CASH', '   ')`,
      [bookingId, userId],
      '23514', // check_violation (btrim(reference) <> '')
    );

    // 11. Constraint checks: Duplicate Reference
    await expectSqlError(
      client,
      `INSERT INTO payment (booking_id, recorded_by, kind, amount, method, reference)
       VALUES ($1, $2, 'PAYMENT', 5000.00, 'CASH', 'REC-20261001-0001')`,
      [bookingId, userId],
      '23505', // unique_violation
    );

    // 12. Foreign Key checks: Invalid booking_id or recorded_by
    await expectSqlError(
      client,
      `INSERT INTO payment (booking_id, recorded_by, kind, amount, method, reference)
       VALUES (uuidv7(), $1, 'PAYMENT', 1000.00, 'CASH', 'REC-ERR-FK1')`,
      [userId],
      '23503', // foreign_key_violation
    );
    await expectSqlError(
      client,
      `INSERT INTO payment (booking_id, recorded_by, kind, amount, method, reference)
       VALUES ($1, uuidv7(), 'PAYMENT', 1000.00, 'CASH', 'REC-ERR-FK2')`,
      [bookingId],
      '23503', // foreign_key_violation
    );

    // 13. UUID version check: Reject non-v7 UUID (e.g., UUIDv4 or nil)
    await expectSqlError(
      client,
      `INSERT INTO payment (payment_id, booking_id, recorded_by, kind, amount, method, reference)
       VALUES (gen_random_uuid(), $1, $2, 'PAYMENT', 1000.00, 'CASH', 'REC-ERR-V4')`,
      [bookingId, userId],
      '23514', // check_violation
    );
    await expectSqlError(
      client,
      `INSERT INTO payment (payment_id, booking_id, recorded_by, kind, amount, method, reference)
       VALUES ('00000000-0000-0000-0000-000000000000', $1, $2, 'PAYMENT', 1000.00, 'CASH', 'REC-ERR-NIL')`,
      [bookingId, userId],
      '23514', // check_violation
    );

    // 14. Reversal and Immutability checks:
    // 14a. Reversal of SUCCESSFUL payment p1 succeeds
    await client.query(
      `UPDATE payment SET status = 'REVERSED' WHERE payment_id = $1`,
      [p1.payment_id],
    );
    const p1Updated = await client.query(
      `SELECT status FROM payment WHERE payment_id = $1`,
      [p1.payment_id],
    );
    assert.equal(p1Updated.rows[0].status, 'REVERSED');

    // Verify audit log has REVERSE entry
    const p1ReverseAudit = await client.query(
      `SELECT entity_name, entity_id, action, before_value, after_value
         FROM audit_log
        WHERE entity_name = 'payment' AND entity_id = $1 AND action = 'REVERSE'`,
      [p1.payment_id],
    );
    assert.equal(p1ReverseAudit.rows.length, 1, 'Reversal must create an audit log entry');
    assert.ok(p1ReverseAudit.rows[0].before_value.includes('SUCCESSFUL'));
    assert.ok(p1ReverseAudit.rows[0].after_value.includes('REVERSED'));

    // 14b. Attempt to un-reverse (transition back from REVERSED to SUCCESSFUL or FAILED) fails
    await expectSqlError(
      client,
      `UPDATE payment SET status = 'SUCCESSFUL' WHERE payment_id = $1`,
      [p1.payment_id],
      '55000', // object_not_in_prerequisite_state
    );
    await expectSqlError(
      client,
      `UPDATE payment SET status = 'FAILED' WHERE payment_id = $1`,
      [p1.payment_id],
      '55000',
    );

    // 14c. Attempt to transition FAILED payment fails
    await expectSqlError(
      client,
      `UPDATE payment SET status = 'SUCCESSFUL' WHERE reference = 'BT-FAIL-001'`,
      [],
      '55000',
    );
    await expectSqlError(
      client,
      `UPDATE payment SET status = 'REVERSED' WHERE reference = 'BT-FAIL-001'`,
      [],
      '55000',
    );

    // 14d. Attempt to mutate immutable attributes on payment fails
    await expectSqlError(
      client,
      `UPDATE payment SET amount = 99999.00 WHERE payment_id = $1`,
      [p1.payment_id],
      '55000', // status not changing to REVERSED
    );
    await expectSqlError(
      client,
      `UPDATE payment SET status = 'REVERSED', amount = 99999.00 WHERE reference = 'BT-REF-998877'`,
      [],
      '23001', // restrict_violation: immutable attributes cannot change
    );
    await expectSqlError(
      client,
      `UPDATE payment SET status = 'REVERSED', kind = 'PAYMENT' WHERE reference = 'BT-REF-998877'`,
      [],
      '23001',
    );
    await expectSqlError(
      client,
      `UPDATE payment SET status = 'REVERSED', reference = 'NEW-REF-001' WHERE reference = 'BT-REF-998877'`,
      [],
      '23001',
    );

    // 14e. Attempt to DELETE payment record fails (financial records cannot be deleted)
    await expectSqlError(
      client,
      `DELETE FROM payment WHERE payment_id = $1`,
      [p1.payment_id],
      '23001', // restrict_violation
    );
    await expectSqlError(
      client,
      `DELETE FROM payment WHERE reference = 'BT-REF-998877'`,
      [],
      '23001',
    );

    // 14f. Restrict delete on parent booking and parent user_account
    await expectSqlError(
      client,
      `DELETE FROM booking WHERE booking_id = $1`,
      [bookingId],
      '23001', // restrict_violation
    );
    await expectSqlError(
      client,
      `DELETE FROM user_account WHERE user_id = $1`,
      [userId],
      '23001', // restrict_violation
    );
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});
