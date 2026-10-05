const assert = require('node:assert/strict');
const test = require('node:test');
const { Client } = require('pg');
const db = require('../src/db');

const ids = {
  actor: '11111111-1111-7111-8111-111111111111',
  booking: '22222222-2222-7222-8222-222222222222',
  otherBooking: '33333333-3333-7333-8333-333333333333',
  service: '44444444-4444-7444-8444-444444444444',
  line: '55555555-5555-7555-8555-555555555555',
  otherLine: '66666666-6666-7666-8666-666666666666',
  invoice: '77777777-7777-7777-8777-777777777777',
};

async function withScratchSchema(run) {
  const client = new Client({ connectionString: process.env.PG_URL });
  const schema = `m3_usage_record_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  await client.connect();
  const previousQuery = db.pool.query;

  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}", public`);
    await client.query(`
      CREATE TABLE booking (booking_id uuid PRIMARY KEY);
      CREATE TABLE service (
        service_id uuid PRIMARY KEY,
        current_price numeric(12,2) NOT NULL,
        active boolean NOT NULL DEFAULT true
      );
      CREATE TABLE booking_room_line (
        line_id uuid PRIMARY KEY,
        booking_id uuid NOT NULL,
        status text NOT NULL
      );
      CREATE TYPE invoice_status_enum AS ENUM ('DRAFT', 'FINAL');
      CREATE TABLE invoice (invoice_id uuid PRIMARY KEY, booking_id uuid NOT NULL, status invoice_status_enum NOT NULL);
      CREATE TABLE service_usage (
        usage_id uuid PRIMARY KEY DEFAULT uuidv7(),
        booking_id uuid NOT NULL,
        service_id uuid NOT NULL,
        booking_room_line_id uuid,
        quantity numeric(10,2) NOT NULL,
        unit_price_snapshot numeric(12,2) NOT NULL,
        recorded_by uuid NOT NULL
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
    await client.query('INSERT INTO booking (booking_id) VALUES ($1), ($2)', [ids.booking, ids.otherBooking]);
    await client.query(
      'INSERT INTO service (service_id, current_price, active) VALUES ($1, 1250.50, true)',
      [ids.service],
    );
    await client.query(
      `INSERT INTO booking_room_line (line_id, booking_id, status)
       VALUES ($1, $2, 'CHECKED_IN'), ($3, $4, 'CHECKED_IN')`,
      [ids.line, ids.booking, ids.otherLine, ids.otherBooking],
    );
    await client.query(
      `INSERT INTO invoice (invoice_id, booking_id, status) VALUES ($1, $2, 'DRAFT')`,
      [ids.invoice, ids.booking],
    );
    db.pool.query = client.query.bind(client);
    await run({ client, schema });
  } finally {
    db.pool.query = previousQuery;
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
}

test('M3-S09 snapshots the catalogue price and refreshes the draft invoice', async () => {
  await withScratchSchema(async ({ client }) => {
    const { recordServiceUsage } = await import('../src/services/serviceUsageService.ts');
    const result = await recordServiceUsage(client, {
      bookingId: ids.booking,
      serviceId: ids.service,
      bookingRoomLineId: ids.line,
      quantity: 1.5,
      recordedBy: ids.actor,
      unitPriceSnapshot: 1,
    });

    assert.equal(result.unitPriceSnapshot, '1250.50');
    assert.equal(result.quantity, '1.50');
    assert.equal(result.invoiceId, ids.invoice);
    assert.deepEqual(
      (await client.query('SELECT count(*)::int AS count FROM refresh_calls')).rows[0].count,
      1,
    );
  });
});

test('M3-S09 rejects cross-booking attribution and FINAL invoice writes', async () => {
  await withScratchSchema(async ({ client }) => {
    const { recordServiceUsage } = await import('../src/services/serviceUsageService.ts');

    await assert.rejects(
      recordServiceUsage(client, {
        bookingId: ids.booking,
        serviceId: ids.service,
        bookingRoomLineId: ids.otherLine,
        quantity: 1,
        recordedBy: ids.actor,
      }),
      /same booking/,
    );
    assert.equal((await client.query('SELECT count(*)::int AS count FROM service_usage')).rows[0].count, 0);

    await client.query('UPDATE invoice SET status = \'FINAL\' WHERE invoice_id = $1', [ids.invoice]);
    await assert.rejects(
      recordServiceUsage(client, {
        bookingId: ids.booking,
        serviceId: ids.service,
        quantity: 1,
        recordedBy: ids.actor,
      }),
      /Invoice is FINAL/,
    );
    assert.equal((await client.query('SELECT count(*)::int AS count FROM service_usage')).rows[0].count, 0);
  });
});