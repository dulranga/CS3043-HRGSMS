// M3-S18: the audited physical room-condition change operation on the clean
// numbered chain. Drives the real service, the real fn_set_room_condition and
// Member 4's real checkout: own-branch BRANCH_MANAGER/SERVICE_STAFF direct
// transitions, no-op/history behavior, wrong role and wrong branch, the
// OUT_OF_SERVICE active-assignment conflict, and the internal CLEANING
// transition including checkout rollback.
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { loadMigrations } = require('../src/migrations/migrate');
const { checkInRoomLine } = require('../src/services/checkInService');
const { checkoutRoomLine } = require('../src/services/checkoutService');
const { changeRoomCondition, checkoutCleaningTransition } = require('../src/services/roomConditionService');

const sourceDir = path.join(__dirname, '..', 'migrations');
const connectionString = process.env.PG_TEST_URL || process.env.PG_URL;

// A transaction pool does not preserve SET search_path between transactions.
// Pin every assertion and write to its own explicit transaction and SET LOCAL.
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

// m5_002 indexes booking (branch_id, check_in_date, status), which Member 2's
// normalized booking header does not carry, and m5_003's seed insert is refused
// by Member 1's system_config guard because the chain seeds no active
// SYSTEM_ADMINISTRATOR. Both are Member 5's files and unrelated to this
// operation; the same exclusions are documented for the M3-S17 suite.
const chainExclusions = ['m5_002_create_audit_indexes.sql', 'm5_003_seed_config_values.sql'];

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

