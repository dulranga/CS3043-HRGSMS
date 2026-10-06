// M3-S18 API surface on the clean numbered chain: the controller reached only
// through a verified req.user actor, and the route factory that keeps Member 1's
// session authorization in front of it. Same scratch-schema isolation as the
// service suite; nothing is written outside the temporary schema.
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { Client } = require('pg');
const express = require('express');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { loadMigrations } = require('../src/migrations/migrate');
const db = require('../src/db');

const sourceDir = path.join(__dirname, '..', 'migrations');
const connectionString = process.env.PG_TEST_URL || process.env.PG_URL;
const chainExclusions = ['m5_002_create_audit_indexes.sql', 'm5_003_seed_config_values.sql'];

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

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

function requestFor(userId, roomId, body = {}) {
  const headers = { 'x-user-id': userId };
  return { params: { roomId }, headers, user: { userId }, body, header: (name) => headers[name.toLowerCase()] };
}

async function withChain(run) {
  const schema = `m3_condition_api_${randomBytes(8).toString('hex')}`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'skynest-m3-condition-api-'));
  const numbered = fs.readdirSync(sourceDir)
    .filter((name) => /^(?:m\d+_)?\d+_.+\.sql$/.test(name) && !chainExclusions.includes(name));
  const client = new Client({ connectionString });
  for (const name of numbered) fs.copyFileSync(path.join(sourceDir, name), path.join(directory, name));
  await client.connect();
  const previousQuery = db.pool.query;
  const previousConnect = db.pool.connect;
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    isolateClient(client, schema);
    const applied = await applyChain(client, directory);
    assert.equal(applied.applied.length, numbered.length);
    const fixture = await seed(client);
    db.pool.query = client.query.bind(client);
    client.release = () => undefined;
    db.pool.connect = async () => client;
    await run({ client, schema, fixture });
  } finally {
    db.pool.query = previousQuery;
    db.pool.connect = previousConnect;
    await client.query('ROLLBACK');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function seed(client) {
  const branches = (await client.query('SELECT branch_id FROM branch ORDER BY branch_id LIMIT 2')).rows;
  const roles = (await client.query('SELECT role_name, role_id FROM role')).rows;
  const branchId = branches[0].branch_id;
  const otherBranchId = branches[1].branch_id;

  async function officer(username, roleName, ownerBranchId) {
    const userId = (await client.query('INSERT INTO user_account (username) VALUES ($1) RETURNING user_id', [username])).rows[0].user_id;
    const roleId = roles.find((role) => role.role_name === roleName).role_id;
    await client.query('INSERT INTO officer (officer_id, full_name, role_id, branch_id) VALUES ($1, $2, $3, $4)',
      [userId, username, roleId, ownerBranchId]);
    return userId;
  }

  const frontDeskId = await officer('api.frontdesk', 'FRONT_DESK', branchId);
  const serviceStaffId = await officer('api.service', 'SERVICE_STAFF', branchId);
  const branchManagerId = await officer('api.manager', 'BRANCH_MANAGER', branchId);
  const otherServiceStaffId = await officer('api.otherservice', 'SERVICE_STAFF', otherBranchId);
  const chainManagerId = await officer('api.chain', 'CHAIN_MANAGER', branchId);
  const typeId = (await client.query("INSERT INTO room_type (name, capacity, base_daily_rate) VALUES ('Api condition type', 2, 100) RETURNING room_type_id")).rows[0].room_type_id;
  const freeRoomId = (await client.query('INSERT INTO room (room_number, branch_id, room_type_id) VALUES ($1, $2, $3) RETURNING room_id',
    ['801', branchId, typeId])).rows[0].room_id;
  const busyRoomId = (await client.query('INSERT INTO room (room_number, branch_id, room_type_id) VALUES ($1, $2, $3) RETURNING room_id',
    ['802', branchId, typeId])).rows[0].room_id;

  // One BOOKED line keeps the second room reserved for the conflict case.
  const policyId = (await client.query(`INSERT INTO billing_policy
    (effective_from, tax_percent, service_charge_percent, max_discount_percent,
     cancellation_fee, no_show_fee, late_checkout_fee, no_show_grace_days, is_demo, created_by)
    VALUES ('2020-01-01', 0, 0, 0, 0, 0, 0, 1, false, $1) RETURNING billing_policy_id`, [chainManagerId])).rows[0].billing_policy_id;
  const dates = (await client.query(`SELECT to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::date, 'YYYY-MM-DD') AS today,
      to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::date + 4, 'YYYY-MM-DD') AS end`)).rows[0];
  const guestId = (await client.query("INSERT INTO guest (full_name) VALUES ('Api condition guest') RETURNING guest_id")).rows[0].guest_id;
  await client.query('BEGIN');
  await client.query('SELECT * FROM sp_create_booking($1::uuid, $2::booking_channel_enum, $3::uuid, $4::uuid, $5::uuid, $6::jsonb)',
    [guestId, 'FRONT_DESK', frontDeskId, branchId, policyId,
      JSON.stringify([{ roomId: busyRoomId, checkIn: dates.today, checkOut: dates.end, guestCount: 1, quotedRoomTypeId: typeId, quotedBaseDailyRate: '100.00' }])]);
  await client.query('COMMIT');

  return { branchId, frontDeskId, serviceStaffId, branchManagerId, otherServiceStaffId, chainManagerId, freeRoomId, busyRoomId };
}

test('M3-S18 API changes condition for own-branch staff and refuses everyone else', async () => {
  await withChain(async ({ fixture }) => {
    const { patchRoomCondition } = await import('../src/controllers/roomConditionController.ts');

    const changed = response();
    await patchRoomCondition(requestFor(fixture.serviceStaffId, fixture.freeRoomId, { condition: 'CLEANING', reason: 'Housekeeping started' }), changed);
    assert.equal(changed.statusCode, 200);
    assert.equal(changed.body.condition, 'CLEANING');
    assert.equal(changed.body.previous_condition, 'READY');
    assert.equal(changed.body.changed, true);
    assert.ok(changed.body.history_id);
    assert.equal(changed.body.room_number, '801');

    // A repeated value answers 200 with changed:false and no new history row.
    const repeated = response();
    await patchRoomCondition(requestFor(fixture.branchManagerId, fixture.freeRoomId, { condition: 'cleaning' }), repeated);
    assert.equal(repeated.statusCode, 200);
    assert.equal(repeated.body.changed, false);
    assert.equal(repeated.body.history_id, null);

    for (const [label, userId] of [
      ['FRONT_DESK', fixture.frontDeskId],
      ['CHAIN_MANAGER', fixture.chainManagerId],
      ['other-branch SERVICE_STAFF', fixture.otherServiceStaffId],
    ]) {
      const denied = response();
      await patchRoomCondition(requestFor(userId, fixture.freeRoomId, { condition: 'READY' }), denied);
      assert.equal(denied.statusCode, 403, `${label} must be refused`);
      assert.equal(denied.body.error.code, 'ROOM_CONDITION_ACCESS_DENIED');
    }

    // Headers are never proof of identity, and stored labels stay physical.
    const spoofed = response();
    await patchRoomCondition({ params: { roomId: fixture.freeRoomId }, headers: { 'x-user-id': fixture.serviceStaffId }, body: { condition: 'READY' } }, spoofed);
    assert.equal(spoofed.statusCode, 401);
    assert.equal(spoofed.body.error.code, 'AUTHENTICATION_REQUIRED');

    for (const condition of ['AVAILABLE', 'OCCUPIED', '']) {
      const invalid = response();
      await patchRoomCondition(requestFor(fixture.serviceStaffId, fixture.freeRoomId, { condition }), invalid);
      assert.equal(invalid.statusCode, 400);
      assert.equal(invalid.body.error.code, 'INVALID_ROOM_CONDITION_INPUT');
    }

    const missing = response();
    await patchRoomCondition(requestFor(fixture.serviceStaffId, randomUUID(), { condition: 'READY' }), missing);
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.body.error.code, 'ROOM_NOT_FOUND');

    // An active reservation still blocks an extended outage.
    const conflict = response();
    await patchRoomCondition(requestFor(fixture.serviceStaffId, fixture.busyRoomId, { condition: 'OUT_OF_SERVICE' }), conflict);
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.body.error.code, 'ROOM_CONDITION_CONFLICT');
  });
});

