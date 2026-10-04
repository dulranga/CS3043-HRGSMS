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
  'm2_005_reservation_integrity_guards.sql',
].map((file) => readFileSync(path.join(__dirname, '..', 'migrations', file), 'utf8'));

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

async function applyMigrations(client) {
  await client.query(parentFixturesSql);
  for (const migration of migrations) {
    await client.query(migration);
  }
}

async function createBaseFixture(client, suffix) {
  const actor = await client.query(
    'INSERT INTO user_account DEFAULT VALUES RETURNING user_id',
  );
  const guest = await client.query('INSERT INTO guest DEFAULT VALUES RETURNING guest_id');
  const branchOne = await client.query('INSERT INTO branch DEFAULT VALUES RETURNING branch_id');
  const branchTwo = await client.query('INSERT INTO branch DEFAULT VALUES RETURNING branch_id');
  const roomType = await client.query(
    `INSERT INTO room_type (name, capacity, base_daily_rate)
     VALUES ($1, 3, 18000) RETURNING room_type_id`,
    [`Guard Type ${suffix}`],
  );
  const roomTypeTwo = await client.query(
    `INSERT INTO room_type (name, capacity, base_daily_rate)
     VALUES ($1, 3, 21000) RETURNING room_type_id`,
    [`Guard Type Two ${suffix}`],
  );

  const roomOne = await client.query(
    `INSERT INTO room (room_number, branch_id, room_type_id)
     VALUES ($1, $2, $3) RETURNING room_id`,
    [`101-${suffix}`, branchOne.rows[0].branch_id, roomType.rows[0].room_type_id],
  );
  const roomTwo = await client.query(
    `INSERT INTO room (room_number, branch_id, room_type_id)
     VALUES ($1, $2, $3) RETURNING room_id`,
    [`102-${suffix}`, branchOne.rows[0].branch_id, roomType.rows[0].room_type_id],
  );
  const roomThree = await client.query(
    `INSERT INTO room (room_number, branch_id, room_type_id)
     VALUES ($1, $2, $3) RETURNING room_id`,
    [`201-${suffix}`, branchTwo.rows[0].branch_id, roomTypeTwo.rows[0].room_type_id],
  );

  return {
    actorId: actor.rows[0].user_id,
    guestId: guest.rows[0].guest_id,
    branchOneId: branchOne.rows[0].branch_id,
    branchTwoId: branchTwo.rows[0].branch_id,
    roomTypeId: roomType.rows[0].room_type_id,
    roomTypeTwoId: roomTypeTwo.rows[0].room_type_id,
    roomOneId: roomOne.rows[0].room_id,
    roomTwoId: roomTwo.rows[0].room_id,
    roomThreeId: roomThree.rows[0].room_id,
  };
}

async function createBooking(client, fixture, reference) {
  const result = await client.query(
    `INSERT INTO booking (booking_ref, booking_channel, guest_id, created_by)
     VALUES ($1, 'FRONT_DESK', $2, $3)
     RETURNING booking_id`,
    [reference, fixture.guestId, fixture.actorId],
  );
  return result.rows[0].booking_id;
}

async function createBookedLine(
  client,
  { bookingId, actorId, startDate, endDate, guestCount = 1, rate = 18000 },
) {
  const line = await client.query(
    `INSERT INTO booking_room_line (
       booking_id, stay_start_date, stay_end_date, guest_count, rate_snapshot
     ) VALUES ($1, $2, $3, $4, $5)
     RETURNING line_id`,
    [bookingId, startDate, endDate, guestCount, rate],
  );
  const lineId = line.rows[0].line_id;
  await client.query(
    `INSERT INTO booking_room_line_status_history (
       line_id, old_status, new_status, changed_by, reason
     ) VALUES ($1, NULL, 'BOOKED', $2, 'Initial booking')`,
    [lineId, actorId],
  );
  return lineId;
}

async function assignRoom(client, lineId, roomId) {
  const assignment = await client.query(
    `INSERT INTO booking_room_assignment (line_id, room_id)
     VALUES ($1, $2)
     RETURNING assignment_id, assigned_at`,
    [lineId, roomId],
  );
  return assignment.rows[0];
}

async function flushDeferredConstraints(client) {
  await client.query('SET CONSTRAINTS ALL IMMEDIATE');
  await client.query('SET CONSTRAINTS ALL DEFERRED');
}

