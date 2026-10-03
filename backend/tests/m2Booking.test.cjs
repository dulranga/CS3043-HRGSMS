const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const bookingMigration = readFileSync(
  path.join(__dirname, '..', 'migrations', 'm2_002_booking.sql'),
  'utf8',
);

async function expectSqlError(client, sql, values, code) {
  await client.query('SAVEPOINT expected_error');
  try {
    await assert.rejects(
      client.query(sql, values),
      (error) => error.code === code,
      `Expected PostgreSQL error ${code}`,
    );
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT expected_error');
    await client.query('RELEASE SAVEPOINT expected_error');
  }
}

test('M2-S03 creates the direct multi-room booking schema', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const client = new Client({ connectionString: process.env.PG_URL });
  const schema = `m2_booking_test_${randomBytes(8).toString('hex')}`;
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}", public`);
    await client.query(`
      CREATE TABLE user_account (
        user_id uuid PRIMARY KEY DEFAULT uuidv7(),
        CONSTRAINT user_account_uuidv7_check
          CHECK ((uuid_extract_version(user_id) = 7) IS TRUE)
      );
      CREATE TABLE guest (
        guest_id uuid PRIMARY KEY DEFAULT uuidv7(),
        CONSTRAINT guest_uuidv7_check
          CHECK ((uuid_extract_version(guest_id) = 7) IS TRUE)
      );
    `);
    await client.query(bookingMigration);

    const bookingColumns = await client.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'booking'
        ORDER BY ordinal_position`,
      [schema],
    );
    assert.deepEqual(
      bookingColumns.rows.map((row) => row.column_name),
      [
        'booking_id', 'booking_ref', 'booking_channel', 'created_at',
        'updated_at', 'guest_id', 'created_by',
      ],
    );
    for (const legacyColumn of [
      'check_in_date', 'check_out_date', 'guest_count', 'rate_snapshot',
      'status', 'actual_check_in', 'actual_check_out', 'room_id',
    ]) {
      assert.equal(
        bookingColumns.rows.some((row) => row.column_name === legacyColumn),
        false,
        `${legacyColumn} must not exist on the booking header`,
      );
    }

    const lineColumns = await client.query(
      `SELECT column_name, data_type, udt_name, numeric_precision, numeric_scale
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'booking_room_line'
        ORDER BY ordinal_position`,
      [schema],
    );
    assert.deepEqual(
      lineColumns.rows.map((row) => row.column_name),
      [
        'line_id', 'booking_id', 'stay_start_date', 'stay_end_date',
        'guest_count', 'rate_snapshot', 'status', 'created_at', 'updated_at',
      ],
    );
    const rateColumn = lineColumns.rows.find((row) => row.column_name === 'rate_snapshot');
    assert.equal(rateColumn.data_type, 'numeric');
    assert.equal(rateColumn.numeric_precision, 12);
    assert.equal(rateColumn.numeric_scale, 2);
    assert.equal(
      lineColumns.rows.find((row) => row.column_name === 'status').udt_name,
      'booking_room_line_status_enum',
    );

    const enumLabels = await client.query(
      `SELECT enum.enumlabel
         FROM pg_type AS type
         JOIN pg_enum AS enum ON enum.enumtypid = type.oid
         JOIN pg_namespace AS namespace ON namespace.oid = type.typnamespace
        WHERE namespace.nspname = $1
          AND type.typname = 'booking_room_line_status_enum'
        ORDER BY enum.enumsortorder`,
      [schema],
    );
    assert.deepEqual(
      enumLabels.rows.map((row) => row.enumlabel),
      ['BOOKED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'],
    );

    const actor = await client.query(
      'INSERT INTO user_account DEFAULT VALUES RETURNING user_id',
    );
    const guest = await client.query('INSERT INTO guest DEFAULT VALUES RETURNING guest_id');
    const actorId = actor.rows[0].user_id;
    const guestId = guest.rows[0].guest_id;
    const booking = await client.query(
      `INSERT INTO booking (
         booking_ref, booking_channel, guest_id, created_by
       ) VALUES ('MULTI-ROOM-001', 'FRONT_DESK', $1, $2)
       RETURNING booking_id`,
      [guestId, actorId],
    );
    const bookingId = booking.rows[0].booking_id;

    const firstLine = await client.query(
      `INSERT INTO booking_room_line (
         booking_id, stay_start_date, stay_end_date, guest_count, rate_snapshot
       ) VALUES ($1, '2026-10-01', '2026-10-04', 2, 15000.005)
       RETURNING line_id, rate_snapshot, status`,
      [bookingId],
    );
    const secondLine = await client.query(
      `INSERT INTO booking_room_line (
         booking_id, stay_start_date, stay_end_date, guest_count, rate_snapshot
       ) VALUES ($1, '2026-10-02', '2026-10-06', 3, 22000)
       RETURNING line_id`,
      [bookingId],
    );
    assert.equal(firstLine.rows[0].rate_snapshot, '15000.01');
    assert.equal(firstLine.rows[0].status, 'BOOKED');
    const lineCount = await client.query(
      'SELECT count(*)::integer AS count FROM booking_room_line WHERE booking_id = $1',
      [bookingId],
    );
    assert.equal(lineCount.rows[0].count, 2);

    for (const lineId of [firstLine.rows[0].line_id, secondLine.rows[0].line_id]) {
      await client.query(
        `INSERT INTO booking_room_line_status_history (
           line_id, old_status, new_status, changed_by, reason
         ) VALUES ($1, NULL, 'BOOKED', $2, 'Initial reservation')`,
        [lineId, actorId],
      );
    }

    const revision = await client.query(
      `INSERT INTO booking_room_line_revision (
         line_id,
         old_stay_start_date, old_stay_end_date,
         old_guest_count, old_rate_snapshot,
         new_stay_start_date, new_stay_end_date,
         new_guest_count, new_rate_snapshot,
         changed_by, reason
       ) VALUES (
         $1,
         '2026-10-01', '2026-10-04', 2, 15000.01,
         '2026-10-02', '2026-10-05', 2, 15500,
         $2, 'Guest approved change'
       ) RETURNING revision_id`,
      [firstLine.rows[0].line_id, actorId],
    );
    assert.ok(revision.rows[0].revision_id);

    await expectSqlError(
      client,
      'UPDATE booking_room_line_status_history SET reason = $1',
      ['Changed'],
      '55000',
    );
    await expectSqlError(
      client,
      'DELETE FROM booking_room_line_revision WHERE revision_id = $1',
      [revision.rows[0].revision_id],
      '55000',
    );

    const validLineSql = `INSERT INTO booking_room_line (
      booking_id, stay_start_date, stay_end_date, guest_count, rate_snapshot
    ) VALUES ($1, $2, $3, $4, $5)`;
    await expectSqlError(
      client,
      validLineSql,
      [bookingId, '2026-11-01', '2026-11-01', 1, 100],
      '23514',
    );
    await expectSqlError(
      client,
      validLineSql,
      [bookingId, '2026-11-01', '2026-11-02', 0, 100],
      '23514',
    );
    await expectSqlError(
      client,
      validLineSql,
      [bookingId, '2026-11-01', '2026-11-02', 1, -1],
      '23514',
    );
    await expectSqlError(
      client,
      validLineSql,
      ['00000000-0000-7000-8000-000000000001', '2026-11-01', '2026-11-02', 1, 100],
      '23503',
    );
    await expectSqlError(
      client,
      `INSERT INTO booking_room_line (
         line_id, booking_id, stay_start_date, stay_end_date, guest_count, rate_snapshot
       ) VALUES (uuidv4(), $1, '2026-11-01', '2026-11-02', 1, 100)`,
      [bookingId],
      '23514',
    );
    await expectSqlError(
      client,
      `INSERT INTO booking_room_line_status_history (
         line_id, old_status, new_status, changed_by
       ) VALUES ($1, 'CHECKED_OUT', 'BOOKED', $2)`,
      [firstLine.rows[0].line_id, actorId],
      '23514',
    );
    await expectSqlError(
      client,
      `INSERT INTO booking_room_line_revision (
         line_id,
         old_stay_start_date, old_stay_end_date,
         old_guest_count, old_rate_snapshot,
         new_stay_start_date, new_stay_end_date,
         new_guest_count, new_rate_snapshot,
         changed_by, reason
       ) VALUES (
         $1,
         '2026-10-01', '2026-10-04', 2, 15000.01,
         '2026-10-01', '2026-10-04', 2, 15000.01,
         $2, 'No change'
       )`,
      [firstLine.rows[0].line_id, actorId],
      '23514',
    );
    await expectSqlError(
      client,
      `INSERT INTO booking (
         booking_ref, booking_channel, guest_id, created_by
       ) VALUES ('MULTI-ROOM-001', 'PHONE', $1, $2)`,
      [guestId, actorId],
      '23505',
    );
    await expectSqlError(
      client,
      `INSERT INTO booking (
         booking_ref, booking_channel, guest_id, created_by
       ) VALUES ('BAD-CHANNEL', 'MARKETPLACE', $1, $2)`,
      [guestId, actorId],
      '22P02',
    );
    await expectSqlError(
      client,
      'DELETE FROM booking WHERE booking_id = $1',
      [bookingId],
      '23001',
    );
  } finally {
    try {
      await client.query('ROLLBACK');
      const cleanup = await client.query('SELECT to_regnamespace($1) AS schema_name', [schema]);
      assert.equal(cleanup.rows[0].schema_name, null, 'scratch schema must not persist');
    } finally {
      await client.end();
    }
  }
});
