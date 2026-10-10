const assert = require('node:assert/strict');
const test = require('node:test');
const { Client } = require('pg');
const db = require('../src/db');

const ids = {
  branchOne: '11111111-1111-7111-8111-111111111111',
  branchTwo: '22222222-2222-7222-8222-222222222222',
  roleFrontDesk: '33333333-3333-7333-8333-333333333333',
  roleBranchManager: '44444444-4444-7444-8444-444444444444',
  roleServiceStaff: '55555555-5555-7555-8555-555555555555',
  manager: '66666666-6666-7666-8666-666666666666',
  otherManager: '77777777-7777-7777-8777-777777777777',
  serviceStaff: '88888888-8888-7888-8888-888888888888',
  guest: '99999999-9999-7999-8999-999999999999',
  booking: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
  line: 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb',
  room: 'cccccccc-cccc-7ccc-8ccc-cccccccccccc',
  assignment: 'dddddddd-dddd-7ddd-8ddd-dddddddddddd',
  service: 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee',
  invoice: 'ffffffff-ffff-7fff-8fff-ffffffffffff',
};

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

function requestFor(userId, usageId, body = {}, bookingRef = 'BK-VOID-001') {
  return {
    params: { bookingRef, usageId },
    user: { userId },
    body,
  };
}