async function expectOperationError(client, operation, codes, checkDeferred = false) {
  const expectedCodes = Array.isArray(codes) ? codes : [codes];
  await client.query('SAVEPOINT expected_error');
  try {
    await assert.rejects(
      async () => {
        await operation();
        if (checkDeferred) {
          await client.query('SET CONSTRAINTS ALL IMMEDIATE');
        }
      },
      (error) => expectedCodes.includes(error.code),
      `Expected PostgreSQL error ${expectedCodes.join(' or ')}`,
    );
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT expected_error');
    await client.query('RELEASE SAVEPOINT expected_error');
    await client.query('SET CONSTRAINTS ALL DEFERRED');
  }
}

async function transitionLine(client, lineId, actorId, oldStatus, newStatus, reason) {
  await client.query(
    'UPDATE booking_room_line SET status = $2, updated_at = CURRENT_TIMESTAMP WHERE line_id = $1',
    [lineId, newStatus],
  );
  await client.query(
    `INSERT INTO booking_room_line_status_history (
       line_id, old_status, new_status, changed_by, reason
     ) VALUES ($1, $2, $3, $4, $5)`,
    [lineId, oldStatus, newStatus, actorId, reason],
  );
}

test('M2-S06 enforces line, assignment, occupancy and status-history lifecycle', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const client = new Client({ connectionString: process.env.PG_URL });
  const schema = `m2_guards_lifecycle_${randomBytes(8).toString('hex')}`;
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}", public`);
    await applyMigrations(client);

    const triggers = await client.query(
      `SELECT trigger_name
         FROM information_schema.triggers
        WHERE trigger_schema = $1
          AND event_object_table IN (
              'booking_room_line', 'booking_room_assignment', 'room_block',
              'room', 'branch', 'room_type'
          )
        ORDER BY trigger_name`,
      [schema],
    );
    const triggerNames = new Set(triggers.rows.map(({ trigger_name }) => trigger_name));
    for (const name of [
      'm2_assignment_write_guard',
      'm2_room_line_write_guard',
      'm2_room_line_target_guard',
      'm2_room_block_write_guard',
      'm2_room_inventory_change_guard',
      'm2_branch_deactivation_guard',
      'm2_room_type_deactivation_guard',
    ]) {
      assert.ok(triggerNames.has(name), `missing trigger ${name}`);
    }

    const fixture = await createBaseFixture(client, randomBytes(3).toString('hex'));
    const bookingId = await createBooking(client, fixture, `LIFE-${randomBytes(4).toString('hex')}`);
    const firstLineId = await createBookedLine(client, {
      bookingId,
      actorId: fixture.actorId,
      startDate: '2026-12-01',
      endDate: '2026-12-04',
    });
    const secondLineId = await createBookedLine(client, {
      bookingId,
      actorId: fixture.actorId,
      startDate: '2026-12-01',
      endDate: '2026-12-04',
    });
    const firstAssignment = await assignRoom(client, firstLineId, fixture.roomOneId);
    const secondAssignment = await assignRoom(client, secondLineId, fixture.roomTwoId);
    await flushDeferredConstraints(client);

    const openCount = await client.query(
      `SELECT count(*)::integer AS count
         FROM booking_room_assignment
        WHERE line_id IN ($1, $2) AND unassigned_at IS NULL`,
      [firstLineId, secondLineId],
    );
    assert.equal(openCount.rows[0].count, 2);

    await expectOperationError(
      client,
      () => client.query(
        "UPDATE booking_room_line SET status = 'CHECKED_OUT' WHERE line_id = $1",
        [firstLineId],
      ),
      '23514',
    );

    await expectOperationError(
      client,
      async () => {
        const incompleteLine = await createBookedLine(client, {
          bookingId,
          actorId: fixture.actorId,
          startDate: '2027-01-01',
          endDate: '2027-01-02',
        });
        assert.ok(incompleteLine);
      },
      '23514',
      true,
    );

    await expectOperationError(
      client,
      async () => {
        await client.query(
          `UPDATE booking_room_assignment
              SET occupied_from = TIMESTAMPTZ '2026-12-01 06:00:00+00'
            WHERE assignment_id = $1`,
          [firstAssignment.assignment_id],
        );
        await client.query(
          "UPDATE booking_room_line SET status = 'CHECKED_IN' WHERE line_id = $1",
          [firstLineId],
        );
      },
      '23514',
      true,
    );

    await client.query(
      `UPDATE booking_room_assignment
          SET occupied_from = TIMESTAMPTZ '2026-12-01 06:00:00+00'
        WHERE assignment_id = $1`,
      [firstAssignment.assignment_id],
    );
    await transitionLine(
      client,
      firstLineId,
      fixture.actorId,
      'BOOKED',
      'CHECKED_IN',
      'Front desk check-in',
    );
    await flushDeferredConstraints(client);

    await client.query(
      `UPDATE booking_room_assignment
          SET occupied_to = TIMESTAMPTZ '2026-12-04 04:00:00+00',
              unassigned_at = TIMESTAMPTZ '2026-12-04 04:01:00+00'
        WHERE assignment_id = $1`,
      [firstAssignment.assignment_id],
    );
    await transitionLine(
      client,
      firstLineId,
      fixture.actorId,
      'CHECKED_IN',
      'CHECKED_OUT',
      'Completed stay',
    );
    await flushDeferredConstraints(client);

    await expectOperationError(
      client,
      () => client.query(
        'UPDATE booking_room_assignment SET unassigned_at = unassigned_at + interval \'1 second\' WHERE assignment_id = $1',
        [firstAssignment.assignment_id],
      ),
      '55000',
    );
    await expectOperationError(
      client,
      () => client.query(
        'DELETE FROM booking_room_assignment WHERE assignment_id = $1',
        [firstAssignment.assignment_id],
      ),
      '55000',
    );

    await expectOperationError(
      client,
      async () => {
        await transitionLine(
          client,
          secondLineId,
          fixture.actorId,
          'BOOKED',
          'CANCELLED',
          'Cancelled without releasing room',
        );
      },
      '23514',
      true,
    );

    await client.query(
      `UPDATE booking_room_assignment
          SET unassigned_at = assigned_at + interval '1 minute'
        WHERE assignment_id = $1`,
      [secondAssignment.assignment_id],
    );
    await transitionLine(
      client,
      secondLineId,
      fixture.actorId,
      'BOOKED',
      'CANCELLED',
      'Guest cancellation',
    );
    await flushDeferredConstraints(client);
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

