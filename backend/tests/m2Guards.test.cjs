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
  'm2_005_assignment_guards.sql',
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

async function seedBase(client, suffix) {
  const branch = await client.query('INSERT INTO branch DEFAULT VALUES RETURNING branch_id');
  const actor = await client.query(
    'INSERT INTO user_account DEFAULT VALUES RETURNING user_id',
  );
  const guest = await client.query('INSERT INTO guest DEFAULT VALUES RETURNING guest_id');
  const type = await client.query(
    `INSERT INTO room_type (name, capacity, base_daily_rate)
     VALUES ($1, 2, 20000) RETURNING room_type_id`,
    [`Guard Type ${suffix}`],
  );

  const roomIds = [];
  for (const label of ['A', 'B', 'C']) {
    const room = await client.query(
      `INSERT INTO room (room_number, branch_id, room_type_id)
       VALUES ($1, $2, $3) RETURNING room_id`,
      [`${label}-${suffix}`, branch.rows[0].branch_id, type.rows[0].room_type_id],
    );
    roomIds.push(room.rows[0].room_id);
  }

  return {
    actorId: actor.rows[0].user_id,
    guestId: guest.rows[0].guest_id,
    roomIds,
  };
}

async function createBooking(client, base, reference, checkIn, checkOut) {
  const booking = await client.query(
    `INSERT INTO booking (
       booking_ref, check_in_date, check_out_date, booking_channel,
       guest_count, rate_snapshot, guest_id, created_by
     ) VALUES ($1, $2, $3, 'FRONT_DESK', 2, 20000, $4, $5)
     RETURNING booking_id`,
    [reference, checkIn, checkOut, base.guestId, base.actorId],
  );
  const bookingId = booking.rows[0].booking_id;
  await client.query(
    `INSERT INTO booking_status_history (
       booking_id, old_status, new_status, changed_by, reason
     ) VALUES ($1, NULL, 'BOOKED', $2, 'Guard fixture')`,
    [bookingId, base.actorId],
  );
  return bookingId;
}

async function createOpenAssignment(client, bookingId, roomId, assignedAt) {
  const assignment = await client.query(
    `INSERT INTO booking_room_assignment (booking_id, room_id, assigned_at)
     VALUES ($1, $2, $3) RETURNING assignment_id`,
    [bookingId, roomId, assignedAt],
  );
  return assignment.rows[0].assignment_id;
}

async function checkDeferredConstraints(client) {
  await client.query('SET CONSTRAINTS ALL IMMEDIATE');
  await client.query('SET CONSTRAINTS ALL DEFERRED');
}

async function expectTransactionError(client, work, code, constraint) {
  await client.query('SAVEPOINT expected_error');
  let caught;
  try {
    await work();
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
  } catch (error) {
    caught = error;
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT expected_error');
    await client.query('RELEASE SAVEPOINT expected_error');
    await client.query('SET CONSTRAINTS ALL DEFERRED');
  }
  assert.ok(caught, `Expected PostgreSQL error ${code}`);
  assert.equal(caught.code, code, caught.message);
  if (constraint) {
    const acceptedConstraints = Array.isArray(constraint) ? constraint : [constraint];
    assert.ok(
      acceptedConstraints.includes(caught.constraint),
      `Expected constraint ${acceptedConstraints.join(' or ')}, received ${caught.constraint}`,
    );
  }
}

