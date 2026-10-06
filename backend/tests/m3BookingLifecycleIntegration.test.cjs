// M3-S17: booking-lifecycle integration coverage on the clean numbered chain.
// Exercises the real SQL guards and the real services against one freshly
// applied schema: partial two-room check-in, concurrent/rejected check-in,
// actual occupancy segments, absence of duplicate room-condition events,
// same-booking service attribution, catalogue price changes and the
// preservation rules around a void, plus the physical-condition transitions
// that checkout and M3-S18's condition operation perform.
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { loadMigrations } = require('../src/migrations/migrate');
const { checkInRoomLine } = require('../src/services/checkInService');
const { recordServiceUsage, voidServiceUsage } = require('../src/services/serviceUsageService');

const sourceDir = path.join(__dirname, '..', 'migrations');
const connectionString = process.env.PG_TEST_URL || process.env.PG_URL;

// A transaction pool does not preserve SET search_path between transactions.
// Pin every assertion/write to its own explicit transaction and SET LOCAL.
function isolateClient(client, schema) {
  const rawQuery = client.query.bind(client);
  let inTransaction = false;
  client.query = async (sql, values) => {
    if (sql === 'BEGIN') {
      const result = await rawQuery(sql);
      inTransaction = true;
      await rawQuery(`SET LOCAL search_path TO "${schema}"`);
      return result;
    }
    if (sql === 'COMMIT' || sql === 'ROLLBACK') {
      const result = await rawQuery(sql);
      inTransaction = false;
      return result;
    }
    if (inTransaction) return rawQuery(sql, values);
    await rawQuery('BEGIN');
    try {
      await rawQuery(`SET LOCAL search_path TO "${schema}"`);
      const result = await rawQuery(sql, values);
      await rawQuery('COMMIT');
      return result;
    } catch (error) {
      await rawQuery('ROLLBACK');
      throw error;
    }
  };
}

async function applyChain(client, directory) {
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY)');
  const completed = new Set((await client.query('SELECT version FROM schema_migrations')).rows.map((row) => row.version));
  const applied = [];
  for (const migration of loadMigrations(directory)) {
    if (completed.has(migration.key)) continue;
    await client.query('BEGIN');
    try {
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [migration.key]);
      await client.query('COMMIT');
      applied.push(migration.filename);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
  return { applied };
}

// Two Member 5 reporting migrations cannot be applied to the current chain:
// m5_002 indexes booking (branch_id, check_in_date, status), but Member 2's
// normalized booking header carries neither column (M2-S03 keeps branch on the
// room and the dates on the line), and m5_003's seed insert is refused by
// Member 1's system_config guard because no active SYSTEM_ADMINISTRATOR officer
// exists yet. Excluding them keeps this suite honest about the m1-m4 chain it
// actually verifies; the last test in this file asserts the reason still holds
// so the exclusion can never quietly outlive the defect.
const chainExclusions = ['m5_002_create_audit_indexes.sql', 'm5_003_seed_config_values.sql'];
// The published m3_001/m3_002 mock tables are upgraded in place by these
// three files, so the upgrade path is applied as a second step below.
const m3Upgrades = ['m3_003_service_usage.sql', 'm3_004_service_catalogue.sql', 'm3_005_room_status_history.sql'];

