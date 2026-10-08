const assert = require('node:assert/strict');
const test = require('node:test');
const { Client } = require('pg');
const db = require('../src/db');

const ids = {
  mainBranch: '11111111-1111-7111-8111-111111111111',
  otherBranch: '22222222-2222-7222-8222-222222222222',
  frontDesk: '33333333-3333-7333-8333-333333333333',
  otherFrontDesk: '44444444-4444-7444-8444-444444444444',
  role: '55555555-5555-7555-8555-555555555555',
  booking: '66666666-6666-7666-8666-666666666666',
  line: '77777777-7777-7777-8777-777777777777',
  room: '88888888-8888-7888-8888-888888888888',
  assignment: '99999999-9999-7999-8999-999999999999',
};

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

function requestFor(userId, body = {}) {
  const headers = { 'x-user-id': userId };
  return {
    params: { bookingRef: 'BK-API-001', lineId: ids.line },
    headers, user: { userId },
    body,
    header(name) {
      return headers[name.toLowerCase()];
    },
  };
}

async function withScratchSchema(run) {
  const client = new Client({ connectionString: process.env.PG_URL });
  const schema = `m3_check_in_api_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  await client.connect();
  const previousQuery = db.pool.query;
  const previousConnect = db.pool.connect;

  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`
      CREATE TABLE branch (branch_id uuid PRIMARY KEY, active boolean NOT NULL DEFAULT true);
      CREATE TABLE role (role_id uuid PRIMARY KEY, role_name text NOT NULL);
      CREATE TABLE user_account (user_id uuid PRIMARY KEY, active boolean NOT NULL DEFAULT true);
      CREATE TABLE officer (officer_id uuid PRIMARY KEY, branch_id uuid NOT NULL, role_id uuid NOT NULL);
      CREATE TABLE booking (booking_id uuid PRIMARY KEY, booking_ref text NOT NULL UNIQUE);
      CREATE TABLE booking_room_line (
        line_id uuid PRIMARY KEY,
        booking_id uuid NOT NULL,
        stay_start_date date NOT NULL,
        stay_end_date date NOT NULL,
        status text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE room (room_id uuid PRIMARY KEY, branch_id uuid NOT NULL, operational_status text NOT NULL);
      CREATE TABLE booking_room_assignment (
        assignment_id uuid PRIMARY KEY,
        line_id uuid NOT NULL,
        room_id uuid NOT NULL,
        unassigned_at timestamptz,
        occupied_from timestamptz,
        occupied_to timestamptz
      );
      CREATE TABLE booking_room_line_status_history (
        history_id uuid DEFAULT uuidv7(), line_id uuid NOT NULL, old_status text,
        new_status text NOT NULL, changed_at timestamptz NOT NULL, changed_by uuid NOT NULL, reason text NOT NULL
      );
      CREATE TABLE audit_log (
        audit_id uuid DEFAULT uuidv7(), entity_name text NOT NULL, entity_id text NOT NULL,
        action text NOT NULL, before_value text, after_value text, changed_at timestamptz NOT NULL, user_id uuid
      );
    `);
    await client.query('INSERT INTO branch (branch_id) VALUES ($1), ($2)', [ids.mainBranch, ids.otherBranch]);
    await client.query('INSERT INTO role (role_id, role_name) VALUES ($1, $2)', [ids.role, 'FRONT_DESK']);
    await client.query('INSERT INTO user_account (user_id) VALUES ($1), ($2)', [ids.frontDesk, ids.otherFrontDesk]);
    await client.query(
      'INSERT INTO officer (officer_id, branch_id, role_id) VALUES ($1, $2, $3), ($4, $5, $3)',
      [ids.frontDesk, ids.mainBranch, ids.role, ids.otherFrontDesk, ids.otherBranch],
    );
    await client.query('INSERT INTO booking (booking_id, booking_ref) VALUES ($1, $2)', [ids.booking, 'BK-API-001']);
    await client.query(
      `INSERT INTO booking_room_line (line_id, booking_id, stay_start_date, stay_end_date, status)
       VALUES ($1, $2, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::date, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::date + 3, 'BOOKED')`,
      [ids.line, ids.booking],
    );
    await client.query(
      'INSERT INTO room (room_id, branch_id, operational_status) VALUES ($1, $2, $3)',
      [ids.room, ids.mainBranch, 'READY'],
    );
    await client.query(
      'INSERT INTO booking_room_assignment (assignment_id, line_id, room_id) VALUES ($1, $2, $3)',
      [ids.assignment, ids.line, ids.room],
    );

    db.pool.query = client.query.bind(client);
    client.release = () => undefined;
    db.pool.connect = async () => client;
    await run({ schema });
  } finally {
    db.pool.query = previousQuery;
    db.pool.connect = previousConnect;
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
}

test('M3-S07 checks in an authorized same-branch line and rejects repeats', async () => {
  await withScratchSchema(async ({ schema }) => {
    const { postCheckIn } = await import('../src/controllers/checkInController.ts');
    const request = requestFor(ids.frontDesk);

    const success = response();
    await postCheckIn(request, success);
    assert.equal(success.statusCode, 200);
    assert.equal(success.body.line_id, ids.line);

    const repeated = response();
    await postCheckIn(requestFor(ids.frontDesk, { stayDate: '2026-10-04' }), repeated);
    assert.equal(repeated.statusCode, 409);
    assert.equal(repeated.body.error.code, 'INVALID_CHECK_IN_STATE');
  });
});

test('M3-S07 rejects a branch-scoped staff actor from another branch', async () => {
  await withScratchSchema(async () => {
    const { postCheckIn } = await import('../src/controllers/checkInController.ts');
    const denied = response();
    await postCheckIn(requestFor(ids.otherFrontDesk), denied);

    assert.equal(denied.statusCode, 403);
    assert.equal(denied.body.error.code, 'BRANCH_ACCESS_DENIED');
  });
});