test('M2-S06 rejects direct overlap/pointer violations and accepts adjacent stays', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const client = new Client({ connectionString: process.env.PG_URL });
  const schema = `m2_guards_test_${randomBytes(8).toString('hex')}`;
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}", public`);
    await applyMigrations(client);

    const triggerMetadata = await client.query(
      `SELECT trigger.tgname, trigger.tgdeferrable, trigger.tginitdeferred
         FROM pg_trigger AS trigger
         JOIN pg_class AS relation ON relation.oid = trigger.tgrelid
         JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = $1
          AND trigger.tgname IN (
              'm2_booking_integrity_check',
              'm2_assignment_integrity_check',
              'm2_room_integrity_check'
          )
        ORDER BY trigger.tgname`,
      [schema],
    );
    assert.equal(triggerMetadata.rowCount, 3);
    for (const trigger of triggerMetadata.rows) {
      assert.equal(trigger.tgdeferrable, true);
      assert.equal(trigger.tginitdeferred, true);
    }

    const roomOpenIndex = await client.query(
      `SELECT indexdef
         FROM pg_indexes
        WHERE schemaname = $1
          AND indexname = 'booking_room_assignment_room_open_lookup'`,
      [schema],
    );
    assert.equal(roomOpenIndex.rowCount, 1);
    assert.match(roomOpenIndex.rows[0].indexdef, /\(room_id, booking_id\)/);
    assert.match(roomOpenIndex.rows[0].indexdef, /WHERE \(unassigned_at IS NULL\)/);

    const suffix = randomBytes(4).toString('hex');
    const base = await seedBase(client, suffix);
    const firstBookingId = await createBooking(
      client, base, `GUARD-A-${suffix}`, '2026-12-01', '2026-12-03',
    );
    const firstAssignmentId = await createOpenAssignment(
      client, firstBookingId, base.roomIds[0], '2026-09-20T01:00:00Z',
    );
    const adjacentBookingId = await createBooking(
      client, base, `GUARD-B-${suffix}`, '2026-12-03', '2026-12-05',
    );
    const adjacentAssignmentId = await createOpenAssignment(
      client, adjacentBookingId, base.roomIds[0], '2026-09-20T02:00:00Z',
    );
    await checkDeferredConstraints(client);

    const adjacentRows = await client.query(
      `SELECT count(*)::integer AS open_count
         FROM booking_room_assignment
        WHERE room_id = $1
          AND unassigned_at IS NULL`,
      [base.roomIds[0]],
    );
    assert.equal(adjacentRows.rows[0].open_count, 2,
      'adjacent active stays may keep separate open assignments on one room');

    await expectTransactionError(client, async () => {
      const overlappingBookingId = await createBooking(
        client, base, `GUARD-OVERLAP-${suffix}`, '2026-12-02', '2026-12-04',
      );
      await createOpenAssignment(
        client, overlappingBookingId, base.roomIds[0], '2026-09-20T03:00:00Z',
      );
    }, '23P01', 'booking_room_assignment_no_room_overlap');

    await expectTransactionError(client, async () => {
      await client.query(
        `UPDATE booking
            SET check_in_date = '2026-12-02', updated_at = CURRENT_TIMESTAMP
          WHERE booking_id = $1`,
        [adjacentBookingId],
      );
    }, '23P01', 'booking_room_assignment_no_room_overlap');

    await expectTransactionError(client, async () => {
      await client.query(
        'UPDATE room SET booking_id = $1 WHERE room_id = $2',
        [firstBookingId, base.roomIds[0]],
      );
    }, '23514', [
      'booking_non_checked_in_pointer_check',
      'room_current_booking_pointer_check',
    ]);

    await expectTransactionError(client, async () => {
      await client.query(
        `UPDATE room
            SET operational_status = 'OCCUPIED'
          WHERE room_id = $1`,
        [base.roomIds[0]],
      );
    }, '23514', [
      'room_missing_current_booking_pointer_check',
      'booking_checked_in_room_pointer_check',
    ]);

    await expectTransactionError(client, async () => {
      await client.query(
        `UPDATE booking
            SET status = 'CHECKED_IN',
                actual_check_in = TIMESTAMPTZ '2026-12-01 08:00:00+00',
                updated_at = CURRENT_TIMESTAMP
          WHERE booking_id = $1`,
        [firstBookingId],
      );
    }, '23514', 'booking_checked_in_room_pointer_check');

    await expectTransactionError(client, async () => {
      await client.query(
        `UPDATE booking_room_assignment
            SET unassigned_at = TIMESTAMPTZ '2026-09-20 04:00:00+00'
          WHERE assignment_id = $1`,
        [firstAssignmentId],
      );
    }, '23514', 'booking_active_open_assignment_check');

    await client.query(
      `UPDATE booking
          SET status = 'CHECKED_IN',
              actual_check_in = TIMESTAMPTZ '2026-12-01 08:00:00+00',
              updated_at = CURRENT_TIMESTAMP
        WHERE booking_id = $1`,
      [firstBookingId],
    );
    await client.query(
      `UPDATE room
          SET booking_id = $1, operational_status = 'OCCUPIED'
        WHERE room_id = $2`,
      [firstBookingId, base.roomIds[0]],
    );
    await client.query(
      `INSERT INTO booking_status_history (
         booking_id, old_status, new_status, changed_by, reason
       ) VALUES ($1, 'BOOKED', 'CHECKED_IN', $2, 'Valid coordinated check-in')`,
      [firstBookingId, base.actorId],
    );
    await checkDeferredConstraints(client);

    await expectTransactionError(client, async () => {
      await client.query(
        `UPDATE room
            SET booking_id = NULL, operational_status = 'AVAILABLE'
          WHERE room_id = $1`,
        [base.roomIds[0]],
      );
    }, '23514', 'room_missing_current_booking_pointer_check');

    await client.query(
      `UPDATE booking_room_assignment
          SET unassigned_at = TIMESTAMPTZ '2026-09-21 01:00:00+00'
        WHERE assignment_id = $1`,
      [firstAssignmentId],
    );
    await client.query(
      `UPDATE room
          SET booking_id = NULL, operational_status = 'CLEANING'
        WHERE room_id = $1`,
      [base.roomIds[0]],
    );
    await client.query(
      `UPDATE booking
          SET status = 'CHECKED_OUT',
              actual_check_out = TIMESTAMPTZ '2026-12-03 08:00:00+00',
              updated_at = CURRENT_TIMESTAMP
        WHERE booking_id = $1`,
      [firstBookingId],
    );
    await client.query(
      `INSERT INTO booking_status_history (
         booking_id, old_status, new_status, changed_by, reason
       ) VALUES ($1, 'CHECKED_IN', 'CHECKED_OUT', $2, 'Valid coordinated checkout')`,
      [firstBookingId, base.actorId],
    );
    await checkDeferredConstraints(client);

    await expectTransactionError(client, async () => {
      await client.query(
        `UPDATE booking
            SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
          WHERE booking_id = $1`,
        [adjacentBookingId],
      );
    }, '23514', 'booking_terminal_open_assignment_check');

    await client.query(
      `UPDATE booking_room_assignment
          SET unassigned_at = TIMESTAMPTZ '2026-09-21 02:00:00+00'
        WHERE assignment_id = $1`,
      [adjacentAssignmentId],
    );
    await client.query(
      `UPDATE booking
          SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
        WHERE booking_id = $1`,
      [adjacentBookingId],
    );
    await client.query(
      `INSERT INTO booking_status_history (
         booking_id, old_status, new_status, changed_by, reason
       ) VALUES ($1, 'BOOKED', 'CANCELLED', $2, 'Valid coordinated cancellation')`,
      [adjacentBookingId, base.actorId],
    );
    await checkDeferredConstraints(client);

    await expectTransactionError(client, async () => {
      await createOpenAssignment(
        client, firstBookingId, base.roomIds[1], '2026-09-22T01:00:00Z',
      );
    }, '23514', 'booking_terminal_open_assignment_check');
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

