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
  'm2_006_capacity_type_edit_guards.sql',
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

async function createFixture(client, suffix) {
  const actor = await client.query('INSERT INTO user_account DEFAULT VALUES RETURNING user_id');
  const guest = await client.query('INSERT INTO guest DEFAULT VALUES RETURNING guest_id');
  const branch = await client.query('INSERT INTO branch DEFAULT VALUES RETURNING branch_id');
  const roomType = await client.query(
    `INSERT INTO room_type (name, capacity, base_daily_rate)
     VALUES ($1, 3, 18000) RETURNING room_type_id`,
    [`Capacity Type ${suffix}`],
  );
  const alternateType = await client.query(
    `INSERT INTO room_type (name, capacity, base_daily_rate)
     VALUES ($1, 5, 24000) RETURNING room_type_id`,
    [`Alternate Type ${suffix}`],
  );
  const raceType = await client.query(
    `INSERT INTO room_type (name, capacity, base_daily_rate)
     VALUES ($1, 3, 20000) RETURNING room_type_id`,
    [`Race Type ${suffix}`],
  );
  const roomOne = await client.query(
    `INSERT INTO room (room_number, branch_id, room_type_id)
     VALUES ($1, $2, $3) RETURNING room_id`,
    [`C-101-${suffix}`, branch.rows[0].branch_id, roomType.rows[0].room_type_id],
  );
  const roomTwo = await client.query(
    `INSERT INTO room (room_number, branch_id, room_type_id)
     VALUES ($1, $2, $3) RETURNING room_id`,
    [`C-102-${suffix}`, branch.rows[0].branch_id, roomType.rows[0].room_type_id],
  );
  const roomThree = await client.query(
    `INSERT INTO room (room_number, branch_id, room_type_id)
     VALUES ($1, $2, $3) RETURNING room_id`,
    [`C-103-${suffix}`, branch.rows[0].branch_id, raceType.rows[0].room_type_id],
  );

  return {
    actorId: actor.rows[0].user_id,
    guestId: guest.rows[0].guest_id,
    branchId: branch.rows[0].branch_id,
    roomTypeId: roomType.rows[0].room_type_id,
    alternateTypeId: alternateType.rows[0].room_type_id,
    raceTypeId: raceType.rows[0].room_type_id,
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
  fixture,
  { bookingId, startDate, endDate, guestCount, rate = 18000 },
) {
  const result = await client.query(
    `INSERT INTO booking_room_line (
       booking_id, stay_start_date, stay_end_date, guest_count, rate_snapshot
     ) VALUES ($1, $2, $3, $4, $5)
     RETURNING line_id`,
    [bookingId, startDate, endDate, guestCount, rate],
  );
  const lineId = result.rows[0].line_id;
  await client.query(
    `INSERT INTO booking_room_line_status_history (
       line_id, old_status, new_status, changed_by, reason
     ) VALUES ($1, NULL, 'BOOKED', $2, 'Initial booking')`,
    [lineId, fixture.actorId],
  );
  return lineId;
}

async function assignRoom(client, lineId, roomId) {
  return client.query(
    `INSERT INTO booking_room_assignment (line_id, room_id)
     VALUES ($1, $2)
     RETURNING assignment_id, assigned_at`,
    [lineId, roomId],
  );
}

async function flushDeferredConstraints(client) {
  await client.query('SET CONSTRAINTS ALL IMMEDIATE');
  await client.query('SET CONSTRAINTS ALL DEFERRED');
}

async function expectSqlError(client, operation, codes) {
  const expectedCodes = Array.isArray(codes) ? codes : [codes];
  await client.query('SAVEPOINT expected_error');
  try {
    await assert.rejects(operation, (error) => expectedCodes.includes(error.code));
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT expected_error');
    await client.query('RELEASE SAVEPOINT expected_error');
  }
}

async function closeAndCancel(client, fixture, lineId) {
  await client.query(
    `UPDATE booking_room_assignment
        SET unassigned_at = assigned_at + interval '1 second'
      WHERE line_id = $1 AND unassigned_at IS NULL`,
    [lineId],
  );
  await client.query(
    `UPDATE booking_room_line
        SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
      WHERE line_id = $1`,
    [lineId],
  );
  await client.query(
    `INSERT INTO booking_room_line_status_history (
       line_id, old_status, new_status, changed_by, reason
     ) VALUES ($1, 'BOOKED', 'CANCELLED', $2, 'Capacity guard test release')`,
    [lineId, fixture.actorId],
  );
  await flushDeferredConstraints(client);
}

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

test('M2-S28 enforces capacity and room-type edit guards while preserving history', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const client = new Client({ connectionString: process.env.PG_URL });
  const schema = `m2_capacity_guards_${randomBytes(8).toString('hex')}`;
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await applyMigrations(client);
    const fixture = await createFixture(client, randomBytes(3).toString('hex'));

    const triggerRows = await client.query(
      `SELECT tgname, pg_get_triggerdef(oid) AS definition
         FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgrelid IN (
            'booking_room_line'::regclass,
            'room_type'::regclass,
            'room'::regclass
          )
          AND tgname IN (
            'm2_room_type_capacity_change_guard',
            'm2_room_type_change_guard',
            'm2_room_line_target_guard'
          )
        ORDER BY tgname`,
    );
    assert.deepEqual(
      triggerRows.rows.map((row) => row.tgname),
      [
        'm2_room_line_target_guard',
        'm2_room_type_capacity_change_guard',
        'm2_room_type_change_guard',
      ],
    );
    assert.match(
      triggerRows.rows.find((row) => row.tgname === 'm2_room_line_target_guard').definition,
      /guest_count/i,
    );

    const bookingId = await createBooking(
      client,
      fixture,
      `CAPACITY-${randomBytes(4).toString('hex')}`,
    );
    const lineId = await createBookedLine(client, fixture, {
      bookingId,
      startDate: '2027-08-01',
      endDate: '2027-08-04',
      guestCount: 3,
    });
    await assignRoom(client, lineId, fixture.roomOneId);
    await flushDeferredConstraints(client);

    const checkedInBooking = await createBooking(
      client,
      fixture,
      `CHECKED-IN-${randomBytes(4).toString('hex')}`,
    );
    const checkedInLine = await createBookedLine(client, fixture, {
      bookingId: checkedInBooking,
      startDate: '2027-12-10',
      endDate: '2027-12-12',
      guestCount: 2,
    });
    await assignRoom(client, checkedInLine, fixture.roomTwoId);
    await client.query(
      `UPDATE booking_room_assignment
          SET occupied_from = assigned_at + interval '1 second'
        WHERE line_id = $1 AND unassigned_at IS NULL`,
      [checkedInLine],
    );
    await client.query(
      `UPDATE booking_room_line
          SET status = 'CHECKED_IN', updated_at = CURRENT_TIMESTAMP
        WHERE line_id = $1`,
      [checkedInLine],
    );
    await client.query(
      `INSERT INTO booking_room_line_status_history (
         line_id, old_status, new_status, changed_by, reason
       ) VALUES ($1, 'BOOKED', 'CHECKED_IN', $2, 'Checked-in guard case')`,
      [checkedInLine, fixture.actorId],
    );
    await flushDeferredConstraints(client);

    await expectSqlError(
      client,
      () => client.query(
        'UPDATE room_type SET capacity = 2 WHERE room_type_id = $1',
        [fixture.roomTypeId],
      ),
      '23514',
    );
    await expectSqlError(
      client,
      () => client.query(
        'UPDATE room SET room_type_id = $2 WHERE room_id = $1',
        [fixture.roomOneId, fixture.alternateTypeId],
      ),
      '23514',
    );
    await expectSqlError(
      client,
      () => client.query(
        'UPDATE room SET room_type_id = $2 WHERE room_id = $1',
        [fixture.roomTwoId, fixture.alternateTypeId],
      ),
      '23514',
    );
    await expectSqlError(
      client,
      () => client.query(
        'UPDATE booking_room_line SET guest_count = 4 WHERE line_id = $1',
        [lineId],
      ),
      '23514',
    );

    await client.query(
      'UPDATE room_type SET capacity = 4 WHERE room_type_id = $1',
      [fixture.roomTypeId],
    );
    await client.query(
      'UPDATE room_type SET capacity = 3 WHERE room_type_id = $1',
      [fixture.roomTypeId],
    );

    await client.query('SAVEPOINT oversized_case');
    const oversizedBooking = await createBooking(
      client,
      fixture,
      `OVERSIZED-${randomBytes(4).toString('hex')}`,
    );
    const oversizedLine = await createBookedLine(client, fixture, {
      bookingId: oversizedBooking,
      startDate: '2027-09-01',
      endDate: '2027-09-03',
      guestCount: 4,
    });
    await expectSqlError(
      client,
      () => assignRoom(client, oversizedLine, fixture.roomTwoId),
      '23514',
    );
    await client.query('ROLLBACK TO SAVEPOINT oversized_case');
    await client.query('RELEASE SAVEPOINT oversized_case');

    await closeAndCancel(client, fixture, lineId);
    await client.query(
      'UPDATE room SET room_type_id = $2 WHERE room_id = $1',
      [fixture.roomOneId, fixture.alternateTypeId],
    );
    await client.query(
      'UPDATE room_type SET capacity = 2 WHERE room_type_id = $1',
      [fixture.roomTypeId],
    );

    const preserved = await client.query(
      `SELECT line.status,
              line.guest_count,
              line.rate_snapshot::text,
              assignment.room_id,
              assignment.unassigned_at IS NOT NULL AS assignment_closed,
              target_room.room_type_id
         FROM booking_room_line AS line
         JOIN booking_room_assignment AS assignment ON assignment.line_id = line.line_id
         JOIN room AS target_room ON target_room.room_id = assignment.room_id
        WHERE line.line_id = $1`,
      [lineId],
    );
    assert.deepEqual(preserved.rows[0], {
      status: 'CANCELLED',
      guest_count: 3,
      rate_snapshot: '18000.00',
      room_id: fixture.roomOneId,
      assignment_closed: true,
      room_type_id: fixture.alternateTypeId,
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

test('M2-S28 serializes booking, capacity and room-type edit races', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const admin = new Client({ connectionString: process.env.PG_URL });
  const first = new Client({ connectionString: process.env.PG_URL });
  const second = new Client({ connectionString: process.env.PG_URL });
  const schema = `m2_capacity_races_${randomBytes(8).toString('hex')}`;
  let setupCommitted = false;

  await admin.connect();
  try {
    await admin.query('BEGIN');
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET LOCAL search_path TO "${schema}"`);
    await applyMigrations(admin);
    const fixture = await createFixture(admin, randomBytes(3).toString('hex'));
    await admin.query('COMMIT');
    setupCommitted = true;

    await Promise.all([first.connect(), second.connect()]);

    await first.query('BEGIN');
    await second.query('BEGIN');
    await first.query(`SET LOCAL search_path TO "${schema}"`);
    await second.query(`SET LOCAL search_path TO "${schema}"`);
    const secondPid = (await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;

    const firstBooking = await createBooking(
      first,
      fixture,
      `CAP-RACE-A-${randomBytes(4).toString('hex')}`,
    );
    const firstLine = await createBookedLine(first, fixture, {
      bookingId: firstBooking,
      startDate: '2027-10-01',
      endDate: '2027-10-04',
      guestCount: 3,
    });
    await assignRoom(first, firstLine, fixture.roomOneId);

    const competingReduction = second.query(
      'UPDATE room_type SET capacity = 2 WHERE room_type_id = $1',
      [fixture.roomTypeId],
    ).then(
      () => ({ ok: true }),
      (error) => ({ ok: false, error }),
    );
    assert.equal(await waitUntilBlocked(admin, secondPid), true);
    await first.query('COMMIT');
    const reductionResult = await competingReduction;
    assert.equal(reductionResult.ok, false);
    assert.equal(reductionResult.error.code, '23514');
    await second.query('ROLLBACK');

    await first.query('BEGIN');
    await second.query('BEGIN');
    await first.query(`SET LOCAL search_path TO "${schema}"`);
    await second.query(`SET LOCAL search_path TO "${schema}"`);

    const secondBooking = await createBooking(
      first,
      fixture,
      `TYPE-RACE-${randomBytes(4).toString('hex')}`,
    );
    const secondLine = await createBookedLine(first, fixture, {
      bookingId: secondBooking,
      startDate: '2027-11-01',
      endDate: '2027-11-04',
      guestCount: 1,
    });
    await assignRoom(first, secondLine, fixture.roomTwoId);

    const competingTypeChange = second.query(
      'UPDATE room SET room_type_id = $2 WHERE room_id = $1',
      [fixture.roomTwoId, fixture.alternateTypeId],
    ).then(
      () => ({ ok: true }),
      (error) => ({ ok: false, error }),
    );
    await waitUntilBlocked(admin, secondPid);
    await first.query('COMMIT');
    const typeChangeResult = await competingTypeChange;
    assert.equal(typeChangeResult.ok, false);
    assert.equal(typeChangeResult.error.code, '23514');
    await second.query('ROLLBACK');

    await first.query('BEGIN');
    await second.query('BEGIN');
    await first.query(`SET LOCAL search_path TO "${schema}"`);
    await second.query(`SET LOCAL search_path TO "${schema}"`);
    const firstPid = (await first.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;

    await second.query(
      'UPDATE room_type SET capacity = 2 WHERE room_type_id = $1',
      [fixture.raceTypeId],
    );
    const reverseBooking = await createBooking(
      first,
      fixture,
      `CAP-RACE-B-${randomBytes(4).toString('hex')}`,
    );
    const reverseLine = await createBookedLine(first, fixture, {
      bookingId: reverseBooking,
      startDate: '2027-12-01',
      endDate: '2027-12-03',
      guestCount: 3,
      rate: 20000,
    });
    const competingAssignment = assignRoom(first, reverseLine, fixture.roomThreeId).then(
      () => ({ ok: true }),
      (error) => ({ ok: false, error }),
    );
    assert.equal(await waitUntilBlocked(admin, firstPid), true);
    await second.query('COMMIT');
    const assignmentResult = await competingAssignment;
    assert.equal(assignmentResult.ok, false);
    assert.equal(assignmentResult.error.code, '23514');
    await first.query('ROLLBACK');

    const finalState = await admin.query(
      `SELECT
          (SELECT capacity FROM "${schema}".room_type WHERE room_type_id = $1) AS protected_capacity,
          (SELECT room_type_id FROM "${schema}".room WHERE room_id = $2) AS protected_room_type,
          (SELECT capacity FROM "${schema}".room_type WHERE room_type_id = $3) AS reduced_capacity,
          (SELECT count(*)::integer FROM "${schema}".booking_room_assignment
            WHERE unassigned_at IS NULL) AS open_assignments`,
      [fixture.roomTypeId, fixture.roomTwoId, fixture.raceTypeId],
    );
    assert.deepEqual(finalState.rows[0], {
      protected_capacity: 3,
      protected_room_type: fixture.roomTypeId,
      reduced_capacity: 2,
      open_assignments: 2,
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
