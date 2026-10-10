const assert = require('node:assert/strict');
const test = require('node:test');
const { Client } = require('pg');
const db = require('../src/db');

const ids = {
  branchOne: '11111111-1111-7111-8111-111111111111',
  branchTwo: '22222222-2222-7222-8222-222222222222',
  roleFrontDesk: '33333333-3333-7333-8333-333333333333',
  roleServiceStaff: '44444444-4444-7444-8444-444444444444',
  staff: '55555555-5555-7555-8555-555555555555',
  otherStaff: '66666666-6666-7666-8666-666666666666',
  guest: '77777777-7777-7777-8777-777777777777',
  booking: '88888888-8888-7888-8888-888888888888',
  line: '99999999-9999-7999-8999-999999999999',
  room: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
  assignment: 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb',
  service: 'cccccccc-cccc-7ccc-8ccc-cccccccccccc',
  invoice: 'dddddddd-dddd-7ddd-8ddd-dddddddddddd',
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
  return {
    params: { bookingRef: 'BK-USAGE-001' },
    user: { userId },
    body,
  };
}

async function withScratchSchema(run) {
  const client = new Client({ connectionString: process.env.PG_URL });
  const schema = `m3_usage_api_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
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
      CREATE TABLE officer (officer_id uuid PRIMARY KEY, branch_id uuid NOT NULL, role_id uuid NOT NULL, active boolean NOT NULL DEFAULT true);
      CREATE TABLE guest (guest_id uuid PRIMARY KEY);
      CREATE TABLE booking (booking_id uuid PRIMARY KEY, booking_ref text NOT NULL UNIQUE, guest_id uuid NOT NULL, created_by uuid NOT NULL);
      CREATE TABLE booking_room_line (line_id uuid PRIMARY KEY, booking_id uuid NOT NULL, status text NOT NULL);
      CREATE TABLE room (room_id uuid PRIMARY KEY, branch_id uuid NOT NULL, room_number text NOT NULL);
      CREATE TABLE booking_room_assignment (
        assignment_id uuid PRIMARY KEY, line_id uuid NOT NULL, room_id uuid NOT NULL,
        unassigned_at timestamptz, occupied_from timestamptz, occupied_to timestamptz
      );
      CREATE TABLE service (service_id uuid PRIMARY KEY, name text NOT NULL, category text NOT NULL, current_price numeric(12,2) NOT NULL, active boolean NOT NULL);
      CREATE TYPE invoice_status_enum AS ENUM ('DRAFT', 'FINAL');
      CREATE TABLE invoice (invoice_id uuid PRIMARY KEY, booking_id uuid NOT NULL, status invoice_status_enum NOT NULL);
      CREATE TABLE service_usage (
        usage_id uuid PRIMARY KEY DEFAULT uuidv7(), booking_id uuid NOT NULL, service_id uuid NOT NULL,
        booking_room_line_id uuid, used_at timestamptz NOT NULL, quantity numeric(10,2) NOT NULL,
        unit_price_snapshot numeric(12,2) NOT NULL, voided boolean NOT NULL DEFAULT false,
        voided_at timestamptz, recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        recorded_by uuid NOT NULL, voided_by uuid
      );
      CREATE TABLE refresh_calls (booking_id uuid NOT NULL, user_id uuid NOT NULL);
      CREATE OR REPLACE FUNCTION fn_refresh_draft_invoice(
        p_booking_id uuid, p_user_id uuid DEFAULT NULL, p_approved_discount numeric DEFAULT 0.00
      ) RETURNS uuid LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO refresh_calls (booking_id, user_id) VALUES (p_booking_id, p_user_id);
        RETURN (SELECT invoice_id FROM invoice WHERE booking_id = p_booking_id);
      END;
      $$;
    `);
    await client.query('INSERT INTO branch (branch_id) VALUES ($1), ($2)', [ids.branchOne, ids.branchTwo]);
    await client.query(
      'INSERT INTO role (role_id, role_name) VALUES ($1, $2), ($3, $4)',
      [ids.roleFrontDesk, 'FRONT_DESK', ids.roleServiceStaff, 'SERVICE_STAFF'],
    );
    await client.query('INSERT INTO user_account (user_id) VALUES ($1), ($2)', [ids.staff, ids.otherStaff]);
    await client.query(
      'INSERT INTO officer (officer_id, branch_id, role_id) VALUES ($1, $2, $3), ($4, $5, $3)',
      [ids.staff, ids.branchOne, ids.roleServiceStaff, ids.otherStaff, ids.branchTwo],
    );
    await client.query('INSERT INTO guest (guest_id) VALUES ($1)', [ids.guest]);
    await client.query(
      'INSERT INTO booking (booking_id, booking_ref, guest_id, created_by) VALUES ($1, $2, $3, $4)',
      [ids.booking, 'BK-USAGE-001', ids.guest, ids.staff],
    );
    await client.query('INSERT INTO booking_room_line (line_id, booking_id, status) VALUES ($1, $2, $3)', [ids.line, ids.booking, 'CHECKED_IN']);
    await client.query('INSERT INTO room (room_id, branch_id, room_number) VALUES ($1, $2, $3)', [ids.room, ids.branchOne, '201']);
    await client.query('INSERT INTO booking_room_assignment (assignment_id, line_id, room_id, occupied_from) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)', [ids.assignment, ids.line, ids.room]);
    await client.query('INSERT INTO service (service_id, name, category, current_price, active) VALUES ($1, $2, $3, $4, true)', [ids.service, 'Laundry', 'Housekeeping', 900]);
    await client.query('INSERT INTO invoice (invoice_id, booking_id, status) VALUES ($1, $2, $3)', [ids.invoice, ids.booking, 'DRAFT']);

    db.pool.query = client.query.bind(client);
    client.release = () => undefined;
    db.pool.connect = async () => client;
    await run({ client, schema });
  } finally {
    db.pool.query = previousQuery;
    db.pool.connect = previousConnect;
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
}