async function withChain(run) {
  const schema = `m3_condition_${randomBytes(8).toString('hex')}`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'skynest-m3-condition-'));
  const numbered = fs.readdirSync(sourceDir)
    .filter((name) => /^(?:m\d+_)?\d+_.+\.sql$/.test(name) && !chainExclusions.includes(name));
  const client = new Client({ connectionString });
  for (const name of numbered) fs.copyFileSync(path.join(sourceDir, name), path.join(directory, name));
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    isolateClient(client, schema);
    const applied = await applyChain(client, directory);
    assert.equal(applied.applied.length, numbered.length);
    await run({ client, schema });
  } finally {
    await client.query('ROLLBACK');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function officer(client, username, roles, roleName, branchId, { active = true } = {}) {
  const userId = (await client.query('INSERT INTO user_account (username) VALUES ($1) RETURNING user_id', [username])).rows[0].user_id;
  const roleId = roles.find((role) => role.role_name === roleName).role_id;
  await client.query('INSERT INTO officer (officer_id, full_name, role_id, branch_id, active) VALUES ($1, $2, $3, $4, $5)',
    [userId, username, roleId, branchId, active]);
  return userId;
}

async function historyFor(client, roomId) {
  return (await client.query(
    'SELECT old_status, new_status, changed_by, reason FROM room_status_history WHERE room_id = $1 ORDER BY changed_at, room_history_id',
    [roomId],
  )).rows;
}

async function conditionOf(client, roomId) {
  return (await client.query('SELECT operational_status FROM room WHERE room_id = $1', [roomId])).rows[0].operational_status;
}

// Four rooms in the seeded branch: one unassigned, one holding a BOOKED line,
// one holding a CHECKED_IN line and one released to cleaning by checkout.
async function seed(client) {
  const branches = (await client.query('SELECT branch_id FROM branch ORDER BY branch_id LIMIT 2')).rows;
  const roles = (await client.query('SELECT role_name, role_id FROM role')).rows;
  const branchId = branches[0].branch_id;
  const otherBranchId = branches[1].branch_id;
  const actors = {
    branchId,
    otherBranchId,
    frontDeskId: await officer(client, 'condition.frontdesk', roles, 'FRONT_DESK', branchId),
    serviceStaffId: await officer(client, 'condition.service', roles, 'SERVICE_STAFF', branchId),
    branchManagerId: await officer(client, 'condition.manager', roles, 'BRANCH_MANAGER', branchId),
    chainManagerId: await officer(client, 'condition.chain', roles, 'CHAIN_MANAGER', branchId),
    systemAdminId: await officer(client, 'condition.admin', roles, 'SYSTEM_ADMINISTRATOR', branchId),
    auditorId: await officer(client, 'condition.auditor', roles, 'AUDITOR', branchId),
    otherServiceStaffId: await officer(client, 'condition.otherservice', roles, 'SERVICE_STAFF', otherBranchId),
    inactiveServiceStaffId: await officer(client, 'condition.inactive', roles, 'SERVICE_STAFF', branchId, { active: false }),
  };

  // An online guest has an active user_account but no officer profile.
  const guestUserId = (await client.query("INSERT INTO user_account (username) VALUES ('condition.guest') RETURNING user_id")).rows[0].user_id;
  const guestId = (await client.query("INSERT INTO guest (full_name) VALUES ('Condition guest') RETURNING guest_id")).rows[0].guest_id;
  await client.query('INSERT INTO guest_account (guest_id, user_id) VALUES ($1, $2)', [guestId, guestUserId]);
  actors.guestUserId = guestUserId;

  const policyId = (await client.query(`INSERT INTO billing_policy
    (effective_from, tax_percent, service_charge_percent, max_discount_percent,
     cancellation_fee, no_show_fee, late_checkout_fee, no_show_grace_days, is_demo, created_by)
    VALUES ('2020-01-01', 0, 0, 0, 0, 0, 0, 1, false, $1) RETURNING billing_policy_id`, [actors.chainManagerId])).rows[0].billing_policy_id;
  const typeId = (await client.query("INSERT INTO room_type (name, capacity, base_daily_rate) VALUES ('Condition type', 2, 100) RETURNING room_type_id")).rows[0].room_type_id;
  const roomIds = [];
  for (let index = 0; index < 4; index += 1) {
    roomIds.push((await client.query('INSERT INTO room (room_number, branch_id, room_type_id) VALUES ($1, $2, $3) RETURNING room_id',
      [String(700 + index), branchId, typeId])).rows[0].room_id);
  }
  const dates = (await client.query(`SELECT to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::date, 'YYYY-MM-DD') AS today,
      to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::date + 4, 'YYYY-MM-DD') AS end`)).rows[0];

  async function createBooking(label, roomIdsToBook) {
    const guestId = (await client.query('INSERT INTO guest (full_name) VALUES ($1) RETURNING guest_id', [`Condition ${label}`])).rows[0].guest_id;
    const selections = roomIdsToBook.map((roomId) => ({ roomId, checkIn: dates.today, checkOut: dates.end,
      guestCount: 1, quotedRoomTypeId: typeId, quotedBaseDailyRate: '100.00' }));
    await client.query('BEGIN');
    const booking = (await client.query('SELECT * FROM sp_create_booking($1::uuid, $2::booking_channel_enum, $3::uuid, $4::uuid, $5::uuid, $6::jsonb)',
      [guestId, 'FRONT_DESK', actors.frontDeskId, branchId, policyId, JSON.stringify(selections)])).rows[0];
    const lines = (await client.query(`SELECT line.line_id, assignment.room_id
      FROM booking_room_line line JOIN booking_room_assignment assignment USING (line_id)
      WHERE booking_id = $1 ORDER BY assignment.room_id`, [booking.booking_id])).rows;
    await client.query('COMMIT');
    return { ...booking, lines };
  }

  async function settle(bookingId) {
    await client.query('SELECT fn_refresh_draft_invoice($1, $2)', [bookingId, actors.frontDeskId]);
    const balance = (await client.query('SELECT fn_outstanding_balance($1) AS balance', [bookingId])).rows[0].balance;
    if (Number(balance) !== 0) {
      await client.query("SELECT fn_record_payment($1, $2, 'PAYMENT', $3, 'CASH', 'CONDITION-PAY', 'SUCCESSFUL')",
        [bookingId, actors.frontDeskId, balance]);
    }
  }

  return { ...actors, policyId, typeId, roomIds, freeRoomId: roomIds[0], dates, createBooking, settle };
}

test('M3-S18 own-branch BRANCH_MANAGER and SERVICE_STAFF transitions write one history row each', async () => {
  await withChain(async ({ client }) => {
    const fixture = await seed(client);
    const roomId = fixture.freeRoomId;
    assert.equal(await conditionOf(client, roomId), 'READY');
    assert.deepEqual(await historyFor(client, roomId), []);

    // Every contract transition pair is allowed, each writing exactly one row.
    for (const [condition, actorId] of [
      ['CLEANING', fixture.serviceStaffId],
      ['READY', fixture.branchManagerId],
      ['OUT_OF_SERVICE', fixture.serviceStaffId],
      ['CLEANING', fixture.branchManagerId],
      ['READY', fixture.serviceStaffId],
    ]) {
      const result = await changeRoomCondition(client, { roomId, condition, actorId, reason: 'Housekeeping cycle' });
      assert.equal(result.changed, true);
      assert.equal(result.condition, condition);
      assert.equal(await conditionOf(client, roomId), condition);
    }

    const history = await historyFor(client, roomId);
    assert.equal(history.length, 5);
    assert.deepEqual(history.map((row) => [row.old_status, row.new_status]), [
      ['READY', 'CLEANING'],
      ['CLEANING', 'READY'],
      ['READY', 'OUT_OF_SERVICE'],
      ['OUT_OF_SERVICE', 'CLEANING'],
      ['CLEANING', 'READY'],
    ]);
    for (const row of history) {
      assert.notEqual(row.old_status, row.new_status);
      assert.ok(row.reason);
      assert.ok(row.changed_by);
    }
    assert.ok([fixture.serviceStaffId, fixture.branchManagerId].includes(history[0].changed_by));

    // A repeated value is a no-op: no second row, no apparent change.
    const repeated = await changeRoomCondition(client, { roomId, condition: 'READY', actorId: fixture.serviceStaffId });
    assert.equal(repeated.changed, false);
    assert.equal(repeated.historyId, null);
    assert.equal(repeated.previousCondition, 'READY');
    assert.equal(await historyFor(client, roomId).then((rows) => rows.length), 5);

    // Input outside the stored physical domain is refused before any write.
    await assert.rejects(
      changeRoomCondition(client, { roomId, condition: 'AVAILABLE', actorId: fixture.serviceStaffId }),
      (error) => error.code === 'INVALID_ROOM_CONDITION_INPUT' && error.statusCode === 400,
    );
    await assert.rejects(
      changeRoomCondition(client, { roomId: 'not-a-uuid', condition: 'READY', actorId: fixture.serviceStaffId }),
      (error) => error.code === 'INVALID_ROOM_CONDITION_INPUT',
    );
    await assert.rejects(
      changeRoomCondition(client, { roomId: randomUUID(), condition: 'READY', actorId: fixture.serviceStaffId }),
      (error) => error.code === 'ROOM_NOT_FOUND' && error.statusCode === 404,
    );
    assert.equal(await historyFor(client, roomId).then((rows) => rows.length), 5);
  });
});

test('M3-S18 refuses wrong roles, wrong branch, inactive officers and guests without writing history', async () => {
  await withChain(async ({ client }) => {
    const fixture = await seed(client);
    const roomId = fixture.freeRoomId;

    for (const [label, actorId] of [
      ['FRONT_DESK', fixture.frontDeskId],
      ['CHAIN_MANAGER', fixture.chainManagerId],
      ['SYSTEM_ADMINISTRATOR', fixture.systemAdminId],
      ['AUDITOR', fixture.auditorId],
      ['other-branch SERVICE_STAFF', fixture.otherServiceStaffId],
      ['inactive SERVICE_STAFF', fixture.inactiveServiceStaffId],
      ['online guest without officer profile', fixture.guestUserId],
      ['unknown actor', randomUUID()],
    ]) {
      await assert.rejects(
        changeRoomCondition(client, { roomId, condition: 'CLEANING', actorId }),
        (error) => error.code === 'ROOM_CONDITION_ACCESS_DENIED' && error.statusCode === 403,
        `${label} must not change physical room condition`,
      );
    }

    assert.equal(await conditionOf(client, roomId), 'READY');
    assert.deepEqual(await historyFor(client, roomId), []);

    // A failed authorization rolls back cleanly and leaves the room lock usable.
    const allowed = await changeRoomCondition(client, { roomId, condition: 'CLEANING', actorId: fixture.serviceStaffId });
    assert.equal(allowed.changed, true);
    assert.equal(await historyFor(client, roomId).then((rows) => rows.length), 1);
  });
});

test('M3-S18 refuses OUT_OF_SERVICE while BOOKED or CHECKED_IN assignments remain', async () => {
  await withChain(async ({ client }) => {
    const fixture = await seed(client);
    const bookedRoomId = fixture.roomIds[1];
    const checkedInRoomId = fixture.roomIds[2];
    const first = await fixture.createBooking('outofservice', [bookedRoomId, checkedInRoomId]);
    const bookedLine = first.lines[0].line_id;
    const checkedInLine = first.lines[1].line_id;
    await checkInRoomLine(client, { lineId: checkedInLine, actorId: fixture.frontDeskId });
    assert.equal(await conditionOf(client, checkedInRoomId), 'READY');

    for (const [label, roomId] of [['BOOKED', bookedRoomId], ['CHECKED_IN', checkedInRoomId]]) {
      await assert.rejects(
        changeRoomCondition(client, { roomId, condition: 'OUT_OF_SERVICE', actorId: fixture.serviceStaffId }),
        (error) => error.code === 'ROOM_CONDITION_CONFLICT' && error.statusCode === 409,
        `a ${label} assignment must block OUT_OF_SERVICE`,
      );
      assert.equal(await conditionOf(client, roomId), 'READY');
      assert.deepEqual(await historyFor(client, roomId), []);
    }

    // READY/CLEANING remain available to housekeeping while a guest is in place.
    const cleaning = await changeRoomCondition(client, { roomId: checkedInRoomId, condition: 'CLEANING', actorId: fixture.serviceStaffId });
    assert.equal(cleaning.changed, true);
    await changeRoomCondition(client, { roomId: checkedInRoomId, condition: 'READY', actorId: fixture.serviceStaffId });
    assert.equal(await historyFor(client, checkedInRoomId).then((rows) => rows.length), 2);

    // Once the stay ends the room may leave service for an extended outage.
    await checkInRoomLine(client, { lineId: bookedLine, actorId: fixture.frontDeskId });
    await fixture.settle(first.booking_id);
    await checkoutRoomLine(client, { bookingId: first.booking_id, lineId: bookedLine, actorId: fixture.frontDeskId, reason: 'Guest checkout' });
    await checkoutRoomLine(client, { bookingId: first.booking_id, lineId: checkedInLine, actorId: fixture.frontDeskId, reason: 'Guest checkout' });
    const outage = await changeRoomCondition(client, { roomId: bookedRoomId, condition: 'OUT_OF_SERVICE', actorId: fixture.branchManagerId, reason: 'Air conditioning repair' });
    assert.equal(outage.changed, true);
    const bookedHistory = await historyFor(client, bookedRoomId);
    assert.deepEqual(bookedHistory.map((row) => [row.old_status, row.new_status]), [['READY', 'CLEANING'], ['CLEANING', 'OUT_OF_SERVICE']]);
    assert.equal(bookedHistory[1].reason, 'Air conditioning repair');
  });
});

test('M3-S18 authorized FRONT_DESK checkout performs the internal CLEANING transition and rollback removes it', async () => {
  await withChain(async ({ client }) => {
    const fixture = await seed(client);
    const booking = await fixture.createBooking('checkout', [fixture.roomIds[3]]);
    const lineId = booking.lines[0].line_id;
    await checkInRoomLine(client, { lineId, actorId: fixture.frontDeskId });

    // Checkout authorization is Member 4's; the CLEANING transition is internal.
    await assert.rejects(
      changeRoomCondition(client, { roomId: fixture.roomIds[3], condition: 'CLEANING', actorId: fixture.frontDeskId }),
      (error) => error.code === 'ROOM_CONDITION_ACCESS_DENIED',
    );
    assert.deepEqual(await historyFor(client, fixture.roomIds[3]), []);

    // A failed checkout transaction leaves the line checked in and the room's
    // prior condition and history untouched (SRS §4.7.2 exception path).
    await fixture.settle(booking.booking_id);
    await client.query('BEGIN');
    await checkoutRoomLine(client, { bookingId: booking.booking_id, lineId, actorId: fixture.frontDeskId, reason: 'Guest checkout' });
    await client.query('ROLLBACK');
    assert.equal(await conditionOf(client, fixture.roomIds[3]), 'READY');
    assert.deepEqual(await historyFor(client, fixture.roomIds[3]), []);
    assert.equal((await client.query('SELECT status FROM booking_room_line WHERE line_id = $1', [lineId])).rows[0].status, 'CHECKED_IN');
    assert.equal((await client.query('SELECT unassigned_at FROM booking_room_assignment WHERE line_id = $1', [lineId])).rows[0].unassigned_at, null);

    // The same operation commits through the real checkout procedure.
    const receipt = await checkoutRoomLine(client, { bookingId: booking.booking_id, lineId, actorId: fixture.frontDeskId, reason: 'Guest checkout' });
    assert.equal(receipt.receipt.room_condition, 'CLEANING');
    assert.equal(await conditionOf(client, fixture.roomIds[3]), 'CLEANING');
    const history = await historyFor(client, fixture.roomIds[3]);
    assert.equal(history.length, 1);
    assert.deepEqual([history[0].old_status, history[0].new_status], ['READY', 'CLEANING']);
    assert.equal(history[0].changed_by, fixture.frontDeskId);
    assert.equal(history[0].reason, 'Room released to cleaning after checkout');

    // Housekeeping returns the room to service without any further checkout.
    const ready = await changeRoomCondition(client, { roomId: fixture.roomIds[3], condition: 'READY', actorId: fixture.serviceStaffId, reason: 'Housekeeping complete' });
    assert.equal(ready.changed, true);
    assert.equal((await historyFor(client, fixture.roomIds[3])).length, 2);
  });
});

test('M3-S18 internal CLEANING transition joins the caller transaction and never grants a direct right', async () => {
  await withChain(async ({ client }) => {
    const fixture = await seed(client);
    const roomId = fixture.roomIds[0];

    await client.query('BEGIN');
    const inside = await checkoutCleaningTransition(client, { roomId, actorId: fixture.frontDeskId });
    assert.equal(inside.changed, true);
    assert.equal(await conditionOf(client, roomId), 'CLEANING');
    assert.equal((await historyFor(client, roomId)).length, 1);
    await client.query('ROLLBACK');
    assert.equal(await conditionOf(client, roomId), 'READY');
    assert.deepEqual(await historyFor(client, roomId), []);

    // A repeated internal transition is still a no-op with no second row.
    await client.query('BEGIN');
    await checkoutCleaningTransition(client, { roomId, actorId: fixture.frontDeskId });
    const repeated = await checkoutCleaningTransition(client, { roomId, actorId: fixture.frontDeskId });
    assert.equal(repeated.changed, false);
    assert.equal((await historyFor(client, roomId)).length, 1);
    await client.query('COMMIT');

    // The internal entry point still refuses an actor that is not active staff.
    await assert.rejects(
      checkoutCleaningTransition(client, { roomId, actorId: fixture.guestUserId }),
      (error) => error.code === 'ROOM_CONDITION_ACCESS_DENIED',
    );
    assert.equal(await conditionOf(client, roomId), 'CLEANING');
  });
});