async function withScratchSchema(run) {
  const client = new Client({ connectionString: process.env.PG_URL });
  const schema = `m3_void_api_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
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
        assignment_id uuid PRIMARY KEY, line_id uuid NOT NULL, room_id uuid NOT NULL, unassigned_at timestamptz
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
      CREATE TABLE audit_log (
        audit_id uuid DEFAULT uuidv7(), entity_name text NOT NULL, entity_id text NOT NULL,
        action text NOT NULL, before_value text, after_value text, changed_at timestamptz NOT NULL, user_id uuid
      );
      CREATE TABLE refresh_calls (booking_id uuid NOT NULL, user_id uuid NOT NULL);
      CREATE TABLE invoice_charges (booking_id uuid NOT NULL, service_charge numeric(14,2) NOT NULL DEFAULT 0);
      CREATE OR REPLACE FUNCTION fn_refresh_draft_invoice(
        p_booking_id uuid, p_user_id uuid DEFAULT NULL, p_approved_discount numeric DEFAULT 0.00
      ) RETURNS uuid LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO refresh_calls (booking_id, user_id) VALUES (p_booking_id, p_user_id);
        -- Member 4 billing excludes voided usage when rebuilding DRAFT lines.
        INSERT INTO invoice_charges (booking_id, service_charge)
        SELECT p_booking_id, COALESCE(SUM(ROUND(quantity * unit_price_snapshot, 2)), 0)
          FROM service_usage WHERE booking_id = p_booking_id AND voided IS FALSE;
        RETURN (SELECT invoice_id FROM invoice WHERE booking_id = p_booking_id);
      END;
      $$;
      CREATE OR REPLACE FUNCTION fn_booking_balance(p_booking_id uuid)
      RETURNS TABLE (
        invoice_id uuid, status invoice_status_enum, total_amount numeric(14,2),
        successful_payments numeric(14,2), successful_refunds numeric(14,2),
        net_paid numeric(14,2), balance numeric(14,2), is_settled boolean
      ) LANGUAGE plpgsql STABLE AS $$
      DECLARE
        v_total numeric(14,2);
        v_paid numeric(14,2) := 1000.00;
      BEGIN
        SELECT COALESCE(SUM(service_charge), 0) INTO v_total FROM invoice_charges WHERE booking_id = p_booking_id;
        SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM payments WHERE booking_id = p_booking_id;
        invoice_id := (SELECT i.invoice_id FROM invoice i WHERE i.booking_id = p_booking_id);
        status := (SELECT i.status FROM invoice i WHERE i.booking_id = p_booking_id);
        total_amount := v_total;
        successful_payments := v_paid;
        successful_refunds := 0.00;
        net_paid := v_paid;
        balance := v_total - v_paid;
        is_settled := (v_total - v_paid) = 0;
        RETURN NEXT;
      END;
      $$;
      CREATE TABLE payments (booking_id uuid NOT NULL, amount numeric(14,2) NOT NULL);
    `);
    await client.query('INSERT INTO branch (branch_id) VALUES ($1), ($2)', [ids.branchOne, ids.branchTwo]);
    await client.query(
      'INSERT INTO role (role_id, role_name) VALUES ($1, $2), ($3, $4), ($5, $6)',
      [ids.roleFrontDesk, 'FRONT_DESK', ids.roleBranchManager, 'BRANCH_MANAGER', ids.roleServiceStaff, 'SERVICE_STAFF'],
    );
    await client.query(
      'INSERT INTO user_account (user_id) VALUES ($1), ($2), ($3), ($4)',
      [ids.manager, ids.otherManager, ids.serviceStaff, ids.guest],
    );
    await client.query(
      'INSERT INTO officer (officer_id, branch_id, role_id) VALUES ($1, $2, $3), ($4, $5, $3), ($6, $7, $8)',
      [ids.manager, ids.branchOne, ids.roleBranchManager, ids.otherManager, ids.branchTwo,
        ids.serviceStaff, ids.branchOne, ids.roleServiceStaff],
    );
    await client.query('INSERT INTO guest (guest_id) VALUES ($1)', [ids.guest]);
    await client.query(
      'INSERT INTO booking (booking_id, booking_ref, guest_id, created_by) VALUES ($1, $2, $3, $4)',
      [ids.booking, 'BK-VOID-001', ids.guest, ids.manager],
    );
    await client.query(
      'INSERT INTO booking_room_line (line_id, booking_id, status) VALUES ($1, $2, $3)',
      [ids.line, ids.booking, 'CHECKED_IN'],
    );
    await client.query('INSERT INTO room (room_id, branch_id, room_number) VALUES ($1, $2, $3)', [ids.room, ids.branchOne, '301']);
    await client.query(
      'INSERT INTO booking_room_assignment (assignment_id, line_id, room_id) VALUES ($1, $2, $3)',
      [ids.assignment, ids.line, ids.room],
    );
    await client.query(
      'INSERT INTO service (service_id, name, category, current_price, active) VALUES ($1, $2, $3, $4, true)',
      [ids.service, 'Spa', 'Wellness', 400],
    );
    await client.query('INSERT INTO invoice (invoice_id, booking_id, status) VALUES ($1, $2, $3)', [ids.invoice, ids.booking, 'DRAFT']);
    await client.query('INSERT INTO payments (booking_id, amount) VALUES ($1, 1000)', [ids.booking]);
    const usageId = (await client.query(
      `INSERT INTO service_usage (booking_id, service_id, booking_room_line_id, used_at, quantity, unit_price_snapshot, recorded_by)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP, 2, 400, $4) RETURNING usage_id`,
      [ids.booking, ids.service, ids.line, ids.serviceStaff],
    )).rows[0].usage_id;

    db.pool.query = client.query.bind(client);
    client.release = () => undefined;
    db.pool.connect = async () => client;
    await run({ client, usageId });
  } finally {
    db.pool.query = previousQuery;
    db.pool.connect = previousConnect;
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
}