test('M3-S18 route factory keeps injected session authorization in front of the controller', async () => {
  await withChain(async ({ fixture }) => {
    const { createRoomConditionRouter } = await import('../src/routes/roomConditionRoutes.ts');

    const deniedApp = express();
    deniedApp.use(express.json());
    deniedApp.use('/api', createRoomConditionRouter((_req, res) => res.status(401).json({ error: { code: 'AUTHENTICATION_REQUIRED', message: 'session required' } })));
    const deniedServer = await new Promise((resolve) => { const listening = deniedApp.listen(0, '127.0.0.1', () => resolve(listening)); });
    let refused;
    try {
      refused = await fetch(`http://127.0.0.1:${deniedServer.address().port}/api/rooms/${fixture.freeRoomId}/condition`, {
        method: 'PATCH', headers: { 'content-type': 'application/json', 'x-user-id': fixture.serviceStaffId },
        body: JSON.stringify({ condition: 'CLEANING' }),
      });
    } finally {
      await new Promise((resolve) => deniedServer.close(resolve));
    }
    assert.equal(refused.status, 401);

    // Member 1 supplies req.user from the session; the operation still decides.
    const app = express();
    app.use(express.json());
    app.use('/api', createRoomConditionRouter((req, _res, next) => {
      const userId = String(req.get('x-user-id') || '');
      if (!userId) {
        req.user = undefined;
        return next();
      }
      req.user = { userId };
      return next();
    }));
    const server = await new Promise((resolve) => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
    try {
      const url = `http://127.0.0.1:${server.address().port}/api/rooms/${fixture.freeRoomId}/condition`;
      const accepted = await fetch(url, {
        method: 'PATCH', headers: { 'content-type': 'application/json', 'x-user-id': fixture.serviceStaffId },
        body: JSON.stringify({ condition: 'CLEANING' }),
      });
      assert.equal(accepted.status, 200);
      assert.equal((await accepted.json()).condition, 'CLEANING');

      const forbidden = await fetch(url, {
        method: 'PATCH', headers: { 'content-type': 'application/json', 'x-user-id': fixture.frontDeskId },
        body: JSON.stringify({ condition: 'READY' }),
      });
      assert.equal(forbidden.status, 403);
      assert.equal((await forbidden.json()).error.code, 'ROOM_CONDITION_ACCESS_DENIED');

      const anonymous = await fetch(url, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ condition: 'READY' }),
      });
      assert.equal(anonymous.status, 401);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});