const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const migrationNames = [
  'm2_001_room_catalogue.sql',
  'm2_002_booking.sql',
  'm2_003_room_inventory.sql',
  'm2_004_booking_room_assignment.sql',
  'm2_005_assignment_guards.sql',
  'm2_006_booking_room_line.sql',
];
const migrations = Object.fromEntries(
  migrationNames.map((file) => [
    file,
    readFileSync(path.join(__dirname, '..', 'migrations', file), 'utf8'),
  ]),
);

const parentFixturesSql = `
  CREATE TABLE branch (
    branch_id uuid PRIMARY KEY DEFAULT uuidv7(),
    active boolean NOT NULL DEFAULT true,
    CONSTRAINT branch_uuidv7_check
      CHECK ((uuid_extract_version(branch_id) = 7) IS TRUE)
  );
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
`;

async function createTransactionalSchema(prefix) {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const client = new Client({ connectionString: process.env.PG_URL });
  const schema = `${prefix}_${randomBytes(8).toString('hex')}`;
  await client.connect();
  await client.query('BEGIN');
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET LOCAL search_path TO "${schema}", public`);
  await client.query(parentFixturesSql);
  return { client, schema };
}

async function rollbackAndClose(client, schema) {
  try {
    await client.query('ROLLBACK');
    const cleanup = await client.query('SELECT to_regnamespace($1) AS schema_name', [schema]);
    assert.equal(cleanup.rows[0].schema_name, null, 'scratch schema must not persist');
  } finally {
    await client.end();
  }
}

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

test('M2-S24 applies after the complete existing Member 2 migration chain', async () => {
  const { client, schema } = await createTransactionalSchema('m2_room_line_clean');
  try {
    for (const name of migrationNames) {
      await client.query(migrations[name]);
    }

    const relation = await client.query(
      'SELECT to_regclass($1) AS relation_name',
      [`${schema}.booking_room_line`],
    );
    assert.ok(relation.rows[0].relation_name, 'booking_room_line must exist');

    const columns = await client.query(
      `SELECT column_name, data_type, udt_name, numeric_precision, numeric_scale
         FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = 'booking_room_line'
        ORDER BY ordinal_position`,
      [schema],
    );
    assert.deepEqual(
      columns.rows.map((row) => row.column_name),
      [
        'line_id', 'booking_id', 'stay_start_date', 'stay_end_date',
        'guest_count', 'rate_snapshot', 'status', 'created_at', 'updated_at',
      ],
    );
    const rateColumn = columns.rows.find((row) => row.column_name === 'rate_snapshot');
    assert.equal(rateColumn.data_type, 'numeric');
    assert.equal(rateColumn.numeric_precision, 12);
    assert.equal(rateColumn.numeric_scale, 2);
    assert.equal(
      columns.rows.find((row) => row.column_name === 'status').udt_name,
      'booking_room_line_status_enum',
    );

    const index = await client.query(
      `SELECT indexdef
         FROM pg_indexes
        WHERE schemaname = $1
          AND indexname = 'booking_room_line_booking_status_dates_idx'`,
      [schema],
    );
    assert.equal(index.rowCount, 1);
    assert.match(index.rows[0].indexdef, /booking_id, status, stay_start_date, stay_end_date/);
  } finally {
    await rollbackAndClose(client, schema);
  }
});

test('M2-S24 backfills legacy bookings and supports multiple lines per booking', async () => {
  const { client, schema } = await createTransactionalSchema('m2_room_line_upgrade');
  try {
    await client.query(migrations['m2_002_booking.sql']);

    const actor = await client.query(
      'INSERT INTO user_account DEFAULT VALUES RETURNING user_id',
    );
    const guest = await client.query('INSERT INTO guest DEFAULT VALUES RETURNING guest_id');
    const actorId = actor.rows[0].user_id;
    const guestId = guest.rows[0].guest_id;

    const legacyRows = [
      ['LINE-BOOKED', '2026-10-01', '2026-10-03', 2, '12500.01', 'BOOKED'],
      ['LINE-CHECKED-IN', '2026-10-04', '2026-10-06', 1, '9000.00', 'CHECKED_IN'],
      ['LINE-CHECKED-OUT', '2026-10-07', '2026-10-09', 3, '18000.25', 'CHECKED_OUT'],
      ['LINE-CANCELLED', '2026-10-10', '2026-10-11', 1, '7000.00', 'CANCELLED'],
      ['LINE-NO-SHOW', '2026-10-12', '2026-10-14', 2, '13500.50', 'NO_SHOW'],
    ];
    const legacyIds = [];
    for (const [reference, start, end, guests, rate, status] of legacyRows) {
      const inserted = await client.query(
        `INSERT INTO booking (
           booking_ref, check_in_date, check_out_date, booking_channel,
           guest_count, rate_snapshot, status, guest_id, created_by
         ) VALUES ($1, $2, $3, 'FRONT_DESK', $4, $5, $6, $7, $8)
         RETURNING booking_id`,
        [reference, start, end, guests, rate, status, guestId, actorId],
      );
      legacyIds.push(inserted.rows[0].booking_id);
    }

    await client.query(migrations['m2_006_booking_room_line.sql']);

    const backfilled = await client.query(
      `SELECT booking.booking_id,
              booking.check_in_date,
              booking.check_out_date,
              booking.guest_count AS legacy_guest_count,
              booking.rate_snapshot AS legacy_rate,
              booking.status::text AS legacy_status,
              line.line_id,
              line.stay_start_date,
              line.stay_end_date,
              line.guest_count AS line_guest_count,
              line.rate_snapshot AS line_rate,
              line.status::text AS line_status
         FROM booking
         JOIN booking_room_line AS line USING (booking_id)
        ORDER BY booking.booking_ref`,
    );
    assert.equal(backfilled.rowCount, legacyRows.length);
    assert.equal(new Set(backfilled.rows.map((row) => row.booking_id)).size, legacyRows.length);
    for (const row of backfilled.rows) {
      assert.ok(row.line_id);
      assert.equal(row.stay_start_date.toISOString(), row.check_in_date.toISOString());
      assert.equal(row.stay_end_date.toISOString(), row.check_out_date.toISOString());
      assert.equal(row.line_guest_count, row.legacy_guest_count);
      assert.equal(row.line_rate, row.legacy_rate);
      assert.equal(row.line_status, row.legacy_status);
    }

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

    const bookingId = legacyIds[0];
    const secondLine = await client.query(
      `INSERT INTO booking_room_line (
         booking_id, stay_start_date, stay_end_date, guest_count, rate_snapshot
       ) VALUES ($1, '2026-11-01', '2026-11-04', 1, 10000.005)
       RETURNING line_id, rate_snapshot, status`,
      [bookingId],
    );
    assert.equal(secondLine.rows[0].rate_snapshot, '10000.01');
    assert.equal(secondLine.rows[0].status, 'BOOKED');
    const version = await client.query(
      'SELECT uuid_extract_version($1::uuid) AS version',
      [secondLine.rows[0].line_id],
    );
    assert.equal(version.rows[0].version, 7);
    const lineCount = await client.query(
      'SELECT count(*)::integer AS count FROM booking_room_line WHERE booking_id = $1',
      [bookingId],
    );
    assert.equal(lineCount.rows[0].count, 2);

    const validLineSql = `INSERT INTO booking_room_line (
      booking_id, stay_start_date, stay_end_date, guest_count, rate_snapshot
    ) VALUES ($1, $2, $3, $4, $5)`;
    await expectSqlError(
      client,
      validLineSql,
      [bookingId, '2026-12-01', '2026-12-01', 1, 100],
      '23514',
    );
    await expectSqlError(
      client,
      validLineSql,
      [bookingId, '2026-12-01', '2026-12-02', 0, 100],
      '23514',
    );
    await expectSqlError(
      client,
      validLineSql,
      [bookingId, '2026-12-01', '2026-12-02', 1, -1],
      '23514',
    );
    await expectSqlError(
      client,
      validLineSql,
      ['00000000-0000-7000-8000-000000000001', '2026-12-01', '2026-12-02', 1, 100],
      '23503',
    );
    await expectSqlError(
      client,
      `INSERT INTO booking_room_line (
         line_id, booking_id, stay_start_date, stay_end_date, guest_count, rate_snapshot
       ) VALUES (uuidv4(), $1, '2026-12-01', '2026-12-02', 1, 100)`,
      [bookingId],
      '23514',
    );
  } finally {
    await rollbackAndClose(client, schema);
  }
});
