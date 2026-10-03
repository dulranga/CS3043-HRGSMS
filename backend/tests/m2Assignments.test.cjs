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

async function seedBookingLinesAndRooms(client, suffix) {
  const branch = await client.query('INSERT INTO branch DEFAULT VALUES RETURNING branch_id');
  const actor = await client.query(
    'INSERT INTO user_account DEFAULT VALUES RETURNING user_id',
  );
  const guest = await client.query('INSERT INTO guest DEFAULT VALUES RETURNING guest_id');
  const roomType = await client.query(
    `INSERT INTO room_type (name, capacity, base_daily_rate)
     VALUES ($1, 2, 18000) RETURNING room_type_id`,
    [`Assignment Type ${suffix}`],
  );
  const booking = await client.query(
    `INSERT INTO booking (booking_ref, booking_channel, guest_id, created_by)
     VALUES ($1, 'FRONT_DESK', $2, $3)
     RETURNING booking_id`,
    [`ASSIGN-${suffix}`, guest.rows[0].guest_id, actor.rows[0].user_id],
  );
  const firstLine = await client.query(
    `INSERT INTO booking_room_line (
       booking_id, stay_start_date, stay_end_date, guest_count, rate_snapshot
     ) VALUES ($1, '2026-12-01', '2026-12-03', 2, 18000)
     RETURNING line_id`,
    [booking.rows[0].booking_id],
  );
  const secondLine = await client.query(
    `INSERT INTO booking_room_line (
       booking_id, stay_start_date, stay_end_date, guest_count, rate_snapshot
     ) VALUES ($1, '2026-12-01', '2026-12-03', 1, 18000)
     RETURNING line_id`,
    [booking.rows[0].booking_id],
  );
  const roomOne = await client.query(
    `INSERT INTO room (room_number, branch_id, room_type_id)
     VALUES ($1, $2, $3) RETURNING room_id`,
    [`A-${suffix}`, branch.rows[0].branch_id, roomType.rows[0].room_type_id],
  );
  const roomTwo = await client.query(
    `INSERT INTO room (room_number, branch_id, room_type_id)
     VALUES ($1, $2, $3) RETURNING room_id`,
    [`B-${suffix}`, branch.rows[0].branch_id, roomType.rows[0].room_type_id],
  );
  return {
    bookingId: booking.rows[0].booking_id,
    firstLineId: firstLine.rows[0].line_id,
    secondLineId: secondLine.rows[0].line_id,
    roomOneId: roomOne.rows[0].room_id,
    roomTwoId: roomTwo.rows[0].room_id,
  };
}

async function expectSqlError(client, sql, values, codes) {
  const expectedCodes = Array.isArray(codes) ? codes : [codes];
  await client.query('SAVEPOINT expected_error');
  try {
    await assert.rejects(
      client.query(sql, values),
      (error) => expectedCodes.includes(error.code),
      `Expected PostgreSQL error ${expectedCodes.join(' or ')}`,
    );
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT expected_error');
    await client.query('RELEASE SAVEPOINT expected_error');
  }
}