test('M3-S11 voids own-branch usage, keeps the original row and refreshes billing', async () => {
  await withScratchSchema(async ({ client, usageId }) => {
    const { voidUsage, listUsage } = await import('../src/controllers/serviceUsageController.ts');
    const original = (await client.query(
      'SELECT quantity, unit_price_snapshot, used_at, recorded_at, recorded_by FROM service_usage WHERE usage_id = $1',
      [usageId],
    )).rows[0];

    const voided = response();
    await voidUsage(requestFor(ids.manager, usageId, { reason: 'Wrong room charged' }), voided);
    assert.equal(voided.statusCode, 200, JSON.stringify(voided.body));
    assert.equal(voided.body.voided, true);
    assert.equal(voided.body.voided_amount, '800.00');
    assert.equal(voided.body.voided_by, ids.manager);
    assert.equal(voided.body.invoice_id, ids.invoice);
    assert.deepEqual(voided.body.billing, {
      totalAmount: '0', netPaid: '1000', balance: '-1000', isCredit: true, creditAmount: '1000',
    });

    const after = (await client.query(
      'SELECT voided, voided_at, voided_by, quantity, unit_price_snapshot, used_at, recorded_at, recorded_by FROM service_usage WHERE usage_id = $1',
      [usageId],
    )).rows[0];
    assert.equal(after.voided, true);
    assert.ok(after.voided_at);
    assert.equal(after.voided_by, ids.manager);
    assert.deepEqual(
      { quantity: after.quantity, unit_price_snapshot: after.unit_price_snapshot, used_at: after.used_at,
        recorded_at: after.recorded_at, recorded_by: after.recorded_by },
      original,
      'the original charge, recording actor and timestamps are preserved',
    );

    const audit = (await client.query(
      'SELECT action, entity_name, entity_id, user_id FROM audit_log WHERE entity_id = $1',
      [usageId],
    )).rows;
    assert.equal(audit.length, 1);
    assert.equal(audit[0].action, 'VOID');
    assert.equal(audit[0].entity_name, 'service_usage');
    assert.equal(audit[0].user_id, ids.manager);

    // The retained voided row is still listed for reporting, flagged as voided.
    const listed = response();
    await listUsage(requestFor(ids.serviceStaff, usageId), listed);
    assert.equal(listed.statusCode, 200);
    assert.equal(listed.body.usage[0].voided, true);
    assert.equal(listed.body.usage[0].voided_by, ids.manager);

    // A repeated void is rejected and leaves exactly one reversal.
    const repeated = response();
    await voidUsage(requestFor(ids.manager, usageId), repeated);
    assert.equal(repeated.statusCode, 409);
    assert.equal(repeated.body.error.code, 'USAGE_ALREADY_VOIDED');
    assert.equal((await client.query('SELECT count(*)::int AS count FROM audit_log')).rows[0].count, 1);
  });
});

test('M3-S11 rejects unauthorized reversals, wrong bookings and FINAL invoices', async () => {
  await withScratchSchema(async ({ client, usageId }) => {
    const { voidUsage } = await import('../src/controllers/serviceUsageController.ts');

    const anonymous = response();
    await voidUsage({ params: requestFor('', usageId).params, body: {} }, anonymous);
    assert.equal(anonymous.statusCode, 401);

    const recorder = response();
    await voidUsage(requestFor(ids.serviceStaff, usageId), recorder);
    assert.equal(recorder.statusCode, 403);
    assert.equal(recorder.body.error.code, 'VOID_ACCESS_DENIED');

    const crossBranch = response();
    await voidUsage(requestFor(ids.otherManager, usageId), crossBranch);
    assert.equal(crossBranch.statusCode, 403);
    assert.equal((await client.query('SELECT voided FROM service_usage WHERE usage_id = $1', [usageId])).rows[0].voided, false);
    assert.equal((await client.query('SELECT count(*)::int AS count FROM audit_log')).rows[0].count, 0);

    const wrongBooking = response();
    await voidUsage({ ...requestFor(ids.manager, usageId), params: { bookingRef: 'BK-OTHER', usageId } }, wrongBooking);
    assert.equal(wrongBooking.statusCode, 404);

    const missing = response();
    await voidUsage(requestFor(ids.manager, '11111111-2222-7333-8444-555555555555'), missing);
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.body.error.code, 'USAGE_NOT_FOUND');

    await client.query("UPDATE invoice SET status = 'FINAL' WHERE invoice_id = $1", [ids.invoice]);
    const finalInvoice = response();
    await voidUsage(requestFor(ids.manager, usageId), finalInvoice);
    assert.equal(finalInvoice.statusCode, 409);
    assert.equal(finalInvoice.body.error.code, 'INVOICE_FINAL');
    assert.equal((await client.query('SELECT voided FROM service_usage WHERE usage_id = $1', [usageId])).rows[0].voided, false);
    assert.equal((await client.query('SELECT count(*)::int AS count FROM refresh_calls')).rows[0].count, 0);
  });
});