test('M2-S06 enforces overlap, branch, block and checked-in room rules', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const client = new Client({ connectionString: process.env.PG_URL });
  const schema = `m2_guards_conflicts_${randomBytes(8).toString('hex')}`;
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}", public`);
    await applyMigrations(client);
    const fixture = await createBaseFixture(client, randomBytes(3).toString('hex'));

    const bookingOne = await createBooking(
      client,
      fixture,
      `CONFLICT-A-${randomBytes(4).toString('hex')}`,
    );
    const firstLineId = await createBookedLine(client, {
      bookingId: bookingOne,
      actorId: fixture.actorId,
      startDate: '2027-02-01',
      endDate: '2027-02-03',
    });
    const secondLineId = await createBookedLine(client, {
      bookingId: bookingOne,
      actorId: fixture.actorId,
      startDate: '2027-02-01',
      endDate: '2027-02-03',
    });
    const firstAssignment = await assignRoom(client, firstLineId, fixture.roomOneId);
    await assignRoom(client, secondLineId, fixture.roomTwoId);
    await flushDeferredConstraints(client);

    await expectOperationError(
      client,
      async () => {
        const booking = await createBooking(
          client,
          fixture,
          `OVERLAP-${randomBytes(4).toString('hex')}`,
        );
        const line = await createBookedLine(client, {
          bookingId: booking,
          actorId: fixture.actorId,
          startDate: '2027-02-02',
          endDate: '2027-02-04',
        });
        await assignRoom(client, line, fixture.roomOneId);
      },
      '23514',
    );

    const adjacentBooking = await createBooking(
      client,
      fixture,
      `ADJACENT-${randomBytes(4).toString('hex')}`,
    );
    const adjacentLineId = await createBookedLine(client, {
      bookingId: adjacentBooking,
      actorId: fixture.actorId,
      startDate: '2027-02-03',
      endDate: '2027-02-05',
    });
    const adjacentAssignment = await assignRoom(client, adjacentLineId, fixture.roomOneId);
    await flushDeferredConstraints(client);

    await expectOperationError(
      client,
      () => client.query(
        "UPDATE booking_room_line SET stay_start_date = '2027-02-02' WHERE line_id = $1",
        [adjacentLineId],
      ),
      '23514',
    );

    await expectOperationError(
      client,
      async () => {
        const crossBranchLine = await createBookedLine(client, {
          bookingId: bookingOne,
          actorId: fixture.actorId,
          startDate: '2027-03-01',
          endDate: '2027-03-03',
        });
        await assignRoom(client, crossBranchLine, fixture.roomThreeId);
      },
      '23514',
    );

    await expectOperationError(
      client,
      () => client.query(
        `INSERT INTO room_block (start_date, end_date, reason, room_id, created_by)
         VALUES ('2027-02-02', '2027-02-04', 'Overlapping work', $1, $2)`,
        [fixture.roomOneId, fixture.actorId],
      ),
      '23514',
    );

    await client.query(
      `INSERT INTO room_block (start_date, end_date, reason, room_id, created_by)
       VALUES ('2027-02-05', '2027-02-06', 'Adjacent work', $1, $2)`,
      [fixture.roomOneId, fixture.actorId],
    );

    await expectOperationError(
      client,
      () => client.query(
        `UPDATE room_block
            SET start_date = '2027-02-04'
          WHERE room_id = $1 AND reason = 'Adjacent work'`,
        [fixture.roomOneId],
      ),
      '23514',
    );

    await client.query(
      `INSERT INTO room_block (start_date, end_date, reason, room_id, created_by)
       VALUES ('2027-03-10', '2027-03-12', 'Existing outage', $1, $2)`,
      [fixture.roomThreeId, fixture.actorId],
    );
    await expectOperationError(
      client,
      async () => {
        const blockedBooking = await createBooking(
          client,
          fixture,
          `BLOCKED-${randomBytes(4).toString('hex')}`,
        );
        const blockedLine = await createBookedLine(client, {
          bookingId: blockedBooking,
          actorId: fixture.actorId,
          startDate: '2027-03-11',
          endDate: '2027-03-13',
        });
        await assignRoom(client, blockedLine, fixture.roomThreeId);
      },
      '23514',
    );

    await client.query(
      `UPDATE booking_room_assignment
          SET occupied_from = TIMESTAMPTZ '2027-02-01 06:00:00+00'
        WHERE assignment_id = $1`,
      [firstAssignment.assignment_id],
    );
    await transitionLine(
      client,
      firstLineId,
      fixture.actorId,
      'BOOKED',
      'CHECKED_IN',
      'First arrival',
    );
    await flushDeferredConstraints(client);

    await expectOperationError(
      client,
      async () => {
        await client.query(
          `UPDATE booking_room_assignment
              SET occupied_from = TIMESTAMPTZ '2027-02-03 06:00:00+00'
            WHERE assignment_id = $1`,
          [adjacentAssignment.assignment_id],
        );
        await transitionLine(
          client,
          adjacentLineId,
          fixture.actorId,
          'BOOKED',
          'CHECKED_IN',
          'Invalid second occupant',
        );
      },
      '23514',
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

test('M2-S06 protects room, branch and room-type state until assignment closure', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const client = new Client({ connectionString: process.env.PG_URL });
  const schema = `m2_guards_parents_${randomBytes(8).toString('hex')}`;
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}", public`);
    await applyMigrations(client);
    const fixture = await createBaseFixture(client, randomBytes(3).toString('hex'));
    const bookingId = await createBooking(
      client,
      fixture,
      `PARENT-${randomBytes(4).toString('hex')}`,
    );
    const lineId = await createBookedLine(client, {
      bookingId,
      actorId: fixture.actorId,
      startDate: '2027-04-01',
      endDate: '2027-04-04',
    });
    const assignment = await assignRoom(client, lineId, fixture.roomOneId);
    await flushDeferredConstraints(client);

    await client.query(
      "UPDATE room SET operational_status = 'CLEANING' WHERE room_id = $1",
      [fixture.roomThreeId],
    );
    const cleaningBooking = await createBooking(
      client,
      fixture,
      `CLEAN-${randomBytes(4).toString('hex')}`,
    );
    const cleaningLine = await createBookedLine(client, {
      bookingId: cleaningBooking,
      actorId: fixture.actorId,
      startDate: '2027-08-01',
      endDate: '2027-08-03',
    });
    const cleaningAssignment = await assignRoom(client, cleaningLine, fixture.roomThreeId);
    await flushDeferredConstraints(client);
    await expectOperationError(
      client,
      async () => {
        await client.query(
          `UPDATE booking_room_assignment
              SET occupied_from = TIMESTAMPTZ '2027-08-01 06:00:00+00'
            WHERE assignment_id = $1`,
          [cleaningAssignment.assignment_id],
        );
        await transitionLine(
          client,
          cleaningLine,
          fixture.actorId,
          'BOOKED',
          'CHECKED_IN',
          'Room is not ready',
        );
      },
      '23514',
    );

    for (const [sql, values] of [
      ['UPDATE room SET active = false WHERE room_id = $1', [fixture.roomOneId]],
      ["UPDATE room SET operational_status = 'OUT_OF_SERVICE' WHERE room_id = $1", [fixture.roomOneId]],
      ['UPDATE branch SET active = false WHERE branch_id = $1', [fixture.branchOneId]],
      ['UPDATE room_type SET active = false WHERE room_type_id = $1', [fixture.roomTypeId]],
      ['UPDATE room SET branch_id = $2 WHERE room_id = $1', [fixture.roomOneId, fixture.branchTwoId]],
    ]) {
      await expectOperationError(client, () => client.query(sql, values), '23514');
    }

    await client.query(
      `UPDATE booking_room_assignment
          SET unassigned_at = assigned_at + interval '1 minute'
        WHERE assignment_id = $1`,
      [assignment.assignment_id],
    );
    await transitionLine(
      client,
      lineId,
      fixture.actorId,
      'BOOKED',
      'CANCELLED',
      'Released before inventory changes',
    );
    await flushDeferredConstraints(client);

    await client.query(
      "UPDATE room SET active = false, operational_status = 'OUT_OF_SERVICE' WHERE room_id = $1",
      [fixture.roomOneId],
    );
    await client.query('UPDATE branch SET active = false WHERE branch_id = $1', [fixture.branchOneId]);
    await client.query(
      'UPDATE room_type SET active = false WHERE room_type_id = $1',
      [fixture.roomTypeId],
    );

    await expectOperationError(
      client,
      async () => {
        const inactiveBooking = await createBooking(
          client,
          fixture,
          `INACTIVE-${randomBytes(4).toString('hex')}`,
        );
        const inactiveLine = await createBookedLine(client, {
          bookingId: inactiveBooking,
          actorId: fixture.actorId,
          startDate: '2027-09-01',
          endDate: '2027-09-03',
        });
        await assignRoom(client, inactiveLine, fixture.roomOneId);
      },
      '23514',
    );

    const finalState = await client.query(
      `SELECT target_room.active AS room_active,
              target_room.operational_status,
              target_branch.active AS branch_active,
              target_type.active AS type_active
         FROM room AS target_room
         JOIN branch AS target_branch ON target_branch.branch_id = target_room.branch_id
         JOIN room_type AS target_type ON target_type.room_type_id = target_room.room_type_id
        WHERE target_room.room_id = $1`,
      [fixture.roomOneId],
    );
    assert.deepEqual(finalState.rows[0], {
      room_active: false,
      operational_status: 'OUT_OF_SERVICE',
      branch_active: false,
      type_active: false,
    });
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

async function waitUntilBlocked(admin, blockedPid) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const state = await admin.query(
      'SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked',
      [blockedPid],
    );
    if (state.rows[0].blocked) return true;
  }
  return false;
}