test('M2-S05 creates line-based room assignment history', async () => {
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
      'assignment_id', 'line_id', 'room_id', 'assigned_at', 'unassigned_at',
      'occupied_from', 'occupied_to',
    ]);
    assert.equal(columns.rows.some(({ column_name }) => column_name === 'booking_id'), false);
    assert.equal(
      columns.rows.find(({ column_name }) => column_name === 'assignment_id').data_type,
      'uuid',
    );
    assert.match(
      columns.rows.find(({ column_name }) => column_name === 'assigned_at').column_default,
      /CURRENT_TIMESTAMP/i,
    );
    for (const columnName of ['unassigned_at', 'occupied_from', 'occupied_to']) {
      const column = columns.rows.find(({ column_name }) => column_name === columnName);
      assert.equal(column.data_type, 'timestamp with time zone');
      assert.equal(column.is_nullable, 'YES');
    }

    const indexes = await client.query(
      `SELECT indexname, indexdef
         FROM pg_indexes
        WHERE schemaname = $1
          AND tablename = 'booking_room_assignment'
        ORDER BY indexname`,
      [schema],
    );
    const indexNames = indexes.rows.map(({ indexname }) => indexname);
    assert.ok(indexNames.includes('booking_room_assignment_one_open_per_line'));
    assert.ok(indexNames.includes('booking_room_assignment_line_history_idx'));
    assert.ok(indexNames.includes('booking_room_assignment_room_open_idx'));
    const openLineIndex = indexes.rows.find(
      ({ indexname }) => indexname === 'booking_room_assignment_one_open_per_line',
    );
    assert.match(openLineIndex.indexdef, /CREATE UNIQUE INDEX/i);
    assert.match(openLineIndex.indexdef, /\(line_id\)/i);
    assert.match(openLineIndex.indexdef, /WHERE \(unassigned_at IS NULL\)/i);
    const openRoomIndex = indexes.rows.find(
      ({ indexname }) => indexname === 'booking_room_assignment_room_open_idx',
    );
    assert.doesNotMatch(openRoomIndex.indexdef, /CREATE UNIQUE INDEX/i);

    const fixture = await seedBookingLinesAndRooms(client, randomBytes(4).toString('hex'));
    const firstAssignment = await client.query(
      `INSERT INTO booking_room_assignment (line_id, room_id, assigned_at)
       VALUES ($1, $2, TIMESTAMPTZ '2026-09-20 01:00:00+00')
       RETURNING assignment_id, unassigned_at`,
      [fixture.firstLineId, fixture.roomOneId],
    );
    const firstAssignmentId = firstAssignment.rows[0].assignment_id;
    assert.equal(firstAssignment.rows[0].unassigned_at, null);
    const version = await client.query(
      'SELECT uuid_extract_version($1::uuid) AS assignment_version',
      [firstAssignmentId],
    );
    assert.equal(version.rows[0].assignment_version, 7);

    await expectSqlError(
      client,
      `INSERT INTO booking_room_assignment (line_id, room_id)
       VALUES ($1, $2)`,
      [fixture.firstLineId, fixture.roomTwoId],
      '23505',
    );

    await client.query(
      `UPDATE booking_room_assignment
          SET unassigned_at = TIMESTAMPTZ '2026-09-20 06:00:00+00',
              occupied_from = TIMESTAMPTZ '2026-09-20 03:00:00+00',
              occupied_to = TIMESTAMPTZ '2026-09-20 05:00:00+00'
        WHERE assignment_id = $1`,
      [firstAssignmentId],
    );
    const movedAssignment = await client.query(
      `INSERT INTO booking_room_assignment (line_id, room_id, assigned_at)
       VALUES ($1, $2, TIMESTAMPTZ '2026-09-20 06:00:00+00')
       RETURNING assignment_id`,
      [fixture.firstLineId, fixture.roomTwoId],
    );
    const secondLineAssignment = await client.query(
      `INSERT INTO booking_room_assignment (line_id, room_id, assigned_at)
       VALUES ($1, $2, TIMESTAMPTZ '2026-09-20 02:00:00+00')
       RETURNING assignment_id`,
      [fixture.secondLineId, fixture.roomTwoId],
    );
    assert.ok(secondLineAssignment.rows[0].assignment_id);

    const bookingAssignments = await client.query(
      `SELECT assignment.assignment_id, assignment.line_id, assignment.room_id,
              assignment.unassigned_at
         FROM booking_room_assignment AS assignment
         JOIN booking_room_line AS line ON line.line_id = assignment.line_id
        WHERE line.booking_id = $1
        ORDER BY assignment.assigned_at, assignment.assignment_id`,
      [fixture.bookingId],
    );
    assert.equal(bookingAssignments.rowCount, 3);
    assert.equal(
      bookingAssignments.rows.filter(({ unassigned_at }) => unassigned_at === null).length,
      2,
    );
    assert.ok(
      bookingAssignments.rows.some(
        ({ assignment_id }) => assignment_id === movedAssignment.rows[0].assignment_id,
      ),
    );

    const insertAssignmentSql = `INSERT INTO booking_room_assignment (
      line_id, room_id, assigned_at, unassigned_at, occupied_from, occupied_to
    ) VALUES ($1, $2, $3, $4, $5, $6)`;
    await expectSqlError(
      client,
      insertAssignmentSql,
      [fixture.firstLineId, fixture.roomOneId, '2026-09-20T07:00:00Z',
        '2026-09-20T07:00:00Z', null, null],
      '23514',
    );
    await expectSqlError(
      client,
      insertAssignmentSql,
      [fixture.firstLineId, fixture.roomOneId, '2026-09-20T08:00:00Z',
        '2026-09-20T07:00:00Z', null, null],
      '23514',
    );
    await expectSqlError(
      client,
      insertAssignmentSql,
      [fixture.firstLineId, fixture.roomOneId, '2026-09-20T07:00:00Z',
        '2026-09-20T08:00:00Z', null, '2026-09-20T07:30:00Z'],
      '23514',
    );
    await expectSqlError(
      client,
      insertAssignmentSql,
      [fixture.firstLineId, fixture.roomOneId, '2026-09-20T07:00:00Z',
        '2026-09-20T08:00:00Z', '2026-09-20T07:30:00Z',
        '2026-09-20T07:30:00Z'],
      '23514',
    );
    await expectSqlError(
      client,
      `INSERT INTO booking_room_assignment (line_id, room_id, assigned_at, unassigned_at)
       VALUES ('00000000-0000-7000-8000-000000000001', $1,
               TIMESTAMPTZ '2026-09-20 01:00:00+00',
               TIMESTAMPTZ '2026-09-20 02:00:00+00')`,
      [fixture.roomOneId],
      '23503',
    );
    await expectSqlError(
      client,
      `INSERT INTO booking_room_assignment (line_id, room_id, assigned_at, unassigned_at)
       VALUES ($1, '00000000-0000-7000-8000-000000000002',
               TIMESTAMPTZ '2026-09-20 01:00:00+00',
               TIMESTAMPTZ '2026-09-20 02:00:00+00')`,
      [fixture.firstLineId],
      '23503',
    );
    await expectSqlError(
      client,
      'INSERT INTO booking_room_assignment (line_id, room_id) VALUES (NULL, $1)',
      [fixture.roomOneId],
      '23502',
    );
    await expectSqlError(
      client,
      'INSERT INTO booking_room_assignment (line_id, room_id) VALUES ($1, NULL)',
      [fixture.firstLineId],
      '23502',
    );
    await expectSqlError(
      client,
      `INSERT INTO booking_room_assignment (
         assignment_id, line_id, room_id, assigned_at, unassigned_at
       ) VALUES (uuidv4(), $1, $2,
                 TIMESTAMPTZ '2026-09-20 01:00:00+00',
                 TIMESTAMPTZ '2026-09-20 02:00:00+00')`,
      [fixture.firstLineId, fixture.roomOneId],
      '23514',
    );
    await expectSqlError(
      client,
      'DELETE FROM booking_room_line WHERE line_id = $1',
      [fixture.firstLineId],
      ['23001', '23503'],
    );
    await expectSqlError(
      client,
      'DELETE FROM room WHERE room_id = $1',
      [fixture.roomOneId],
      ['23001', '23503'],
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

test('M2-S05 rejects simultaneous open assignments for one line', async () => {
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
    const fixture = await seedBookingLinesAndRooms(admin, randomBytes(4).toString('hex'));
    await admin.query('COMMIT');
    setupCommitted = true;

    await Promise.all([first.connect(), second.connect()]);
    await first.query('BEGIN');
    await second.query('BEGIN');
    await first.query(`SET LOCAL search_path TO "${schema}", public`);
    await second.query(`SET LOCAL search_path TO "${schema}", public`);
    const secondPid = (await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;

    await first.query(
      `INSERT INTO booking_room_assignment (line_id, room_id)
       VALUES ($1, $2)`,
      [fixture.firstLineId, fixture.roomOneId],
    );
    const competingInsert = second.query(
      `INSERT INTO booking_room_assignment (line_id, room_id)
       VALUES ($1, $2)`,
      [fixture.firstLineId, fixture.roomTwoId],
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
    assert.equal(competingResult.ok, false, 'the competing open assignment must fail');
    assert.equal(competingResult.error.code, '23505');
    assert.equal(blocked, true, 'the competing insert must wait on the first transaction');
    await second.query('ROLLBACK');

    const count = await admin.query(
      `SELECT count(*)::integer AS open_count
         FROM "${schema}".booking_room_assignment
        WHERE line_id = $1
          AND unassigned_at IS NULL`,
      [fixture.firstLineId],
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
