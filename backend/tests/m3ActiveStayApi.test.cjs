const assert = require('node:assert/strict');
const test = require('node:test');
const { Client } = require('pg');
const db = require('../src/db');

const ids = {
  branchOne: '11111111-1111-7111-8111-111111111111',
  branchTwo: '22222222-2222-7222-8222-222222222222',
  role: '33333333-3333-7333-8333-333333333333',
  staff: '44444444-4444-7444-8444-444444444444',
  otherStaff: '55555555-5555-7555-8555-555555555555',
  guest: '66666666-6666-7666-8666-666666666666',
  booking: '77777777-7777-7777-8777-777777777777',
  lineOne: '88888888-8888-7888-8888-888888888888',
  lineTwo: '99999999-9999-7999-8999-999999999999',
  futureLine: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
  roomOne: 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb',
  roomTwo: 'cccccccc-cccc-7ccc-8ccc-cccccccccccc',
  futureRoom: 'dddddddd-dddd-7ddd-8ddd-dddddddddddd',
  assignmentOne: 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee',
  assignmentTwo: 'ffffffff-ffff-7fff-8fff-ffffffffffff',
  futureAssignment: '10101010-1010-7101-8101-101010101010',
};

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

function requestFor(userId) {
  const headers = { 'x-user-id': userId };
  return {
    params: { bookingRef: 'BK-STAY-001' },
    headers, user: { userId },
    header(name) { return headers[name.toLowerCase()]; },
  };
}

async function withScratchSchema(run) {
  const client = new Client({ connectionString: process.env.PG_URL });
  const schema = `m3_active_stay_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  await client.connect();
  const previousQuery = db.pool.query;

  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`
      CREATE TABLE branch (branch_id uuid PRIMARY KEY, active boolean NOT NULL DEFAULT true);
      CREATE TABLE role (role_id uuid PRIMARY KEY, role_name text NOT NULL);
      CREATE TABLE user_account (user_id uuid PRIMARY KEY, active boolean NOT NULL DEFAULT true);
      CREATE TABLE officer (officer_id uuid PRIMARY KEY, branch_id uuid NOT NULL, role_id uuid NOT NULL);
      CREATE TABLE guest (guest_id uuid PRIMARY KEY);
      CREATE TABLE guest_account (guest_account_id uuid PRIMARY KEY, guest_id uuid NOT NULL, user_id uuid NOT NULL);
      CREATE TABLE booking (booking_id uuid PRIMARY KEY, booking_ref text NOT NULL UNIQUE, guest_id uuid NOT NULL, created_by uuid NOT NULL);
      CREATE TABLE booking_room_line (
        line_id uuid PRIMARY KEY, booking_id uuid NOT NULL, stay_start_date date NOT NULL,
        stay_end_date date NOT NULL, guest_count smallint NOT NULL, status text NOT NULL
      );
      CREATE TABLE room (room_id uuid PRIMARY KEY, branch_id uuid NOT NULL, room_number text NOT NULL);
      CREATE TABLE booking_room_assignment (
        assignment_id uuid PRIMARY KEY, line_id uuid NOT NULL, room_id uuid NOT NULL,
        unassigned_at timestamptz, occupied_from timestamptz, occupied_to timestamptz
      );
    `);
    await client.query('INSERT INTO branch (branch_id) VALUES ($1), ($2)', [ids.branchOne, ids.branchTwo]);
    await client.query('INSERT INTO role (role_id, role_name) VALUES ($1, $2)', [ids.role, 'FRONT_DESK']);
    await client.query('INSERT INTO user_account (user_id) VALUES ($1), ($2)', [ids.staff, ids.otherStaff]);
    await client.query(
      'INSERT INTO officer (officer_id, branch_id, role_id) VALUES ($1, $2, $3), ($4, $5, $3)',
      [ids.staff, ids.branchOne, ids.role, ids.otherStaff, ids.branchTwo],
    );
    await client.query('INSERT INTO guest (guest_id) VALUES ($1)', [ids.guest]);
    await client.query(
      'INSERT INTO booking (booking_id, booking_ref, guest_id, created_by) VALUES ($1, $2, $3, $4)',
      [ids.booking, 'BK-STAY-001', ids.guest, ids.staff],
    );
    await client.query(
      `INSERT INTO booking_room_line (line_id, booking_id, stay_start_date, stay_end_date, guest_count, status)
       VALUES ($1, $2, DATE '2026-10-01', DATE '2026-10-05', 2, 'CHECKED_IN'),
              ($3, $2, DATE '2026-10-01', DATE '2026-10-05', 1, 'CHECKED_IN'),
              ($4, $2, DATE '2026-12-01', DATE '2026-12-05', 1, 'BOOKED')`,
      [ids.lineOne, ids.booking, ids.lineTwo, ids.futureLine],
    );
    await client.query(
      `INSERT INTO room (room_id, branch_id, room_number)
       VALUES ($1, $4, '101'), ($2, $4, '102'), ($3, $4, '103')`,
      [ids.roomOne, ids.roomTwo, ids.futureRoom, ids.branchOne],
    );
    await client.query(
      `INSERT INTO booking_room_assignment (assignment_id, line_id, room_id, occupied_from)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP),
              ($4, $5, $6, CURRENT_TIMESTAMP),
              ($7, $8, $9, NULL)`,
      [ids.assignmentOne, ids.lineOne, ids.roomOne, ids.assignmentTwo, ids.lineTwo, ids.roomTwo, ids.futureAssignment, ids.futureLine, ids.futureRoom],
    );

    db.pool.query = client.query.bind(client);
    await run();
  } finally {
    db.pool.query = previousQuery;
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
}

test('M3-S08 returns each checked-in room and excludes future lines', async () => {
  await withScratchSchema(async () => {
    const { getActiveStay } = await import('../src/controllers/activeStayController.ts');
    const result = response();
    await getActiveStay(requestFor(ids.staff), result);

    assert.equal(result.statusCode, 200);
    assert.equal(result.body.booking_ref, 'BK-STAY-001');
    assert.deepEqual(result.body.active_stays.map((stay) => stay.room_number), ['101', '102']);
    assert.equal(result.body.active_stays.length, 2);
  });
});

test('M3-S08 rejects a staff actor from another branch', async () => {
  await withScratchSchema(async () => {
    const { getActiveStay } = await import('../src/controllers/activeStayController.ts');
    const result = response();
    await getActiveStay(requestFor(ids.otherStaff), result);

    assert.equal(result.statusCode, 403);
    assert.equal(result.body.error.code, 'STAY_ACCESS_DENIED');
  });
});