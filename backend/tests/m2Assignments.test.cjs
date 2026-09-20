const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const migrations = [
  'm2_001_room_catalogue.sql',
  'm2_002_booking.sql',
  'm2_003_room_inventory.sql',
  'm2_004_booking_room_assignment.sql',
].map((file) => readFileSync(path.join(__dirname, '..', 'migrations', file), 'utf8'));

const parentFixturesSql = `
  CREATE TABLE branch (
    branch_id uuid PRIMARY KEY DEFAULT uuidv7(),
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

async function applyMigrations(client) {
  await client.query(parentFixturesSql);
  for (const migration of migrations) {
    await client.query(migration);
  }
}

async function seedBookingAndRooms(client, suffix) {
  const branch = await client.query('INSERT INTO branch DEFAULT VALUES RETURNING branch_id');
  const actor = await client.query(
    'INSERT INTO user_account DEFAULT VALUES RETURNING user_id',
  );
  const guest = await client.query('INSERT INTO guest DEFAULT VALUES RETURNING guest_id');
  const type = await client.query(
    `INSERT INTO room_type (name, capacity, base_daily_rate)
     VALUES ($1, 2, 18000) RETURNING room_type_id`,
    [`Assignment Type ${suffix}`],
  );
  const booking = await client.query(
    `INSERT INTO booking (
       booking_ref, check_in_date, check_out_date, booking_channel,
       guest_count, rate_snapshot, guest_id, created_by
     ) VALUES ($1, '2026-12-01', '2026-12-03', 'FRONT_DESK', 2, 18000, $2, $3)
     RETURNING booking_id`,
    [`ASSIGN-${suffix}`, guest.rows[0].guest_id, actor.rows[0].user_id],
  );
  await client.query(
    `INSERT INTO booking_status_history (
       booking_id, old_status, new_status, changed_by, reason
     ) VALUES ($1, NULL, 'BOOKED', $2, 'Assignment fixture')`,
    [booking.rows[0].booking_id, actor.rows[0].user_id],
  );
  const roomOne = await client.query(
    `INSERT INTO room (room_number, branch_id, room_type_id)
     VALUES ($1, $2, $3) RETURNING room_id`,
    [`A-${suffix}`, branch.rows[0].branch_id, type.rows[0].room_type_id],
  );
  const roomTwo = await client.query(
    `INSERT INTO room (room_number, branch_id, room_type_id)
     VALUES ($1, $2, $3) RETURNING room_id`,
    [`B-${suffix}`, branch.rows[0].branch_id, type.rows[0].room_type_id],
  );
  return {
    bookingId: booking.rows[0].booking_id,
    roomOneId: roomOne.rows[0].room_id,
    roomTwoId: roomTwo.rows[0].room_id,
  };
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

test('M2-S05 assignment migration preserves sequential history and rejects invalid rows', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const client = new Client({ connectionString: process.env.PG_URL });
  const schema = `m2_assignments_test_${randomBytes(8).toString('hex')}`;
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}", public`);
    await applyMigrations(client);

    const columns = await client.query(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = 'booking_room_assignment'
        ORDER BY ordinal_position`,
      [schema],
    );
    assert.deepEqual(columns.rows.map(({ column_name }) => column_name), [
      'assignment_id', 'booking_id', 'room_id', 'assigned_at', 'unassigned_at',
    ]);
    assert.equal(columns.rows.find(({ column_name }) => column_name === 'assignment_id').data_type,
      'uuid');
    assert.equal(columns.rows.find(({ column_name }) => column_name === 'assigned_at').data_type,
      'timestamp with time zone');
    assert.match(
      columns.rows.find(({ column_name }) => column_name === 'assigned_at').column_default,
      /CURRENT_TIMESTAMP/i,
    );
    assert.equal(columns.rows.find(({ column_name }) => column_name === 'unassigned_at').data_type,
      'timestamp with time zone');
    assert.equal(columns.rows.find(({ column_name }) => column_name === 'unassigned_at').is_nullable,
      'YES');

    const index = await client.query(
      `SELECT indexdef
         FROM pg_indexes
        WHERE schemaname = $1
          AND tablename = 'booking_room_assignment'
          AND indexname = 'booking_room_assignment_one_open_per_booking'`,
      [schema],
    );
    assert.equal(index.rowCount, 1);
    assert.match(index.rows[0].indexdef, /CREATE UNIQUE INDEX/i);
    assert.match(index.rows[0].indexdef, /WHERE \(unassigned_at IS NULL\)/i);

    const fixture = await seedBookingAndRooms(client, randomBytes(4).toString('hex'));
    const firstAssignment = await client.query(
      `INSERT INTO booking_room_assignment (
         booking_id, room_id, assigned_at
       ) VALUES ($1, $2, TIMESTAMPTZ '2026-09-20 01:00:00+00')
       RETURNING assignment_id, unassigned_at`,
      [fixture.bookingId, fixture.roomOneId],
    );
    const firstAssignmentId = firstAssignment.rows[0].assignment_id;
    assert.equal(firstAssignment.rows[0].unassigned_at, null);
    const version = await client.query(
      'SELECT uuid_extract_version($1::uuid) AS assignment_version',
      [firstAssignmentId],
    );
    assert.equal(version.rows[0].assignment_version, 7);

    await expectSqlError(client,
      `INSERT INTO booking_room_assignment (booking_id, room_id)
       VALUES ($1, $2)`,
      [fixture.bookingId, fixture.roomTwoId], '23505');

    await client.query(
      `UPDATE booking_room_assignment
          SET unassigned_at = TIMESTAMPTZ '2026-09-20 02:00:00+00'
        WHERE assignment_id = $1`,
      [firstAssignmentId],
    );
    const secondAssignment = await client.query(
      `INSERT INTO booking_room_assignment (
         booking_id, room_id, assigned_at
       ) VALUES ($1, $2, TIMESTAMPTZ '2026-09-20 02:00:00+00')
       RETURNING assignment_id`,
      [fixture.bookingId, fixture.roomTwoId],
    );

    const history = await client.query(
      `SELECT assignment_id, room_id, assigned_at, unassigned_at
         FROM booking_room_assignment
        WHERE booking_id = $1
        ORDER BY assigned_at, assignment_id`,
      [fixture.bookingId],
    );
    assert.equal(history.rowCount, 2);
    assert.equal(history.rows[0].assignment_id, firstAssignmentId);
    assert.equal(history.rows[0].room_id, fixture.roomOneId);
    assert.ok(history.rows[0].unassigned_at instanceof Date);
    assert.equal(history.rows[1].assignment_id, secondAssignment.rows[0].assignment_id);
    assert.equal(history.rows[1].room_id, fixture.roomTwoId);
    assert.equal(history.rows[1].unassigned_at, null);

    const insertAssignmentSql = `INSERT INTO booking_room_assignment (
      booking_id, room_id, assigned_at, unassigned_at
    ) VALUES ($1, $2, $3, $4)`;
    await expectSqlError(client, insertAssignmentSql,
      [fixture.bookingId, fixture.roomOneId, '2026-09-20T04:00:00Z',
        '2026-09-20T04:00:00Z'],
      '23514');
    await expectSqlError(client, insertAssignmentSql,
      [fixture.bookingId, fixture.roomOneId, '2026-09-20T05:00:00Z',
        '2026-09-20T04:00:00Z'],
      '23514');
    await expectSqlError(client,
      `INSERT INTO booking_room_assignment (
         booking_id, room_id, assigned_at, unassigned_at
       ) VALUES ('00000000-0000-7000-8000-000000000001', $1,
                 TIMESTAMPTZ '2026-09-20 01:00:00+00',
                 TIMESTAMPTZ '2026-09-20 02:00:00+00')`,
      [fixture.roomOneId], '23503');
    await expectSqlError(client,
      `INSERT INTO booking_room_assignment (
         booking_id, room_id, assigned_at, unassigned_at
       ) VALUES ($1, '00000000-0000-7000-8000-000000000002',
                 TIMESTAMPTZ '2026-09-20 01:00:00+00',
                 TIMESTAMPTZ '2026-09-20 02:00:00+00')`,
      [fixture.bookingId], '23503');
    await expectSqlError(client,
      `INSERT INTO booking_room_assignment (booking_id, room_id)
       VALUES (NULL, $1)`,
      [fixture.roomOneId], '23502');
    await expectSqlError(client,
      `INSERT INTO booking_room_assignment (booking_id, room_id)
       VALUES ($1, NULL)`,
      [fixture.bookingId], '23502');
    await expectSqlError(client,
      `INSERT INTO booking_room_assignment (
         assignment_id, booking_id, room_id, assigned_at, unassigned_at
       ) VALUES (uuidv4(), $1, $2,
                 TIMESTAMPTZ '2026-09-20 01:00:00+00',
                 TIMESTAMPTZ '2026-09-20 02:00:00+00')`,
      [fixture.bookingId, fixture.roomOneId], '23514');
    await expectSqlError(client,
      `INSERT INTO booking_room_assignment (
         assignment_id, booking_id, room_id, assigned_at, unassigned_at
       ) VALUES ('00000000-0000-0000-0000-000000000000', $1, $2,
                 TIMESTAMPTZ '2026-09-20 01:00:00+00',
                 TIMESTAMPTZ '2026-09-20 02:00:00+00')`,
      [fixture.bookingId, fixture.roomOneId], '23514');
    await expectSqlError(client,
      'DELETE FROM booking WHERE booking_id = $1', [fixture.bookingId], '23001');
    await expectSqlError(client,
      'DELETE FROM room WHERE room_id = $1', [fixture.roomOneId], '23001');
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

test('M2-S05 partial unique index rejects simultaneous open assignments', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const admin = new Client({ connectionString: process.env.PG_URL });
  const first = new Client({ connectionString: process.env.PG_URL });
  const second = new Client({ connectionString: process.env.PG_URL });
  const schema = `m2_assignment_race_${randomBytes(8).toString('hex')}`;
  let setupCommitted = false;

  await admin.connect();
  try {
    await admin.query('BEGIN');
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET LOCAL search_path TO "${schema}", public`);
    await applyMigrations(admin);
    const fixture = await seedBookingAndRooms(admin, randomBytes(4).toString('hex'));
    await admin.query('COMMIT');
    setupCommitted = true;

    await Promise.all([first.connect(), second.connect()]);
    await first.query('BEGIN');
    await second.query('BEGIN');
    await first.query(`SET LOCAL search_path TO "${schema}", public`);
    await second.query(`SET LOCAL search_path TO "${schema}", public`);
    const secondPid = (await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await first.query(
      `INSERT INTO booking_room_assignment (booking_id, room_id)
       VALUES ($1, $2)`,
      [fixture.bookingId, fixture.roomOneId],
    );
    const competingInsert = second.query(
      `INSERT INTO booking_room_assignment (booking_id, room_id)
       VALUES ($1, $2)`,
      [fixture.bookingId, fixture.roomTwoId],
    ).then(
      () => ({ ok: true }),
      (error) => ({ ok: false, error }),
    );

    let blocked = false;
    for (let attempt = 0; attempt < 40 && !blocked; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const waitState = await admin.query(
        'SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked',
        [secondPid],
      );
      blocked = waitState.rows[0].blocked;
    }
    await first.query('COMMIT');
    const competingResult = await competingInsert;
    assert.equal(competingResult.ok, false,
      'the second concurrent open assignment must fail');
    assert.equal(competingResult.error.code, '23505',
      `${competingResult.error.message}; search path: ${competingResult.error.schema ?? 'unknown'}`);
    await second.query('ROLLBACK');
    assert.equal(blocked, true, 'the second insert must wait on the first transaction');

    const count = await admin.query(
      `SELECT count(*)::integer AS open_count
         FROM "${schema}".booking_room_assignment
        WHERE booking_id = $1
          AND unassigned_at IS NULL`,
      [fixture.bookingId],
    );
    assert.equal(count.rows[0].open_count, 1);
  } finally {
    if (!setupCommitted) {
      try { await admin.query('ROLLBACK'); } catch {}
    }
    try { await first.query('ROLLBACK'); } catch {}
    try { await second.query('ROLLBACK'); } catch {}
    try { await first.end(); } catch {}
    try { await second.end(); } catch {}
    if (setupCommitted) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
    await admin.end();
  }
});