test('M2-S06 serializes overlapping booking, block and branch-deactivation races', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const admin = new Client({ connectionString: process.env.PG_URL });
  const first = new Client({ connectionString: process.env.PG_URL });
  const second = new Client({ connectionString: process.env.PG_URL });
  const schema = `m2_guards_races_${randomBytes(8).toString('hex')}`;
  let setupCommitted = false;

  await admin.connect();
  try {
    await admin.query('BEGIN');
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET LOCAL search_path TO "${schema}", public`);
    await applyMigrations(admin);
    const fixture = await createBaseFixture(admin, randomBytes(3).toString('hex'));
    const bookingOne = await createBooking(
      admin,
      fixture,
      `RACE-A-${randomBytes(4).toString('hex')}`,
    );
    const bookingTwo = await createBooking(
      admin,
      fixture,
      `RACE-B-${randomBytes(4).toString('hex')}`,
    );
    const bookingThree = await createBooking(
      admin,
      fixture,
      `RACE-C-${randomBytes(4).toString('hex')}`,
    );
    await admin.query('COMMIT');
    setupCommitted = true;

    await Promise.all([first.connect(), second.connect()]);

    await first.query('BEGIN');
    await second.query('BEGIN');
    await first.query(`SET LOCAL search_path TO "${schema}", public`);
    await second.query(`SET LOCAL search_path TO "${schema}", public`);
    const secondPid = (await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;

    const firstLine = await createBookedLine(first, {
      bookingId: bookingOne,
      actorId: fixture.actorId,
      startDate: '2027-05-01',
      endDate: '2027-05-04',
    });
    await assignRoom(first, firstLine, fixture.roomOneId);

    const competingLine = await createBookedLine(second, {
      bookingId: bookingTwo,
      actorId: fixture.actorId,
      startDate: '2027-05-02',
      endDate: '2027-05-05',
    });
    const competingAssignment = assignRoom(second, competingLine, fixture.roomOneId).then(
      () => ({ ok: true }),
      (error) => ({ ok: false, error }),
    );
    const assignmentWasBlocked = await waitUntilBlocked(admin, secondPid);
    await first.query('COMMIT');
    const competingAssignmentResult = await competingAssignment;
    assert.equal(assignmentWasBlocked, true);
    assert.equal(competingAssignmentResult.ok, false);
    assert.equal(competingAssignmentResult.error.code, '23514');
    await second.query('ROLLBACK');

    await first.query('BEGIN');
    await second.query('BEGIN');
    await first.query(`SET LOCAL search_path TO "${schema}", public`);
    await second.query(`SET LOCAL search_path TO "${schema}", public`);
    const blockLine = await createBookedLine(first, {
      bookingId: bookingTwo,
      actorId: fixture.actorId,
      startDate: '2027-06-01',
      endDate: '2027-06-04',
    });
    await assignRoom(first, blockLine, fixture.roomTwoId);
    const competingBlock = second.query(
      `INSERT INTO room_block (start_date, end_date, reason, room_id, created_by)
       VALUES ('2027-06-02', '2027-06-03', 'Concurrent maintenance', $1, $2)`,
      [fixture.roomTwoId, fixture.actorId],
    ).then(
      () => ({ ok: true }),
      (error) => ({ ok: false, error }),
    );
    await waitUntilBlocked(admin, secondPid);
    await first.query('COMMIT');
    const competingBlockResult = await competingBlock;
    assert.equal(competingBlockResult.ok, false);
    assert.equal(competingBlockResult.error.code, '23514');
    await second.query('ROLLBACK');

    await first.query('BEGIN');
    await second.query('BEGIN');
    await first.query(`SET LOCAL search_path TO "${schema}", public`);
    await second.query(`SET LOCAL search_path TO "${schema}", public`);
    const branchLine = await createBookedLine(first, {
      bookingId: bookingThree,
      actorId: fixture.actorId,
      startDate: '2027-07-01',
      endDate: '2027-07-03',
    });
    await assignRoom(first, branchLine, fixture.roomThreeId);
    const competingDeactivation = second.query(
      'UPDATE branch SET active = false WHERE branch_id = $1',
      [fixture.branchTwoId],
    ).then(
      () => ({ ok: true }),
      (error) => ({ ok: false, error }),
    );
    const deactivationWasBlocked = await waitUntilBlocked(admin, secondPid);
    await first.query('COMMIT');
    const competingDeactivationResult = await competingDeactivation;
    assert.equal(deactivationWasBlocked, true);
    assert.equal(competingDeactivationResult.ok, false);
    assert.equal(competingDeactivationResult.error.code, '23514');
    await second.query('ROLLBACK');

    const finalState = await admin.query(
      `SELECT
          (SELECT count(*)::integer FROM "${schema}".booking_room_assignment
            WHERE unassigned_at IS NULL) AS open_assignments,
          (SELECT count(*)::integer FROM "${schema}".room_block) AS blocks,
          (SELECT active FROM "${schema}".branch WHERE branch_id = $1) AS branch_active`,
      [fixture.branchTwoId],
    );
    assert.deepEqual(finalState.rows[0], {
      open_assignments: 3,
      blocks: 0,
      branch_active: true,
    });
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
