const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { Client } = require('pg');
const express = require('express');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { loadMigrations } = require('../src/migrations/migrate');
const { checkInRoomLine } = require('../src/services/checkInService');

const sourceDir = path.join(__dirname, '..', 'migrations');
const upgrades = ['m3_003_service_usage.sql', 'm3_004_service_catalogue.sql', 'm3_005_room_status_history.sql'];
const connectionString = process.env.PG_TEST_URL || process.env.PG_URL;

// A transaction pool does not preserve SET search_path between transactions.
// Pin every assertion/write to its own explicit transaction and SET LOCAL;
// never run the session-scoped production migration runner against this pool.
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

async function withChain(warm, run) {
  const schema = `m3_baseline_${randomBytes(8).toString('hex')}`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'skynest-m3-chain-'));
  const client = new Client({ connectionString });
  // audit_and_config.sql is a pre-existing, unnumbered Member 5 SQL reference.
  // The production runner rejects it; this test checks the numbered chain only.
  const numbered = fs.readdirSync(sourceDir).filter((name) => /^(?:m\d+_)?\d+_.+\.sql$/.test(name));
  for (const name of numbered) {
    if (!warm || !upgrades.includes(name)) fs.copyFileSync(path.join(sourceDir, name), path.join(directory, name));
  }
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    isolateClient(client, schema);
    const initial = await applyChain(client, directory);
    assert.equal(initial.applied.length, numbered.length - (warm ? upgrades.length : 0));
    await run({ client, schema, directory, numbered });
  } finally {
    await client.query('ROLLBACK');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function seed(client) {
  await client.query('BEGIN');
  const branches = (await client.query('SELECT branch_id FROM branch ORDER BY branch_id LIMIT 2')).rows;
  const roles = (await client.query('SELECT role_name, role_id FROM role')).rows;
  async function officer(username, roleName, branchId) {
    const id = (await client.query('INSERT INTO user_account (username) VALUES ($1) RETURNING user_id', [username])).rows[0].user_id;
    await client.query('INSERT INTO officer (officer_id, full_name, role_id, branch_id) VALUES ($1, $2, $3, $4)',
      [id, username, roles.find((role) => role.role_name === roleName).role_id, branchId]);
    return id;
  }
  const branchId = branches[0].branch_id;
  const staffId = await officer('baseline.frontdesk', 'FRONT_DESK', branchId);
  const otherStaffId = await officer('baseline.otherdesk', 'FRONT_DESK', branches[1].branch_id);
  const managerId = await officer('baseline.manager', 'CHAIN_MANAGER', branchId);
  const policyId = (await client.query(`INSERT INTO billing_policy
    (effective_from, tax_percent, service_charge_percent, max_discount_percent,
     cancellation_fee, no_show_fee, late_checkout_fee, no_show_grace_days, is_demo, created_by)
    VALUES ('2020-01-01', 0, 0, 0, 0, 0, 0, 1, false, $1) RETURNING billing_policy_id`, [managerId])).rows[0].billing_policy_id;
  const guestId = (await client.query("INSERT INTO guest (full_name) VALUES ('Baseline guest') RETURNING guest_id")).rows[0].guest_id;
  const typeId = (await client.query("INSERT INTO room_type (name, capacity, base_daily_rate) VALUES ('Baseline type', 2, 100) RETURNING room_type_id")).rows[0].room_type_id;
  const rooms = [];
  for (let index = 0; index < 3; index++) {
    rooms.push((await client.query('INSERT INTO room (room_number, branch_id, room_type_id) VALUES ($1, $2, $3) RETURNING room_id',
      [String(100 + index), branchId, typeId])).rows[0].room_id);
  }
  const today = (await client.query("SELECT to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::date, 'YYYY-MM-DD') AS today")).rows[0].today;
  const tomorrow = (await client.query("SELECT to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::date + 1, 'YYYY-MM-DD') AS tomorrow")).rows[0].tomorrow;
  const end = (await client.query("SELECT to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::date + 4, 'YYYY-MM-DD') AS end")).rows[0].end;
  const selections = rooms.map((roomId, index) => ({ roomId, checkIn: index === 2 ? tomorrow : today,
    checkOut: end, guestCount: 1, quotedRoomTypeId: typeId, quotedBaseDailyRate: '100.00' }));
  // Policy publication precedes the confirmation transaction's snapshot time.
  await client.query('COMMIT');
  await client.query('BEGIN');
  const booking = (await client.query('SELECT * FROM sp_create_booking($1::uuid, $2::booking_channel_enum, $3::uuid, $4::uuid, $5::uuid, $6::jsonb)',
    [guestId, 'FRONT_DESK', staffId, branchId, policyId, JSON.stringify(selections)])).rows[0];
  const lines = (await client.query(`SELECT line.line_id, assignment.room_id
    FROM booking_room_line line JOIN booking_room_assignment assignment USING (line_id)
    WHERE booking_id = $1 ORDER BY assignment.room_id`, [booking.booking_id])).rows;
  await client.query('COMMIT');
  return { ...booking, staffId, otherStaffId, managerId, lines, rooms, today, tomorrow };
}

function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; } };
}