async function withChain(run, { deferM3Upgrades = false } = {}) {
  const schema = `m3_lifecycle_${randomBytes(8).toString('hex')}`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'skynest-m3-lifecycle-'));
  // audit_and_config.sql is a pre-existing, unnumbered Member 5 SQL reference;
  // apply the numbered chain only, exactly as production does.
  const numbered = fs.readdirSync(sourceDir)
    .filter((name) => /^(?:m\d+_)?\d+_.+\.sql$/.test(name) && !chainExclusions.includes(name))
    .filter((name) => !deferM3Upgrades || !m3Upgrades.includes(name));
  const client = new Client({ connectionString });
  for (const name of numbered) fs.copyFileSync(path.join(sourceDir, name), path.join(directory, name));
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    isolateClient(client, schema);
    const applied = await applyChain(client, directory);
    assert.equal(applied.applied.length, numbered.length);
    await run({ client, schema, directory, numbered });
  } finally {
    await client.query('ROLLBACK');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function applyM3Upgrades(client, directory) {
  for (const name of m3Upgrades) fs.copyFileSync(path.join(sourceDir, name), path.join(directory, name));
  return applyChain(client, directory);
}

async function officer(client, username, roles, roleName, branchId) {
  const userId = (await client.query('INSERT INTO user_account (username) VALUES ($1) RETURNING user_id', [username])).rows[0].user_id;
  const roleId = roles.find((role) => role.role_name === roleName).role_id;
  await client.query('INSERT INTO officer (officer_id, full_name, role_id, branch_id) VALUES ($1, $2, $3, $4)',
    [userId, username, roleId, branchId]);
  return userId;
}

// Two rooms for the partial/segment/checkout scenarios, one room each for the
// cross-booking, not-yet-checked-in and FINAL-invoice bookings, and one room
// with no assignment at all for direct condition transitions.
async function seed(client) {
  const branches = (await client.query('SELECT branch_id FROM branch ORDER BY branch_id LIMIT 2')).rows;
  const roles = (await client.query('SELECT role_name, role_id FROM role')).rows;
  const branchId = branches[0].branch_id;
  const frontDeskId = await officer(client, 'lifecycle.frontdesk', roles, 'FRONT_DESK', branchId);
  const serviceStaffId = await officer(client, 'lifecycle.service', roles, 'SERVICE_STAFF', branchId);
  const branchManagerId = await officer(client, 'lifecycle.manager', roles, 'BRANCH_MANAGER', branchId);
  const chainManagerId = await officer(client, 'lifecycle.chain', roles, 'CHAIN_MANAGER', branchId);
  const otherBranchId = branches[1].branch_id;
  const otherBranchStaffId = await officer(client, 'lifecycle.otherdesk', roles, 'FRONT_DESK', otherBranchId);
  const policyId = (await client.query(`INSERT INTO billing_policy
    (effective_from, tax_percent, service_charge_percent, max_discount_percent,
     cancellation_fee, no_show_fee, late_checkout_fee, no_show_grace_days, is_demo, created_by)
    VALUES ('2020-01-01', 0, 0, 0, 0, 0, 0, 1, false, $1) RETURNING billing_policy_id`, [chainManagerId])).rows[0].billing_policy_id;
  const typeId = (await client.query("INSERT INTO room_type (name, capacity, base_daily_rate) VALUES ('Lifecycle type', 2, 100) RETURNING room_type_id")).rows[0].room_type_id;
  const rooms = [];
  for (let index = 0; index < 6; index += 1) {
    rooms.push((await client.query('INSERT INTO room (room_number, branch_id, room_type_id) VALUES ($1, $2, $3) RETURNING room_id',
      [String(500 + index), branchId, typeId])).rows[0].room_id);
  }
  const dates = (await client.query(`SELECT to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::date, 'YYYY-MM-DD') AS today,
      to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::date + 4, 'YYYY-MM-DD') AS end`)).rows[0];
  const serviceId = (await client.query("INSERT INTO service (name, category, current_price) VALUES ('Lifecycle laundry', 'Laundry', 50) RETURNING service_id")).rows[0].service_id;

  async function createBooking(label, roomIds) {
    const guestId = (await client.query('INSERT INTO guest (full_name) VALUES ($1) RETURNING guest_id', [`Lifecycle ${label}`])).rows[0].guest_id;
    const selections = roomIds.map((roomId) => ({ roomId, checkIn: dates.today, checkOut: dates.end,
      guestCount: 1, quotedRoomTypeId: typeId, quotedBaseDailyRate: '100.00' }));
    // Policy publication precedes the confirmation transaction's snapshot time.
    await client.query('BEGIN');
    const booking = (await client.query('SELECT * FROM sp_create_booking($1::uuid, $2::booking_channel_enum, $3::uuid, $4::uuid, $5::uuid, $6::jsonb)',
      [guestId, 'FRONT_DESK', frontDeskId, branchId, policyId, JSON.stringify(selections)])).rows[0];
    const lines = (await client.query(`SELECT line.line_id, assignment.room_id
      FROM booking_room_line line JOIN booking_room_assignment assignment USING (line_id)
      WHERE booking_id = $1 ORDER BY assignment.room_id`, [booking.booking_id])).rows;
    await client.query('COMMIT');
    return { ...booking, lines };
  }

  return {
    ...dates,
    branchId,
    frontDeskId,
    serviceStaffId,
    branchManagerId,
    chainManagerId,
    otherBranchStaffId,
    serviceId,
    rooms,
    // rooms[5] has no assignment; rooms[4] belongs to the single-line booking.
    partial: await createBooking('partial', [rooms[0], rooms[1]]),
    crossBooking: await createBooking('cross', [rooms[2]]),
    laterCheckIn: await createBooking('later', [rooms[3]]),
    finalizable: await createBooking('final', [rooms[4]]),
  };
}

async function lineStates(client, bookingId) {
  const rows = (await client.query('SELECT line_id, status FROM booking_room_line WHERE booking_id = $1 ORDER BY line_id', [bookingId])).rows;
  return new Map(rows.map((row) => [row.line_id, row.status]));
}

async function assignmentFor(client, lineId) {
  return (await client.query(`SELECT assignment_id, room_id, occupied_from, occupied_to, unassigned_at
    FROM booking_room_assignment WHERE line_id = $1`, [lineId])).rows[0];
}

async function lineHistory(client, lineId) {
  return (await client.query('SELECT old_status, new_status, changed_at, changed_by, reason FROM booking_room_line_status_history WHERE line_id = $1 ORDER BY changed_at, history_id', [lineId])).rows;
}

// Member 2's confirmation already writes the initial BOOKED row, so a check-in
// adds exactly one transition on top of it.
async function transitionCount(client, lineId, newStatus) {
  return (await client.query('SELECT count(*)::int AS count FROM booking_room_line_status_history WHERE line_id = $1 AND new_status = $2', [lineId, newStatus])).rows[0].count;
}

async function roomHistory(client, roomId) {
  return (await client.query('SELECT old_status, new_status, changed_at, changed_by, reason FROM room_status_history WHERE room_id = $1 ORDER BY changed_at', [roomId])).rows;
}

async function roomCondition(client, roomId) {
  return (await client.query('SELECT operational_status FROM room WHERE room_id = $1', [roomId])).rows[0].operational_status;
}

async function openSegmentCount(client, bookingId) {
  return (await client.query(`SELECT count(*)::int AS count FROM booking_room_assignment assignment
    JOIN booking_room_line line USING (line_id)
    WHERE assignment.line_id IN (SELECT line_id FROM booking_room_line WHERE booking_id = $1)
      AND assignment.occupied_from IS NOT NULL AND assignment.occupied_to IS NULL`, [bookingId])).rows[0].count;
}

async function settle(client, bookingId, actorId, reference) {
  const balance = (await client.query('SELECT fn_outstanding_balance($1) AS balance', [bookingId])).rows[0].balance;
  if (Number(balance) === 0) return '0.00';
  await client.query("SELECT fn_record_payment($1, $2, 'PAYMENT', $3, 'CASH', $4, 'SUCCESSFUL')", [bookingId, actorId, balance, reference]);
  return balance;
}

async function checkout(client, bookingId, lineId, actorId) {
  return (await client.query('SELECT * FROM fn_checkout_room_line($1, $2, $3)', [bookingId, lineId, actorId])).rows[0];
}

async function withPool(client, run) {
  const db = require('../src/db');
  const previousQuery = db.pool.query;
  const previousConnect = db.pool.connect;
  db.pool.query = client.query.bind(client);
  db.pool.connect = async () => Object.assign(client, { release() {} });
  try {
    return await run();
  } finally {
    db.pool.query = previousQuery;
    db.pool.connect = previousConnect;
  }
}

test('M3-S17 partial two-room check-in leaves the sibling BOOKED with no occupancy segment and no room-condition event', async () => {
  await withChain(async ({ client, schema }) => {
    const fixture = await seed(client);
    const [first, second] = fixture.partial.lines;

    const result = await checkInRoomLine(client, { lineId: first.line_id, actorId: fixture.frontDeskId, schema });
    assert.equal(result.roomId, first.room_id);
    assert.ok(result.checkedInAt instanceof Date);

    const states = await lineStates(client, fixture.partial.booking_id);
    assert.equal(states.get(first.line_id), 'CHECKED_IN');
    assert.equal(states.get(second.line_id), 'BOOKED', 'a two-room booking checks in one line at a time');

    // The occupancy segment is actual: started at the single instant used for
    // the line transition, still open, and only on the checked-in line.
    const firstAssignment = await assignmentFor(client, first.line_id);
    assert.equal(firstAssignment.occupied_from.getTime(), result.checkedInAt.getTime());
    assert.equal(firstAssignment.occupied_to, null);
    assert.equal(firstAssignment.unassigned_at, null);
    const secondAssignment = await assignmentFor(client, second.line_id);
    assert.equal(secondAssignment.occupied_from, null, 'a BOOKED sibling has no occupant');
    assert.equal(secondAssignment.unassigned_at, null);
    assert.equal(await openSegmentCount(client, fixture.partial.booking_id), 1);

    const firstHistory = await lineHistory(client, first.line_id);
    assert.equal(firstHistory.length, 2, 'the confirmation row plus one check-in transition');
    assert.equal(firstHistory[1].old_status, 'BOOKED');
    assert.equal(firstHistory[1].new_status, 'CHECKED_IN');
    assert.equal(new Date(firstHistory[1].changed_at).getTime(), result.checkedInAt.getTime());
    assert.equal(firstHistory[1].changed_by, fixture.frontDeskId);
    assert.equal(await transitionCount(client, second.line_id, 'CHECKED_IN'), 0);
    const audited = (await client.query(`SELECT count(*)::int AS count FROM audit_log
      WHERE entity_name = 'booking_room_line' AND entity_id = $1 AND action = 'STATUS_CHANGE'`, [first.line_id])).rows[0].count;
    assert.equal(audited, 1);

    // Check-in is an occupancy event, not a physical-condition change
    // (M3-S03/M3-S06: no duplicate room-history row).
    assert.equal(await roomCondition(client, first.room_id), 'READY');
    assert.equal((await roomHistory(client, first.room_id)).length, 0);
    assert.equal((await client.query('SELECT count(*)::int AS count FROM room_status_history')).rows[0].count, 0);

    // The active-stay read model agrees with the stored occupancy.
    const stays = await withPool(client, async () => {
      const { getActiveStay } = require('../src/controllers/activeStayController');
      const body = { statusCode: 200, value: null, status(code) { this.statusCode = code; return this; },
        json(value) { this.value = value; return this; } };
      await getActiveStay({ params: { bookingRef: fixture.partial.booking_ref }, user: { userId: fixture.frontDeskId }, body: {}, headers: {} }, body);
      assert.equal(body.statusCode, 200);
      return body.value;
    });
    assert.equal(stays.active_stays.length, 1, 'only the checked-in room counts as occupied');
    assert.equal(stays.active_stays[0].line_id, first.line_id);

    // A repeat on the same line is refused and still writes no room history.
    await assert.rejects(checkInRoomLine(client, { lineId: first.line_id, actorId: fixture.frontDeskId, schema }), /Only BOOKED/);
    assert.equal((await client.query('SELECT count(*)::int AS count FROM room_status_history')).rows[0].count, 0);
  });
});

test('M3-S17 a rejected check-in leaves no occupant and a concurrent double check-in resolves exactly once', async () => {
  await withChain(async ({ client, schema }) => {
    const fixture = await seed(client);
    const [first, second] = fixture.partial.lines;
    await checkInRoomLine(client, { lineId: first.line_id, actorId: fixture.frontDeskId, schema });

    // Rollback: a failure after the locks are taken must undo the line
    // transition, the occupancy start and the history write together.
    await client.query(`CREATE FUNCTION reject_test_checkin_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.entity_name = 'booking_room_line' AND NEW.action = 'STATUS_CHANGE' THEN
        RAISE EXCEPTION 'forced check-in audit failure'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER reject_test_checkin_audit BEFORE INSERT ON audit_log FOR EACH ROW
      EXECUTE FUNCTION reject_test_checkin_audit();`);
    await assert.rejects(checkInRoomLine(client, { lineId: second.line_id, actorId: fixture.frontDeskId, schema }), /forced check-in/);
    assert.equal((await lineStates(client, fixture.partial.booking_id)).get(second.line_id), 'BOOKED');
    const rolledBack = await assignmentFor(client, second.line_id);
    assert.equal(rolledBack.occupied_from, null);
    assert.equal(rolledBack.unassigned_at, null);
    assert.equal(await transitionCount(client, second.line_id, 'CHECKED_IN'), 0, 'the failed attempt wrote no transition');
    assert.equal((await client.query(`SELECT count(*)::int AS count FROM audit_log WHERE entity_id = $1`, [second.line_id])).rows[0].count, 0);
    assert.equal(await roomCondition(client, second.room_id), 'READY');
    assert.equal((await client.query('SELECT count(*)::int AS count FROM room_status_history')).rows[0].count, 0);
    await client.query('DROP TRIGGER reject_test_checkin_audit ON audit_log');

    // Race: two independent sessions attempt the same line at once. The
    // pessimistic booking/line locks must admit one winner and one conflict.
    const racers = [new Client({ connectionString }), new Client({ connectionString })];
    for (const racer of racers) await racer.connect();
    try {
      const outcomes = await Promise.allSettled(racers.map((racer) =>
        checkInRoomLine(racer, { lineId: second.line_id, actorId: fixture.frontDeskId, schema })));
      const winners = outcomes.filter((outcome) => outcome.status === 'fulfilled');
      const losers = outcomes.filter((outcome) => outcome.status === 'rejected');
      assert.equal(winners.length, 1, 'exactly one concurrent check-in may take effect');
      assert.equal(losers.length, 1);
      assert.match(losers[0].reason.message, /Only BOOKED/);
    } finally {
      for (const racer of racers) await racer.end();
    }

    const states = await lineStates(client, fixture.partial.booking_id);
    assert.equal(states.get(second.line_id), 'CHECKED_IN');
    assert.equal(await openSegmentCount(client, fixture.partial.booking_id), 2, 'no duplicate occupancy segment');
    assert.equal(await transitionCount(client, second.line_id, 'CHECKED_IN'), 1, 'no duplicate line-history event');
    assert.equal((await client.query(`SELECT count(*)::int AS count FROM audit_log WHERE entity_id = $1`, [second.line_id])).rows[0].count, 1);
    assert.equal((await client.query('SELECT count(*)::int AS count FROM room_status_history')).rows[0].count, 0,
      'a raced check-in still adds no room-condition event');
    assert.equal((await client.query('SELECT count(*)::int AS count FROM booking_room_line WHERE booking_id = $1', [fixture.partial.booking_id])).rows[0].count, 2);
  });
});

test('M3-S17 checkout closes the occupancy segment once, cleans the room once, and a rolled-back checkout leaves the condition untouched', async () => {
  await withChain(async ({ client, schema }) => {
    const fixture = await seed(client);
    const [first, second] = fixture.partial.lines;
    await checkInRoomLine(client, { lineId: first.line_id, actorId: fixture.frontDeskId, schema });
    await checkInRoomLine(client, { lineId: second.line_id, actorId: fixture.frontDeskId, schema });
    assert.equal(await openSegmentCount(client, fixture.partial.booking_id), 2);
    assert.equal((await client.query('SELECT count(*)::int AS count FROM room_status_history')).rows[0].count, 0);

    await settle(client, fixture.partial.booking_id, fixture.frontDeskId, 'LIFECYCLE-ONE');

    const receipt = await checkout(client, fixture.partial.booking_id, first.line_id, fixture.frontDeskId);
    assert.equal(receipt.room_condition, 'CLEANING');
    assert.equal(receipt.is_finalized, false, 'a partial checkout keeps the invoice in DRAFT');
    assert.equal(receipt.remaining_active_lines, 1);
    assert.match(receipt.provisional_statement_ref, /^PROV-/);

    // The segment ends at exactly the checkout instant used for the line
    // transition and the assignment closure (FR-060/DBR-018).
    const closed = await assignmentFor(client, first.line_id);
    assert.ok(closed.occupied_to instanceof Date);
    assert.equal(closed.occupied_to.getTime(), receipt.checked_out_at.getTime());
    assert.equal(closed.unassigned_at.getTime(), receipt.checked_out_at.getTime());
    assert.ok(closed.occupied_from.getTime() < closed.occupied_to.getTime());
    assert.equal(await openSegmentCount(client, fixture.partial.booking_id), 1);

    const outHistory = await lineHistory(client, first.line_id);
    assert.equal(outHistory.length, 3, 'confirmation row, check-in transition, checkout transition');
    assert.equal(outHistory[2].old_status, 'CHECKED_IN');
    assert.equal(outHistory[2].new_status, 'CHECKED_OUT');
    assert.equal(new Date(outHistory[2].changed_at).getTime(), receipt.checked_out_at.getTime());
    assert.equal(await transitionCount(client, second.line_id, 'CHECKED_IN'), 1, 'the sibling line keeps only its own check-in row');

    // The room's physical condition changes exactly once, through the
    // condition operation, and the event is recorded against the actor.
    assert.equal(await roomCondition(client, first.room_id), 'CLEANING');
    const conditionEvents = await roomHistory(client, first.room_id);
    assert.equal(conditionEvents.length, 1);
    assert.equal(conditionEvents[0].old_status, 'READY');
    assert.equal(conditionEvents[0].new_status, 'CLEANING');
    assert.equal(conditionEvents[0].changed_by, fixture.frontDeskId);
    assert.ok(conditionEvents[0].reason);
    assert.equal(await roomCondition(client, second.room_id), 'READY');
    assert.equal((await roomHistory(client, second.room_id)).length, 0);
    assert.equal((await client.query("SELECT status::text AS status FROM invoice WHERE booking_id = $1", [fixture.partial.booking_id])).rows[0].status, 'DRAFT');

    // Rollback: the condition transition and its history row belong to the
    // checkout transaction, so an aborted checkout restores the room.
    await client.query('BEGIN');
    const discarded = await checkout(client, fixture.partial.booking_id, second.line_id, fixture.frontDeskId);
    assert.equal(discarded.room_condition, 'CLEANING');
    await client.query('ROLLBACK');
    assert.equal((await lineStates(client, fixture.partial.booking_id)).get(second.line_id), 'CHECKED_IN');
    const reopened = await assignmentFor(client, second.line_id);
    assert.equal(reopened.occupied_to, null, 'the aborted checkout leaves the segment open');
    assert.equal(reopened.unassigned_at, null);
    assert.equal(await roomCondition(client, second.room_id), 'READY');
    assert.equal((await roomHistory(client, second.room_id)).length, 0, 'no room-condition event survives a rolled-back checkout');
    assert.equal(await transitionCount(client, second.line_id, 'CHECKED_OUT'), 0);

    // Final checkout: all lines terminal and a settled balance finalize the
    // single invoice and clean the second room once.
    const finalReceipt = await checkout(client, fixture.partial.booking_id, second.line_id, fixture.frontDeskId);
    assert.equal(finalReceipt.is_finalized, true);
    assert.equal((await client.query('SELECT count(*)::int AS count FROM room_status_history')).rows[0].count, 2);
    assert.equal(await roomCondition(client, second.room_id), 'CLEANING');
    assert.equal((await client.query("SELECT status::text AS status FROM invoice WHERE booking_id = $1", [fixture.partial.booking_id])).rows[0].status, 'FINAL');
  });
});

test('M3-S17 direct room-condition changes log once, ignore no-ops and refuse OUT_OF_SERVICE over active assignments', async () => {
  await withChain(async ({ client, schema }) => {
    const fixture = await seed(client);
    const freeRoom = fixture.rooms[5];
    const bookedRoom = fixture.crossBooking.lines[0].room_id;
    const occupiedRoom = fixture.laterCheckIn.lines[0].room_id;
    assert.equal(await roomCondition(client, freeRoom), 'READY');

    await client.query("SELECT fn_set_room_condition($1, 'CLEANING', $2, 'Housekeeping turn')", [freeRoom, fixture.serviceStaffId]);
    assert.equal(await roomCondition(client, freeRoom), 'CLEANING');
    let events = await roomHistory(client, freeRoom);
    assert.equal(events.length, 1);
    assert.equal(events[0].old_status, 'READY');
    assert.equal(events[0].new_status, 'CLEANING');
    assert.equal(events[0].changed_by, fixture.serviceStaffId);
    assert.equal(events[0].reason, 'Housekeeping turn');

    // DBR-018: a no-op transition changes nothing and logs nothing.
    await client.query("SELECT fn_set_room_condition($1, 'CLEANING', $2, 'Redundant turn')", [freeRoom, fixture.serviceStaffId]);
    assert.equal((await roomHistory(client, freeRoom)).length, 1, 'a repeated condition writes no second event');

    await client.query("SELECT fn_set_room_condition($1, 'OUT_OF_SERVICE', $2, 'Extended maintenance')", [freeRoom, fixture.branchManagerId]);
    events = await roomHistory(client, freeRoom);
    assert.equal(events.length, 2);
    assert.equal(events[1].old_status, 'CLEANING');
    assert.equal(events[1].new_status, 'OUT_OF_SERVICE');
    await client.query("SELECT fn_set_room_condition($1, 'READY', $2, 'Back in service')", [freeRoom, fixture.branchManagerId]);
    assert.equal((await roomHistory(client, freeRoom)).length, 3);
    assert.equal(await roomCondition(client, freeRoom), 'READY');

    // An active BOOKED assignment blocks an outage.
    await assert.rejects(client.query("SELECT fn_set_room_condition($1, 'OUT_OF_SERVICE', $2, 'Maintenance')", [bookedRoom, fixture.branchManagerId]), { code: '23514' });
    assert.equal(await roomCondition(client, bookedRoom), 'READY');
    assert.equal((await roomHistory(client, bookedRoom)).length, 0);

    // An active CHECKED_IN assignment blocks an outage as well.
    await checkInRoomLine(client, { lineId: fixture.laterCheckIn.lines[0].line_id, actorId: fixture.frontDeskId, schema });
    await assert.rejects(client.query("SELECT fn_set_room_condition($1, 'OUT_OF_SERVICE', $2, 'Maintenance')", [occupiedRoom, fixture.branchManagerId]), { code: '23514' });
    assert.equal(await roomCondition(client, occupiedRoom), 'READY');
    assert.equal((await roomHistory(client, occupiedRoom)).length, 0);
    assert.equal(await openSegmentCount(client, fixture.laterCheckIn.booking_id), 1);

    // Condition history is append-only.
    await assert.rejects(client.query('UPDATE room_status_history SET reason = $1 WHERE room_history_id = (SELECT room_history_id FROM room_status_history WHERE room_id = $2 ORDER BY changed_at LIMIT 1)', ['Rewritten', freeRoom]), { code: '42501' });
    await assert.rejects(client.query('DELETE FROM room_status_history WHERE room_history_id = (SELECT room_history_id FROM room_status_history WHERE room_id = $1 ORDER BY changed_at LIMIT 1)', [freeRoom]), { code: '42501' });
    assert.equal((await roomHistory(client, freeRoom)).length, 3, 'refused mutation leaves the event intact');
  });
});

test('M3-S17 service usage stays same-booking attributed, price-change safe and voided without touching occupancy or room history', async () => {
  await withChain(async ({ client, schema }) => {
    const fixture = await seed(client);
    const [first, second] = fixture.partial.lines;
    const otherLine = fixture.crossBooking.lines[0];
    const laterLine = fixture.laterCheckIn.lines[0];
    await checkInRoomLine(client, { lineId: first.line_id, actorId: fixture.frontDeskId, schema });
    await checkInRoomLine(client, { lineId: second.line_id, actorId: fixture.frontDeskId, schema });
    await checkInRoomLine(client, { lineId: otherLine.line_id, actorId: fixture.frontDeskId, schema });

    const recorded = await recordServiceUsage(client, {
      bookingId: fixture.partial.booking_id,
      serviceId: fixture.serviceId,
      quantity: '1.25',
      bookingRoomLineId: first.line_id,
      recordedBy: fixture.serviceStaffId,
    });
    assert.equal(recorded.unitPriceSnapshot, '50.00', 'the snapshot is taken from the active catalogue price');
    assert.equal((await client.query('SELECT fn_service_total($1) AS total', [fixture.partial.booking_id])).rows[0].total, '62.50');

    // Cross-booking attribution is refused by both the service and the guard.
    await assert.rejects(recordServiceUsage(client, { bookingId: fixture.partial.booking_id, serviceId: fixture.serviceId,
      quantity: 1, bookingRoomLineId: otherLine.line_id, recordedBy: fixture.serviceStaffId }), /same booking/);
    await assert.rejects(client.query(`INSERT INTO service_usage (booking_id, booking_room_line_id, service_id, quantity, unit_price_snapshot, recorded_by)
      VALUES ($1, $2, $3, 1, 50, $4)`, [fixture.partial.booking_id, otherLine.line_id, fixture.serviceId, fixture.serviceStaffId]), { code: '23514' });
    await assert.rejects(client.query(`INSERT INTO service_usage (booking_id, booking_room_line_id, service_id, quantity, unit_price_snapshot, recorded_by)
      VALUES ($1, uuidv7(), $2, 1, 50, $3)`, [fixture.partial.booking_id, fixture.serviceId, fixture.serviceStaffId]), { code: '23503' });
    await assert.rejects(recordServiceUsage(client, { bookingId: fixture.partial.booking_id, serviceId: fixture.serviceId,
      quantity: 1, bookingRoomLineId: laterLine.line_id, recordedBy: fixture.serviceStaffId }), /same booking/);
    await assert.rejects(recordServiceUsage(client, { bookingId: fixture.laterCheckIn.booking_id, serviceId: fixture.serviceId,
      quantity: 1, bookingRoomLineId: laterLine.line_id, recordedBy: fixture.serviceStaffId }), /must be CHECKED_IN/);
    await assert.rejects(recordServiceUsage(client, { bookingId: fixture.laterCheckIn.booking_id, serviceId: fixture.serviceId,
      quantity: 1, recordedBy: fixture.serviceStaffId }), /requires a CHECKED_IN/);
    assert.equal((await client.query('SELECT count(*)::int AS count FROM service_usage WHERE booking_id = $1', [fixture.partial.booking_id])).rows[0].count, 1,
      'no refused attribution left a row behind');

    // Booking-wide usage stays explicitly unallocated.
    const unallocated = await recordServiceUsage(client, { bookingId: fixture.partial.booking_id, serviceId: fixture.serviceId,
      quantity: 1, recordedBy: fixture.serviceStaffId });
    assert.equal(unallocated.bookingRoomLineId, null);

    // A catalogue price change is invisible to charges already recorded.
    const beforeChange = (await client.query('SELECT quantity, unit_price_snapshot, recorded_by, recorded_at, voided FROM service_usage WHERE usage_id = $1', [recorded.usageId])).rows[0];
    const invoiceBefore = (await client.query(`SELECT line_type, booking_room_line_id::text AS line, description, amount
      FROM invoice_line WHERE invoice_id = (SELECT invoice_id FROM invoice WHERE booking_id = $1) ORDER BY line_type, coalesce(booking_room_line_id::text, ''), description`, [fixture.partial.booking_id])).rows;
    await client.query('UPDATE service SET current_price = 75 WHERE service_id = $1', [fixture.serviceId]);
    const afterChange = (await client.query('SELECT quantity, unit_price_snapshot, recorded_by, recorded_at, voided FROM service_usage WHERE usage_id = $1', [recorded.usageId])).rows[0];
    assert.deepEqual(afterChange, beforeChange, 'a price change never rewrites a stored charge');
    assert.equal(afterChange.unit_price_snapshot, '50.00');
    const invoiceAfter = (await client.query(`SELECT line_type, booking_room_line_id::text AS line, description, amount
      FROM invoice_line WHERE invoice_id = (SELECT invoice_id FROM invoice WHERE booking_id = $1) ORDER BY line_type, coalesce(booking_room_line_id::text, ''), description`, [fixture.partial.booking_id])).rows;
    assert.deepEqual(invoiceAfter, invoiceBefore, 'a price change never rewrites a billed amount');
    assert.equal((await client.query('SELECT fn_service_total($1) AS total', [fixture.partial.booking_id])).rows[0].total, '112.50');

    // Only later charges see the new price.
    const recharged = await recordServiceUsage(client, { bookingId: fixture.crossBooking.booking_id, serviceId: fixture.serviceId,
      quantity: 2, bookingRoomLineId: otherLine.line_id, recordedBy: fixture.serviceStaffId });
    assert.equal(recharged.unitPriceSnapshot, '75.00');

    // Voiding keeps the original row, actor and price, and leaves the
    // occupancy segment and physical room history untouched.
    await settle(client, fixture.partial.booking_id, fixture.frontDeskId, 'LIFECYCLE-USAGE');
    const segmentsBefore = await openSegmentCount(client, fixture.partial.booking_id);
    const roomHistoryBefore = (await client.query('SELECT count(*)::int AS count FROM room_status_history')).rows[0].count;
    const occupancyBefore = (await client.query('SELECT occupied_from, occupied_to, unassigned_at FROM booking_room_assignment WHERE line_id = $1', [first.line_id])).rows[0];

    const voided = await voidServiceUsage(client, { usageId: recorded.usageId, bookingId: fixture.partial.booking_id,
      voidedBy: fixture.chainManagerId, reason: 'Guest complaint' });
    assert.equal(voided.voidedAmount, '62.50');
    assert.equal(voided.balance.isCredit, true, 'a settled void surfaces a credit for manual refund handling');

    const retained = (await client.query('SELECT quantity, unit_price_snapshot, recorded_by, recorded_at, voided, voided_by, voided_at FROM service_usage WHERE usage_id = $1', [recorded.usageId])).rows[0];
    assert.equal(retained.quantity, '1.25');
    assert.equal(retained.unit_price_snapshot, '50.00');
    assert.equal(retained.recorded_by, fixture.serviceStaffId);
    assert.equal(new Date(retained.recorded_at).getTime(), new Date(beforeChange.recorded_at).getTime());
    assert.equal(retained.voided, true);
    assert.equal(retained.voided_by, fixture.chainManagerId);
    assert.ok(retained.voided_at instanceof Date);
    assert.equal((await client.query('SELECT count(*)::int AS count FROM service_usage WHERE booking_id = $1', [fixture.partial.booking_id])).rows[0].count, 2,
      'the voided charge is retained, not deleted');
    assert.equal((await client.query("SELECT fn_service_total($1) AS total", [fixture.partial.booking_id])).rows[0].total, '50.00', 'billing excludes the voided charge');
    const voidAudits = (await client.query("SELECT before_value, after_value FROM audit_log WHERE entity_name = 'service_usage' AND entity_id = $1 AND action = 'VOID'", [recorded.usageId])).rows;
    assert.equal(voidAudits.length, 1);
    assert.match(voidAudits[0].after_value, /voided"\s*:\s*true/);
    assert.match(voidAudits[0].after_value, /Guest complaint/);
    await assert.rejects(voidServiceUsage(client, { usageId: recorded.usageId, bookingId: fixture.partial.booking_id,
      voidedBy: fixture.chainManagerId }), /already voided/);

    assert.equal(await openSegmentCount(client, fixture.partial.booking_id), segmentsBefore, 'a financial void never changes occupancy');
    assert.deepEqual((await client.query('SELECT occupied_from, occupied_to, unassigned_at FROM booking_room_assignment WHERE line_id = $1', [first.line_id])).rows[0], occupancyBefore);
    assert.equal((await client.query('SELECT count(*)::int AS count FROM room_status_history')).rows[0].count, roomHistoryBefore,
      'a financial void never writes a room-condition event');

    // FR-058: a FINAL invoice refuses an ordinary later void.
    const finalLine = fixture.finalizable.lines[0];
    await checkInRoomLine(client, { lineId: finalLine.line_id, actorId: fixture.frontDeskId, schema });
    const finalUsage = await recordServiceUsage(client, { bookingId: fixture.finalizable.booking_id, serviceId: fixture.serviceId,
      quantity: 1, bookingRoomLineId: finalLine.line_id, recordedBy: fixture.serviceStaffId });
    await settle(client, fixture.finalizable.booking_id, fixture.frontDeskId, 'LIFECYCLE-FINAL');
    const finalReceipt = await checkout(client, fixture.finalizable.booking_id, finalLine.line_id, fixture.frontDeskId);
    assert.equal(finalReceipt.is_finalized, true);
    await assert.rejects(recordServiceUsage(client, { bookingId: fixture.finalizable.booking_id, serviceId: fixture.serviceId,
      quantity: 1, bookingRoomLineId: finalLine.line_id, recordedBy: fixture.serviceStaffId }), /FINAL/);
    await assert.rejects(voidServiceUsage(client, { usageId: finalUsage.usageId, bookingId: fixture.finalizable.booking_id,
      voidedBy: fixture.chainManagerId }), /FINAL/);
    const untouched = (await client.query('SELECT voided FROM service_usage WHERE usage_id = $1', [finalUsage.usageId])).rows[0];
    assert.equal(untouched.voided, false);
    assert.equal((await client.query('SELECT count(*)::int AS count FROM room_status_history')).rows[0].count, 1,
      'the checked-out room keeps exactly one condition event');
  });
});

test('M3-S17 a cross-branch actor cannot reach another branch\u2019s occupied room or usage', async () => {
  await withChain(async ({ client, schema }) => {
    const fixture = await seed(client);
    const [first] = fixture.partial.lines;
    await checkInRoomLine(client, { lineId: first.line_id, actorId: fixture.frontDeskId, schema });
    await recordServiceUsage(client, { bookingId: fixture.partial.booking_id, serviceId: fixture.serviceId,
      quantity: 1, bookingRoomLineId: first.line_id, recordedBy: fixture.serviceStaffId });

    const stays = await withPool(client, async () => {
      const { getActiveStay } = require('../src/controllers/activeStayController');
      const body = { statusCode: 200, value: null, status(code) { this.statusCode = code; return this; },
        json(value) { this.value = value; return this; } };
      await getActiveStay({ params: { bookingRef: fixture.partial.booking_ref }, user: { userId: fixture.otherBranchStaffId }, body: {}, headers: {} }, body);
      return body;
    });
    assert.equal(stays.statusCode, 403);
    assert.equal(stays.value.error.code, 'STAY_ACCESS_DENIED');
    assert.equal((await roomHistory(client, first.room_id)).length, 0);
  });
});

// The m1-m3 mock chain is what deployments already carry, so the upgrade has
// to preserve recorded rows, snapshots, ids and existing history in place
// (M3-S04/M3-S03) rather than recreate them.
test('M3-S17 the published m1-m3 mock chain upgrades in place without losing ids, snapshots or history', async () => {
  await withChain(async ({ client, schema, directory }) => {
    const fixture = await seed(client);
    const [first] = fixture.partial.lines;
    await checkInRoomLine(client, { lineId: first.line_id, actorId: fixture.frontDeskId, schema });
    const serviceId = (await client.query("INSERT INTO service (name, category, current_price) VALUES ('Mock laundry', 'Laundry', 75) RETURNING service_id")).rows[0].service_id;
    const usageId = (await client.query(`INSERT INTO service_usage (booking_id, booking_room_line_id, service_id, quantity, unit_price_snapshot, recorded_by)
      VALUES ($1, $2, $3, 1.5, 75, $4) RETURNING usage_id`, [fixture.partial.booking_id, first.line_id, serviceId, fixture.serviceStaffId])).rows[0].usage_id;
    const historyId = (await client.query(`INSERT INTO room_status_history (room_id, old_status, new_status, changed_by, reason)
      VALUES ($1, 'CLEANING', 'READY', $2, 'Pre-existing evidence') RETURNING room_history_id`, [first.room_id, fixture.frontDeskId])).rows[0].room_history_id;
    const upgrade = await applyM3Upgrades(client, directory);
    assert.deepEqual(upgrade.applied, m3Upgrades);

    const usage = (await client.query('SELECT booking_id, service_id, booking_room_line_id, quantity, unit_price_snapshot, recorded_by, voided FROM service_usage WHERE usage_id = $1', [usageId])).rows[0];
    assert.equal(usage.quantity, '1.50');
    assert.equal(usage.unit_price_snapshot, '75.00', 'the upgrade keeps the recorded snapshot');
    assert.equal(usage.booking_room_line_id, first.line_id);
    assert.equal(usage.recorded_by, fixture.serviceStaffId);
    assert.equal(usage.voided, false);
    assert.equal((await client.query('SELECT reason FROM room_status_history WHERE room_history_id = $1', [historyId])).rows[0].reason, 'Pre-existing evidence');
    assert.ok((await client.query("SELECT to_regprocedure('fn_set_room_condition(uuid,room_condition_enum,uuid,character varying)') AS hook")).rows[0].hook,
      'the condition operation survives the upgrade for Member 4 checkout');

    // The upgraded guards apply to rows the mock chain already held.
    await assert.rejects(client.query('DELETE FROM room_status_history WHERE room_history_id = $1', [historyId]), { code: '42501' });
    await assert.rejects(client.query("UPDATE service SET current_price = 'NaN' WHERE service_id = $1", [serviceId]), { code: '23514' });
    await assert.rejects(client.query('UPDATE service_usage SET voided = true WHERE usage_id = $1', [usageId]), { code: '23514' });
    await assert.rejects(client.query(`UPDATE service_usage SET unit_price_snapshot = 10 WHERE usage_id = $1`, [usageId]), { code: '23514' });
    const voided = await voidServiceUsage(client, { usageId, bookingId: fixture.partial.booking_id, voidedBy: fixture.chainManagerId });
    assert.equal(voided.voidedAmount, '112.50', 'the upgraded void reverses the preserved charge exactly');
    const retained = (await client.query('SELECT quantity, unit_price_snapshot, recorded_by FROM service_usage WHERE usage_id = $1', [usageId])).rows[0];
    assert.deepEqual({ quantity: retained.quantity, unit_price_snapshot: retained.unit_price_snapshot, recorded_by: retained.recorded_by },
      { quantity: '1.50', unit_price_snapshot: '75.00', recorded_by: fixture.serviceStaffId });
  }, { deferM3Upgrades: true });
});

// This suite verifies the m1-m4 chain because the two Member 5 reporting
// migrations below cannot apply to it. The assertions state the reason rather
// than trusting a comment: when their owners fix them, this test fails and the
// exclusion list is expected to be removed so a full clean apply is verified.
test('M3-S17 documents the two Member 5 migrations that still block a full clean chain apply', async () => {
  await withChain(async ({ client }) => {
    const staleColumns = (await client.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'booking'
        AND column_name IN ('branch_id', 'check_in_date')`)).rows;
    assert.deepEqual(staleColumns, [], 'Member 2 keeps branch on the room and the dates on the line');

    await assert.rejects(
      client.query('CREATE INDEX idx_booking_branch_dates_status ON booking (branch_id, check_in_date, status)'),
      { code: '42703' },
      'm5_002 still indexes columns the normalized booking header does not have',
    );
    await assert.rejects(
      client.query(`INSERT INTO system_config (config_key, config_value, effective_from)
        VALUES ('tax_rate', '0.08', CURRENT_DATE)`),
      { code: '42501' },
      'm5_003 still writes system_config with no active SYSTEM_ADMINISTRATOR officer in the chain',
    );
    const administrators = (await client.query(`SELECT count(*)::int AS count FROM officer officer
      JOIN role role ON role.role_id = officer.role_id WHERE role.role_name = 'SYSTEM_ADMINISTRATOR'`)).rows[0].count;
    assert.equal(administrators, 0);
  });
});