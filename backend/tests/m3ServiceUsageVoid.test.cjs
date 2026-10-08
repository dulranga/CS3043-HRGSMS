const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const voidGuardMigration = readFileSync(
  path.join(__dirname, '..', 'migrations', 'm3_006_service_usage_void_guard.sql'),
  'utf8',
);

async function expectSqlError(client, sql, values, code) {
  await client.query('SAVEPOINT expected_error');
  try {
    await assert.rejects(
      client.query(sql, values),
      (error) => error.code === code,
      `Expected PostgreSQL error ${code}`,
    );
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT expected_error');
    await client.query('RELEASE SAVEPOINT expected_error');
  }
}

// Focused schema guard: the recorded financial event may only be voided once,
// with actor and time, and may never be rewritten or deleted.
test('M3-S11 database guard permits one complete void and rejects rewrites or deletes', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const client = new Client({ connectionString: process.env.PG_URL });
  const schema = `m3_service_usage_void_${randomBytes(8).toString('hex')}`;
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query(`
      CREATE TABLE user_account (user_id uuid PRIMARY KEY DEFAULT uuidv7());
      CREATE TABLE booking (booking_id uuid PRIMARY KEY DEFAULT uuidv7());
      CREATE TABLE service (service_id uuid PRIMARY KEY DEFAULT uuidv7());
      CREATE TABLE service_usage (
        usage_id uuid PRIMARY KEY DEFAULT uuidv7(),
        booking_id uuid NOT NULL REFERENCES booking (booking_id),
        service_id uuid NOT NULL REFERENCES service (service_id),
        booking_room_line_id uuid,
        used_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        quantity numeric(10, 2) NOT NULL CHECK (quantity > 0),
        unit_price_snapshot numeric(12, 2) NOT NULL CHECK (unit_price_snapshot >= 0),
        voided boolean NOT NULL DEFAULT false,
        voided_at timestamptz,
        recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        recorded_by uuid NOT NULL REFERENCES user_account (user_id),
        voided_by uuid REFERENCES user_account (user_id),
        CONSTRAINT service_usage_void_consistency_check CHECK (
          (voided = false AND voided_at IS NULL AND voided_by IS NULL)
          OR (voided = true AND voided_at IS NOT NULL AND voided_by IS NOT NULL)
        )
      );
    `);
    await client.query(voidGuardMigration);

    const actor = (await client.query('INSERT INTO user_account DEFAULT VALUES RETURNING user_id')).rows[0].user_id;
    const voidActor = (await client.query('INSERT INTO user_account DEFAULT VALUES RETURNING user_id')).rows[0].user_id;
    const bookingId = (await client.query('INSERT INTO booking DEFAULT VALUES RETURNING booking_id')).rows[0].booking_id;
    const serviceId = (await client.query('INSERT INTO service DEFAULT VALUES RETURNING service_id')).rows[0].service_id;
    const usageId = (await client.query(
      `INSERT INTO service_usage (booking_id, service_id, quantity, unit_price_snapshot, recorded_by)
       VALUES ($1, $2, 2, 900, $3) RETURNING usage_id`,
      [bookingId, serviceId, actor],
    )).rows[0].usage_id;

    // A partial void, an un-void and a rewritten price snapshot are all rejected.
    await expectSqlError(client,
      'UPDATE service_usage SET voided = true WHERE usage_id = $1', [usageId], '23514');
    await expectSqlError(client,
      `UPDATE service_usage SET quantity = 5 WHERE usage_id = $1`, [usageId], '23514');
    await expectSqlError(client,
      `UPDATE service_usage SET unit_price_snapshot = 1 WHERE usage_id = $1`, [usageId], '23514');
    await expectSqlError(client,
      `UPDATE service_usage SET recorded_by = $2 WHERE usage_id = $1`, [usageId, voidActor], '23514');
    await expectSqlError(client,
      'DELETE FROM service_usage WHERE usage_id = $1', [usageId], '23514');

    const before = (await client.query(
      'SELECT quantity, unit_price_snapshot, used_at, recorded_at, recorded_by FROM service_usage WHERE usage_id = $1',
      [usageId],
    )).rows[0];

    const voided = (await client.query(
      `UPDATE service_usage
          SET voided = true, voided_at = CURRENT_TIMESTAMP, voided_by = $2
        WHERE usage_id = $1
        RETURNING voided, voided_at, voided_by, quantity, unit_price_snapshot, used_at, recorded_at, recorded_by`,
      [usageId, voidActor],
    )).rows[0];
    assert.equal(voided.voided, true);
    assert.ok(voided.voided_at);
    assert.equal(voided.voided_by, voidActor);
    assert.deepEqual(
      { quantity: voided.quantity, unit_price_snapshot: voided.unit_price_snapshot, used_at: voided.used_at,
        recorded_at: voided.recorded_at, recorded_by: voided.recorded_by },
      before,
      'the original charge, its actor and its timestamps are retained',
    );

    // A repeated void and any attempt to restore a voided charge are rejected.
    await expectSqlError(client,
      `UPDATE service_usage SET voided = true, voided_at = CURRENT_TIMESTAMP, voided_by = $2 WHERE usage_id = $1`,
      [usageId, voidActor], '23514');
    await expectSqlError(client,
      'UPDATE service_usage SET voided = false, voided_at = NULL, voided_by = NULL WHERE usage_id = $1',
      [usageId], '23514');

    // Re-applying the migration is idempotent.
    await client.query(voidGuardMigration);
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