test('M3-S10 records and lists own-branch usage with server price snapshot', async () => {
  await withScratchSchema(async ({ client }) => {
    const { recordUsage, listUsage } = await import('../src/controllers/serviceUsageController.ts');
    const authorization = await client.query(
      `SELECT role.role_name, officer.branch_id
         FROM officer
         JOIN role ON role.role_id = officer.role_id
         JOIN user_account ON user_account.user_id = officer.officer_id
        WHERE officer.officer_id = $1 AND officer.active AND user_account.active`,
      [ids.staff],
    );
    assert.deepEqual(authorization.rows, [{ role_name: 'SERVICE_STAFF', branch_id: ids.branchOne }]);
    const bookingBranch = await client.query(
      `SELECT booking.booking_id, room.branch_id
         FROM booking
         JOIN booking_room_line AS line ON line.booking_id = booking.booking_id
         JOIN booking_room_assignment AS assignment
           ON assignment.line_id = line.line_id AND assignment.unassigned_at IS NULL
         JOIN room ON room.room_id = assignment.room_id
        WHERE booking.booking_ref = $1
        LIMIT 1`,
      ['BK-USAGE-001'],
    );
    assert.deepEqual(bookingBranch.rows, [{ booking_id: ids.booking, branch_id: ids.branchOne }]);
    const created = response();
    await recordUsage(requestFor(ids.staff, {
      serviceId: ids.service,
      quantity: 2,
      bookingRoomLineId: ids.line,
      unitPriceSnapshot: 1,
    }), created);

    assert.equal(created.statusCode, 201, JSON.stringify(created.body));
    assert.equal(created.body.unit_price_snapshot, '900.00');
    assert.equal(created.body.booking_room_line_id, ids.line);

    const listed = response();
    await listUsage(requestFor(ids.staff), listed);
    assert.equal(listed.statusCode, 200);
    assert.equal(listed.body.usage.length, 1);
    assert.equal(listed.body.usage[0].amount, '1800.00');
  });
});

test('M3-S10 rejects cross-branch staff and invalid quantities', async () => {
  await withScratchSchema(async () => {
    const { recordUsage } = await import('../src/controllers/serviceUsageController.ts');
    const crossBranch = response();
    await recordUsage(requestFor(ids.otherStaff, { serviceId: ids.service, quantity: 1 }), crossBranch);
    assert.equal(crossBranch.statusCode, 403);
    assert.equal(crossBranch.body.error.code, 'USAGE_ACCESS_DENIED');

    const invalidQuantity = response();
    await recordUsage(requestFor(ids.staff, { serviceId: ids.service, quantity: 0 }), invalidQuantity);
    assert.equal(invalidQuantity.statusCode, 400);
    assert.equal(invalidQuantity.body.error.code, 'INVALID_QUANTITY');
  });
});