test('M2-S06 serializes simultaneous overlapping room moves', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const admin = new Client({ connectionString: process.env.PG_URL });
  const first = new Client({ connectionString: process.env.PG_URL });
  const second = new Client({ connectionString: process.env.PG_URL });
  const schema = `m2_guard_race_${randomBytes(8).toString('hex')}`;
  let setupCommitted = false;

  await admin.connect();
  try {
    await admin.query('BEGIN');
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET LOCAL search_path TO "${schema}", public`);
    await applyMigrations(admin);
    const suffix = randomBytes(4).toString('hex');
    const base = await seedBase(admin, suffix);
    const firstBookingId = await createBooking(
      admin, base, `RACE-A-${suffix}`, '2027-01-01', '2027-01-04',
    );
    const secondBookingId = await createBooking(
      admin, base, `RACE-B-${suffix}`, '2027-01-02', '2027-01-05',
    );
    const firstAssignmentId = await createOpenAssignment(
      admin, firstBookingId, base.roomIds[0], '2026-09-20T01:00:00Z',
    );
    const secondAssignmentId = await createOpenAssignment(
      admin, secondBookingId, base.roomIds[1], '2026-09-20T01:00:00Z',
    );
    await admin.query('COMMIT');
    setupCommitted = true;

    await Promise.all([first.connect(), second.connect()]);
    await first.query('BEGIN');
    await second.query('BEGIN');
    await first.query(`SET LOCAL search_path TO "${schema}", public`);
    await second.query(`SET LOCAL search_path TO "${schema}", public`);
    const secondPid = (await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;

    await first.query(
      `UPDATE booking_room_assignment
          SET unassigned_at = TIMESTAMPTZ '2026-09-21 01:00:00+00'
        WHERE assignment_id = $1`,
      [firstAssignmentId],
    );
    await second.query(
      `UPDATE booking_room_assignment
          SET unassigned_at = TIMESTAMPTZ '2026-09-21 01:00:00+00'
        WHERE assignment_id = $1`,
      [secondAssignmentId],
    );
    await first.query(
      `INSERT INTO booking_room_assignment (booking_id, room_id, assigned_at)
       VALUES ($1, $2, TIMESTAMPTZ '2026-09-21 01:00:00+00')`,
      [firstBookingId, base.roomIds[2]],
    );
    const competingMove = second.query(
      `INSERT INTO booking_room_assignment (booking_id, room_id, assigned_at)
       VALUES ($1, $2, TIMESTAMPTZ '2026-09-21 01:00:00+00')`,
      [secondBookingId, base.roomIds[2]],
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
    const competingResult = await competingMove;
    assert.equal(competingResult.ok, false, 'the overlapping concurrent move must fail');
    assert.equal(competingResult.error.code, '23P01', competingResult.error.message);
    assert.equal(
      competingResult.error.constraint,
      'booking_room_assignment_no_room_overlap',
    );
    await second.query('ROLLBACK');
    assert.equal(blocked, true, 'the competing room move must wait on the room lock');

    const openAssignments = await admin.query(
      `SELECT booking_id, room_id
         FROM "${schema}".booking_room_assignment
        WHERE booking_id IN ($1, $2)
          AND unassigned_at IS NULL
        ORDER BY booking_id`,
      [firstBookingId, secondBookingId],
    );
    assert.equal(openAssignments.rowCount, 2);
    const roomByBooking = new Map(
      openAssignments.rows.map((row) => [row.booking_id, row.room_id]),
    );
    assert.equal(roomByBooking.get(firstBookingId), base.roomIds[2]);
    assert.equal(roomByBooking.get(secondBookingId), base.roomIds[1]);
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
