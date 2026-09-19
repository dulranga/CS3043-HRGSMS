const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const migration = readFileSync(
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

test('M2-S03 booking migration and constraints in a clean isolated schema', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const client = new Client({ connectionString: process.env.PG_URL });
  const schema = `m2_booking_test_${randomBytes(8).toString('hex')}`;
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}", public`);

    // M2-S03 consumes these Member 1 keys. These minimal parents exist only in
    // the rolled-back test schema and are not substitutes for Member 1's migrations.
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
    await client.query(migration);

    const columns = await client.query(
      `SELECT table_name, column_name, data_type, udt_name,
              character_maximum_length, numeric_precision, numeric_scale,
              is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name IN ('booking', 'booking_status_history')
        ORDER BY table_name, ordinal_position`,
      [schema],
    );
    assert.deepEqual(
      columns.rows.map(({ table_name, column_name }) => `${table_name}.${column_name}`),
      [
        'booking.booking_id', 'booking.booking_ref', 'booking.check_in_date',
        'booking.check_out_date', 'booking.booking_channel', 'booking.guest_count',
        'booking.rate_snapshot', 'booking.status', 'booking.actual_check_in',
        'booking.actual_check_out', 'booking.created_at', 'booking.updated_at',
        'booking.guest_id', 'booking.created_by',
        'booking_status_history.history_id', 'booking_status_history.old_status',
        'booking_status_history.new_status', 'booking_status_history.changed_at',
        'booking_status_history.reason', 'booking_status_history.booking_id',
        'booking_status_history.changed_by',
      ],
    );

    const rateColumn = columns.rows.find(
      (row) => row.table_name === 'booking' && row.column_name === 'rate_snapshot',
    );
    assert.equal(rateColumn.data_type, 'numeric');
    assert.equal(rateColumn.numeric_precision, 12);
    assert.equal(rateColumn.numeric_scale, 2);
    for (const field of ['actual_check_in', 'actual_check_out', 'created_at', 'updated_at']) {
      assert.equal(
        columns.rows.find(
          (row) => row.table_name === 'booking' && row.column_name === field,
        ).data_type,
        'timestamp with time zone',
      );
    }
    assert.equal(
      columns.rows.find(
        (row) => row.table_name === 'booking_status_history' && row.column_name === 'changed_at',
      ).data_type,
      'timestamp with time zone',
    );
    assert.equal(
      columns.rows.find(
        (row) => row.table_name === 'booking' && row.column_name === 'booking_channel',
      ).udt_name,
      'booking_channel_enum',
    );
    assert.equal(
      columns.rows.find(
        (row) => row.table_name === 'booking' && row.column_name === 'status',
      ).udt_name,
      'booking_status_enum',
    );
    assert.equal(
      columns.rows.find(
        (row) => row.table_name === 'booking_status_history' && row.column_name === 'old_status',
      ).is_nullable,
      'YES',
    );

    const enumLabels = await client.query(
      `SELECT type.typname, enum.enumlabel
         FROM pg_type AS type
         JOIN pg_enum AS enum ON enum.enumtypid = type.oid
         JOIN pg_namespace AS namespace ON namespace.oid = type.typnamespace
        WHERE namespace.nspname = $1
          AND type.typname IN ('booking_channel_enum', 'booking_status_enum')
        ORDER BY type.typname, enum.enumsortorder`,
      [schema],
    );
    assert.deepEqual(enumLabels.rows, [
      { typname: 'booking_channel_enum', enumlabel: 'DIRECT_ONLINE' },
      { typname: 'booking_channel_enum', enumlabel: 'FRONT_DESK' },
      { typname: 'booking_channel_enum', enumlabel: 'PHONE' },
      { typname: 'booking_channel_enum', enumlabel: 'EMAIL' },
      { typname: 'booking_status_enum', enumlabel: 'BOOKED' },
      { typname: 'booking_status_enum', enumlabel: 'CHECKED_IN' },
      { typname: 'booking_status_enum', enumlabel: 'CHECKED_OUT' },
      { typname: 'booking_status_enum', enumlabel: 'CANCELLED' },
      { typname: 'booking_status_enum', enumlabel: 'NO_SHOW' },
    ]);

    const actor = await client.query(
      'INSERT INTO user_account DEFAULT VALUES RETURNING user_id',
    );
    const actorId = actor.rows[0].user_id;
    const guest = await client.query('INSERT INTO guest DEFAULT VALUES RETURNING guest_id');
    const guestId = guest.rows[0].guest_id;
    const booking = await client.query(
      `INSERT INTO booking (
         booking_ref, check_in_date, check_out_date, booking_channel,
         guest_count, rate_snapshot, guest_id, created_by
       ) VALUES ('SKY-20260919-0001', DATE '2026-10-01', DATE '2026-10-03',
                 'FRONT_DESK', 2, 12500.005, $1, $2)
       RETURNING booking_id, rate_snapshot, status, actual_check_in,
                 actual_check_out, created_at, updated_at`,
      [guestId, actorId],
    );
    const bookingId = booking.rows[0].booking_id;
    assert.equal(booking.rows[0].rate_snapshot, '12500.01');
    assert.equal(booking.rows[0].status, 'BOOKED');
    assert.equal(booking.rows[0].actual_check_in, null);
    assert.equal(booking.rows[0].actual_check_out, null);
    assert.ok(booking.rows[0].created_at instanceof Date);
    assert.ok(booking.rows[0].updated_at instanceof Date);

    const history = await client.query(
      `INSERT INTO booking_status_history (
         booking_id, old_status, new_status, changed_by, reason
       ) VALUES ($1, NULL, 'BOOKED', $2, 'Booking created')
       RETURNING history_id, old_status, new_status, changed_at`,
      [bookingId, actorId],
    );
    const historyId = history.rows[0].history_id;
    assert.equal(history.rows[0].old_status, null);
    assert.equal(history.rows[0].new_status, 'BOOKED');
    assert.ok(history.rows[0].changed_at instanceof Date);

    const versions = await client.query(
      `SELECT uuid_extract_version($1::uuid) AS booking_version,
              uuid_extract_version($2::uuid) AS history_version`,
      [bookingId, historyId],
    );
    assert.equal(versions.rows[0].booking_version, 7);
    assert.equal(versions.rows[0].history_version, 7);

    const validBookingSql = `INSERT INTO booking (
      booking_ref, check_in_date, check_out_date, booking_channel,
      guest_count, rate_snapshot, guest_id, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`;

    await expectSqlError(client, validBookingSql,
      ['BAD-SAME-DATE', '2026-10-01', '2026-10-01', 'PHONE', 1, 100, guestId, actorId],
      '23514');
    await expectSqlError(client, validBookingSql,
      ['BAD-DATE-ORDER', '2026-10-03', '2026-10-01', 'PHONE', 1, 100, guestId, actorId],
      '23514');
    await expectSqlError(client, validBookingSql,
      ['BAD-COUNT', '2026-10-01', '2026-10-02', 'PHONE', 0, 100, guestId, actorId],
      '23514');
    await expectSqlError(client, validBookingSql,
      ['BAD-CHANNEL', '2026-10-01', '2026-10-02', 'MARKETPLACE', 1, 100, guestId, actorId],
      '22P02');
    await expectSqlError(client,
      `INSERT INTO booking (
         booking_ref, check_in_date, check_out_date, booking_channel,
         guest_count, rate_snapshot, status, guest_id, created_by
       ) VALUES ('BAD-STATUS', '2026-10-01', '2026-10-02', 'PHONE',
                 1, 100, 'PENDING', $1, $2)`,
      [guestId, actorId], '22P02');
    await expectSqlError(client, validBookingSql,
      ['BAD-GUEST', '2026-10-01', '2026-10-02', 'PHONE', 1, 100,
        '00000000-0000-7000-8000-000000000001', actorId],
      '23503');
    await expectSqlError(client, validBookingSql,
      ['BAD-ACTOR', '2026-10-01', '2026-10-02', 'PHONE', 1, 100,
        guestId, '00000000-0000-7000-8000-000000000002'],
      '23503');
    await expectSqlError(client, validBookingSql,
      ['BAD-RATE', '2026-10-01', '2026-10-02', 'PHONE', 1, -1, guestId, actorId],
      '23514');
    await expectSqlError(client, validBookingSql,
      ['BAD-NAN', '2026-10-01', '2026-10-02', 'PHONE', 1, 'NaN', guestId, actorId],
      '23514');
    await expectSqlError(client, validBookingSql,
      ['BAD-OVERFLOW', '2026-10-01', '2026-10-02', 'PHONE', 1, 10000000000,
        guestId, actorId],
      '22003');
    await expectSqlError(client, validBookingSql,
      ['   ', '2026-10-01', '2026-10-02', 'PHONE', 1, 100, guestId, actorId],
      '23514');
    await expectSqlError(client, validBookingSql,
      ['SKY-20260919-0001', '2026-10-04', '2026-10-05', 'PHONE', 1, 100,
        guestId, actorId],
      '23505');
    await expectSqlError(client,
      `INSERT INTO booking (
         booking_id, booking_ref, check_in_date, check_out_date, booking_channel,
         guest_count, rate_snapshot, guest_id, created_by
       ) VALUES (uuidv4(), 'BAD-V4', '2026-10-01', '2026-10-02', 'PHONE',
                 1, 100, $1, $2)`,
      [guestId, actorId], '23514');
    await expectSqlError(client,
      `INSERT INTO booking (
         booking_id, booking_ref, check_in_date, check_out_date, booking_channel,
         guest_count, rate_snapshot, guest_id, created_by
       ) VALUES ('00000000-0000-0000-0000-000000000000', 'BAD-NIL',
                 '2026-10-01', '2026-10-02', 'PHONE', 1, 100, $1, $2)`,
      [guestId, actorId], '23514');
    await expectSqlError(client,
      `INSERT INTO booking (
         booking_ref, check_in_date, check_out_date, booking_channel,
         guest_count, rate_snapshot, actual_check_out, guest_id, created_by
       ) VALUES ('BAD-ACTUAL-TIMES', '2026-10-01', '2026-10-02', 'PHONE',
                 1, 100, TIMESTAMPTZ '2026-10-02 11:00:00+00', $1, $2)`,
      [guestId, actorId], '23514');

    await expectSqlError(client,
      `INSERT INTO booking_status_history (booking_id, new_status, changed_by)
       VALUES ('00000000-0000-7000-8000-000000000003', 'BOOKED', $1)`,
      [actorId], '23503');
    await expectSqlError(client,
      `INSERT INTO booking_status_history (booking_id, new_status, changed_by)
       VALUES ($1, 'BOOKED', '00000000-0000-7000-8000-000000000004')`,
      [bookingId], '23503');
    await expectSqlError(client,
      `INSERT INTO booking_status_history (booking_id, old_status, new_status, changed_by)
       VALUES ($1, NULL, 'CHECKED_IN', $2)`,
      [bookingId, actorId], '23514');
    await expectSqlError(client,
      `INSERT INTO booking_status_history (booking_id, old_status, new_status, changed_by)
       VALUES ($1, 'BOOKED', 'CHECKED_OUT', $2)`,
      [bookingId, actorId], '23514');
    await expectSqlError(client,
      `INSERT INTO booking_status_history (booking_id, old_status, new_status, changed_by)
       VALUES ($1, 'BOOKED', 'PENDING', $2)`,
      [bookingId, actorId], '22P02');
    await expectSqlError(client,
      `INSERT INTO booking_status_history (
         history_id, booking_id, new_status, changed_by
       ) VALUES (uuidv4(), $1, 'BOOKED', $2)`,
      [bookingId, actorId], '23514');
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
