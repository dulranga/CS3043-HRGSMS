const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const serviceMigration = readFileSync(
  path.join(__dirname, '..', 'migrations', 'm3_001_service_catalogue.sql'),
  'utf8',
);
const usageMigration = readFileSync(
  path.join(__dirname, '..', 'migrations', 'm3_003_service_usage.sql'),
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

test('M3-S04 service usage validates attribution, exact values, and void state', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const client = new Client({ connectionString: process.env.PG_URL });
  const schema = `m3_service_usage_test_${randomBytes(8).toString('hex')}`;
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}", public`);
    await client.query(`
      CREATE TABLE user_account (
        user_id uuid PRIMARY KEY DEFAULT uuidv7()
      );
      CREATE TABLE booking (
        booking_id uuid PRIMARY KEY DEFAULT uuidv7()
      );
      CREATE TYPE booking_room_line_status_enum AS ENUM (
        'BOOKED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'
      );
      CREATE TABLE booking_room_line (
        line_id uuid PRIMARY KEY DEFAULT uuidv7(),
        booking_id uuid NOT NULL REFERENCES booking (booking_id),
        status booking_room_line_status_enum NOT NULL
      );
    `);
    await client.query(serviceMigration);
    await client.query(usageMigration);

    const actor = await client.query('INSERT INTO user_account DEFAULT VALUES RETURNING user_id');
    const voidActor = await client.query('INSERT INTO user_account DEFAULT VALUES RETURNING user_id');
    const firstBooking = await client.query('INSERT INTO booking DEFAULT VALUES RETURNING booking_id');
    const secondBooking = await client.query('INSERT INTO booking DEFAULT VALUES RETURNING booking_id');
    const noStayBooking = await client.query('INSERT INTO booking DEFAULT VALUES RETURNING booking_id');
    const firstLine = await client.query(
      `INSERT INTO booking_room_line (booking_id, status)
       VALUES ($1, 'CHECKED_IN') RETURNING line_id`,
      [firstBooking.rows[0].booking_id],
    );
    const bookedLine = await client.query(
      `INSERT INTO booking_room_line (booking_id, status)
       VALUES ($1, 'BOOKED') RETURNING line_id`,
      [firstBooking.rows[0].booking_id],
    );
    const secondLine = await client.query(
      `INSERT INTO booking_room_line (booking_id, status)
       VALUES ($1, 'CHECKED_IN') RETURNING line_id`,
      [secondBooking.rows[0].booking_id],
    );
    const service = await client.query(
      `INSERT INTO service (name, category, current_price)
       VALUES ('Laundry', 'Housekeeping', 1250.005) RETURNING service_id`,
    );
    const values = [
      firstBooking.rows[0].booking_id,
      service.rows[0].service_id,
      firstLine.rows[0].line_id,
      actor.rows[0].user_id,
    ];

    const columns = await client.query(
      `SELECT column_name, data_type, numeric_precision, numeric_scale, is_nullable
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'service_usage'
        ORDER BY ordinal_position`,
      [schema],
    );
    assert.deepEqual(
      columns.rows.map(({ column_name }) => column_name),
      [
        'usage_id', 'booking_id', 'service_id', 'booking_room_line_id', 'used_at',
        'quantity', 'unit_price_snapshot', 'voided', 'voided_at', 'recorded_at',
        'recorded_by', 'voided_by',
      ],
    );
    assert.equal(columns.rows.find((row) => row.column_name === 'quantity').numeric_precision, 10);
    assert.equal(columns.rows.find((row) => row.column_name === 'quantity').numeric_scale, 2);
    assert.equal(columns.rows.find((row) => row.column_name === 'unit_price_snapshot').numeric_precision, 12);
    assert.equal(columns.rows.find((row) => row.column_name === 'unit_price_snapshot').numeric_scale, 2);
    assert.equal(columns.rows.find((row) => row.column_name === 'booking_room_line_id').is_nullable, 'YES');

    const roomSpecific = await client.query(
      `INSERT INTO service_usage (
         booking_id, service_id, booking_room_line_id, quantity,
         unit_price_snapshot, recorded_by
       ) VALUES ($1, $2, $3, 1.25, 1250.005, $4)
       RETURNING usage_id, quantity, unit_price_snapshot, voided`,
      values,
    );
    assert.equal(roomSpecific.rows[0].quantity, '1.25');
    assert.equal(roomSpecific.rows[0].unit_price_snapshot, '1250.01');
    assert.equal(roomSpecific.rows[0].voided, false);

    const bookingWide = await client.query(
      `INSERT INTO service_usage (
         booking_id, service_id, quantity, unit_price_snapshot, recorded_by
       ) VALUES ($1, $2, 2, 900, $3)
       RETURNING booking_room_line_id`,
      [values[0], values[1], values[3]],
    );
    assert.equal(bookingWide.rows[0].booking_room_line_id, null);

    const voided = await client.query(
      `INSERT INTO service_usage (
         booking_id, service_id, quantity, unit_price_snapshot,
         voided, voided_at, recorded_by, voided_by
       ) VALUES ($1, $2, 1, 900, true, TIMESTAMPTZ '2026-09-30 10:00:00+00', $3, $4)
       RETURNING voided, voided_at, voided_by`,
      [values[0], values[1], values[3], voidActor.rows[0].user_id],
    );
    assert.equal(voided.rows[0].voided, true);
    assert.ok(voided.rows[0].voided_at);
    assert.equal(voided.rows[0].voided_by, voidActor.rows[0].user_id);

    await expectSqlError(client,
      `INSERT INTO service_usage (
         booking_id, service_id, booking_room_line_id, quantity,
         unit_price_snapshot, recorded_by
       ) VALUES ($1, $2, $3, 1, 900, $4)`,
      [firstBooking.rows[0].booking_id, service.rows[0].service_id, secondLine.rows[0].line_id, values[3]],
      '23514');
    await expectSqlError(client,
      `INSERT INTO service_usage (
         booking_id, service_id, booking_room_line_id, quantity,
         unit_price_snapshot, recorded_by
       ) VALUES ($1, $2, $3, 1, 900, $4)`,
      [firstBooking.rows[0].booking_id, service.rows[0].service_id, bookedLine.rows[0].line_id, values[3]],
      '23514');
    await expectSqlError(client,
      `INSERT INTO service_usage (
         booking_id, service_id, quantity, unit_price_snapshot, recorded_by
       ) VALUES ($1, $2, 1, 900, $3)`,
      [noStayBooking.rows[0].booking_id, service.rows[0].service_id, values[3]],
      '23514');
    await expectSqlError(client,
      `INSERT INTO service_usage (
         booking_id, service_id, quantity, unit_price_snapshot, recorded_by
       ) VALUES ($1, $2, 0, 900, $3)`,
      [values[0], values[1], values[3]], '23514');
    await expectSqlError(client,
      `INSERT INTO service_usage (
         booking_id, service_id, quantity, unit_price_snapshot, recorded_by
       ) VALUES ($1, $2, 100000000, 900, $3)`,
      [values[0], values[1], values[3]], '22003');
    await expectSqlError(client,
      `INSERT INTO service_usage (
         booking_id, service_id, quantity, unit_price_snapshot, recorded_by
       ) VALUES ($1, $2, 1, -1, $3)`,
      [values[0], values[1], values[3]], '23514');
    await expectSqlError(client,
      `INSERT INTO service_usage (
         booking_id, service_id, quantity, unit_price_snapshot, recorded_by
       ) VALUES ($1, $2, 1, 10000000000, $3)`,
      [values[0], values[1], values[3]], '22003');
    await expectSqlError(client,
      `INSERT INTO service_usage (
         booking_id, service_id, quantity, unit_price_snapshot,
         voided, recorded_by
       ) VALUES ($1, $2, 1, 900, true, $3)`,
      [values[0], values[1], values[3]], '23514');
    await expectSqlError(client,
      `INSERT INTO service_usage (
         booking_id, service_id, quantity, unit_price_snapshot,
         voided, voided_at, recorded_by
       ) VALUES ($1, $2, 1, 900, false, TIMESTAMPTZ '2026-09-30 10:00:00+00', $3)`,
      [values[0], values[1], values[3]], '23514');
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