test('numbered current chain supports M2 creation, M3 check-in/stays and M4 checkout', async () => {
  await withChain(false, async ({ client, schema, directory, numbered }) => {
    assert.equal(new Set(loadMigrations(directory).map((migration) => migration.key)).size, numbered.length);
    const rerun = await applyChain(client, directory);
    assert.equal(rerun.applied.length, 0);
    const fixture = await seed(client);
    const first = fixture.lines.find((line) => line.room_id === fixture.rooms[0]);
    const second = fixture.lines.find((line) => line.room_id === fixture.rooms[1]);
    const future = fixture.lines.find((line) => line.room_id === fixture.rooms[2]);

    // Real date columns, active-line guards and complete initial BOOKED histories.
    await assert.rejects(checkInRoomLine(client, { lineId: future.line_id, actorId: fixture.staffId, schema }), /outside/);
    await checkInRoomLine(client, { lineId: first.line_id, actorId: fixture.staffId, schema });
    let states = (await client.query('SELECT line_id, status FROM booking_room_line WHERE booking_id = $1', [fixture.booking_id])).rows;
    assert.equal(states.find((line) => line.line_id === second.line_id).status, 'BOOKED');
    assert.equal((await client.query('SELECT count(*)::int AS count FROM room_status_history')).rows[0].count, 0);
    await assert.rejects(checkInRoomLine(client, { lineId: first.line_id, actorId: fixture.staffId, schema }), /Only BOOKED/);

    // A failed audit must roll back even with M2's deferred lifecycle guards enabled.
    await client.query(`CREATE FUNCTION reject_test_checkin_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.entity_name = 'booking_room_line' AND NEW.action = 'STATUS_CHANGE' THEN
        RAISE EXCEPTION 'forced check-in audit failure'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER reject_test_checkin_audit BEFORE INSERT ON audit_log FOR EACH ROW
      EXECUTE FUNCTION reject_test_checkin_audit();`);
    await assert.rejects(checkInRoomLine(client, { lineId: second.line_id, actorId: fixture.staffId, schema }), /forced check-in/);
    assert.equal((await client.query('SELECT status FROM booking_room_line WHERE line_id = $1', [second.line_id])).rows[0].status, 'BOOKED');
    assert.equal((await client.query('SELECT occupied_from FROM booking_room_assignment WHERE line_id = $1', [second.line_id])).rows[0].occupied_from, null);
    await client.query('DROP TRIGGER reject_test_checkin_audit ON audit_log');

    const db = require('../src/db');
    const previousQuery = db.pool.query;
    const previousConnect = db.pool.connect;
    db.pool.query = client.query.bind(client);
    db.pool.connect = async () => Object.assign(client, { release() {} });
    try {
      const { postCheckIn } = require('../src/controllers/checkInController');
      const { getActiveStay } = require('../src/controllers/activeStayController');
      const request = (userId, lineId) => ({ params: { bookingRef: fixture.booking_ref, lineId },
        user: { userId }, body: {}, headers: {} });
      const denied = response();
      await postCheckIn(request(fixture.otherStaffId, second.line_id), denied);
      assert.equal(denied.statusCode, 403);
      const spoofed = response();
      await postCheckIn({ params: request('', second.line_id).params, headers: { 'x-user-id': fixture.staffId }, body: {} }, spoofed);
      assert.equal(spoofed.statusCode, 401);
      const futureResponse = response();
      await postCheckIn({ ...request(fixture.staffId, future.line_id), body: { stayDate: fixture.tomorrow } }, futureResponse);
      assert.equal(futureResponse.statusCode, 409, 'client stayDate cannot spoof the hotel date');
      const checkedIn = response();
      await postCheckIn(request(fixture.staffId, second.line_id), checkedIn);
      assert.equal(checkedIn.statusCode, 200);
      const stays = response();
      await getActiveStay(request(fixture.staffId), stays);
      assert.equal(stays.statusCode, 200);
      assert.equal(stays.body.active_stays.length, 2);
      const crossBranch = response();
      await getActiveStay(request(fixture.otherStaffId), crossBranch);
      assert.equal(crossBranch.statusCode, 403);

      // Route factories must execute injected auth before their controllers.
      const { createCheckInRouter } = require('../src/routes/checkInRoutes');
      const app = express();
      app.use('/api', createCheckInRouter((_req, res) => res.status(401).json({ error: 'session required' })));
      const server = await new Promise((resolve) => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
      try {
        const result = await fetch(`http://127.0.0.1:${server.address().port}/api/bookings/${fixture.booking_ref}/lines/${second.line_id}/checkin`,
          { method: 'POST', headers: { 'x-user-id': fixture.staffId } });
        assert.equal(result.status, 401);
      } finally { await new Promise((resolve) => server.close(resolve)); }
    } finally {
      db.pool.query = previousQuery;
      db.pool.connect = previousConnect;
    }

    const serviceId = (await client.query("INSERT INTO service (name, category, current_price) VALUES ('Baseline laundry', 'Laundry', 50) RETURNING service_id")).rows[0].service_id;
    await client.query(`INSERT INTO service_usage (booking_id, booking_room_line_id, service_id, quantity, unit_price_snapshot, recorded_by)
      VALUES ($1, $2, $3, 1.25, 50, $4)`, [fixture.booking_id, first.line_id, serviceId, fixture.staffId]);
    await client.query('UPDATE service SET current_price = 75 WHERE service_id = $1', [serviceId]);
    assert.equal((await client.query('SELECT unit_price_snapshot FROM service_usage WHERE service_id = $1', [serviceId])).rows[0].unit_price_snapshot, '50.00');
    await assert.rejects(client.query(`INSERT INTO service_usage (booking_id, booking_room_line_id, service_id, quantity, unit_price_snapshot, recorded_by)
      VALUES ($1, $2, $3, 1, 75, $4)`, [fixture.booking_id, future.line_id, serviceId, fixture.staffId]), { code: '23514' });

    await client.query('SELECT fn_refresh_draft_invoice($1, $2)', [fixture.booking_id, fixture.staffId]);
    const balance = (await client.query('SELECT fn_outstanding_balance($1) AS balance', [fixture.booking_id])).rows[0].balance;
    await client.query("SELECT fn_record_payment($1, $2, 'PAYMENT', $3, 'CASH', 'BASELINE-PAY', 'SUCCESSFUL')",
      [fixture.booking_id, fixture.staffId, balance]);
    const checkout = (await client.query('SELECT * FROM fn_checkout_room_line($1, $2, $3)', [fixture.booking_id, first.line_id, fixture.staffId])).rows[0];
    assert.equal(checkout.room_condition, 'CLEANING');
    assert.equal(checkout.is_finalized, false);
    const history = (await client.query('SELECT old_status, new_status, reason FROM room_status_history WHERE room_id = $1', [first.room_id])).rows;
    assert.equal(history.length, 1);
    assert.equal(history[0].new_status, 'CLEANING');
    assert.ok(history[0].reason);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM pg_type WHERE typnamespace = $1::regnamespace AND typname = 'room_condition'", [schema])).rows[0].count, 0);
  });
});

test('M3 upgrades preserve existing mock IDs, snapshots, history and checkout hook', async () => {
  await withChain(true, async ({ client, schema, directory }) => {
    const fixture = await seed(client);
    const first = fixture.lines.find((line) => line.room_id === fixture.rooms[0]);
    await checkInRoomLine(client, { lineId: first.line_id, actorId: fixture.staffId, schema });
    const serviceId = (await client.query("INSERT INTO service (name, category, current_price) VALUES ('Existing service', 'Existing', 80) RETURNING service_id")).rows[0].service_id;
    const usageId = (await client.query(`INSERT INTO service_usage (booking_id, booking_room_line_id, service_id, quantity, unit_price_snapshot, recorded_by)
      VALUES ($1, $2, $3, 1.5, 75, $4) RETURNING usage_id`, [fixture.booking_id, first.line_id, serviceId, fixture.staffId])).rows[0].usage_id;
    const roomHistoryId = (await client.query(`INSERT INTO room_status_history (room_id, old_status, new_status, changed_by, reason)
      VALUES ($1, 'CLEANING', 'READY', $2, 'Existing evidence') RETURNING room_history_id`, [first.room_id, fixture.staffId])).rows[0].room_history_id;
    for (const name of upgrades) fs.copyFileSync(path.join(sourceDir, name), path.join(directory, name));
    const upgraded = await applyChain(client, directory);
    assert.deepEqual(upgraded.applied, upgrades);
    const usage = (await client.query('SELECT usage_id, service_id, quantity, unit_price_snapshot FROM service_usage WHERE usage_id = $1', [usageId])).rows[0];
    assert.deepEqual(usage, { usage_id: usageId, service_id: serviceId, quantity: '1.50', unit_price_snapshot: '75.00' });
    assert.equal((await client.query('SELECT reason FROM room_status_history WHERE room_history_id = $1', [roomHistoryId])).rows[0].reason, 'Existing evidence');
    assert.ok((await client.query("SELECT to_regprocedure('fn_set_room_condition(uuid,room_condition_enum,uuid,character varying)') AS hook")).rows[0].hook);
    await assert.rejects(client.query('DELETE FROM room_status_history WHERE room_history_id = $1', [roomHistoryId]), { code: '42501' });
    await assert.rejects(client.query("UPDATE service SET current_price = 'NaN' WHERE service_id = $1", [serviceId]), { code: '23514' });
    await assert.rejects(client.query('UPDATE service_usage SET voided = true WHERE usage_id = $1', [usageId]), { code: '23514' });
    for (const name of upgrades) await client.query(fs.readFileSync(path.join(sourceDir, name), 'utf8'));
    assert.equal((await client.query('SELECT count(*)::int AS count FROM service_usage')).rows[0].count, 1);
  });
});
