const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const migration = readFileSync(
  path.join(__dirname, '..', 'migrations', 'm3_004_service_catalogue.sql'),
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

test('M3-S02 service catalogue migration and constraints in a clean isolated schema', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const client = new Client({ connectionString: process.env.PG_URL });
  const schema = `m3_service_test_${randomBytes(8).toString('hex')}`;
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}", public`);
    await client.query(migration);

    const columns = await client.query(
      `SELECT column_name, data_type, character_maximum_length,
              numeric_precision, numeric_scale, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'service'
        ORDER BY ordinal_position`,
      [schema],
    );
    assert.deepEqual(
      columns.rows.map(({ column_name }) => column_name),
      ['service_id', 'name', 'category', 'current_price', 'active', 'created_at', 'updated_at'],
    );
    const priceColumn = columns.rows.find((row) => row.column_name === 'current_price');
    assert.equal(priceColumn.data_type, 'numeric');
    assert.equal(priceColumn.numeric_precision, 12);
    assert.equal(priceColumn.numeric_scale, 2);
    for (const field of ['name', 'category']) {
      const column = columns.rows.find((row) => row.column_name === field);
      assert.equal(column.data_type, 'character varying');
      assert.equal(column.character_maximum_length, 255);
      assert.equal(column.is_nullable, 'NO');
    }

    const inserted = await client.query(
      `INSERT INTO service (name, category, current_price)
       VALUES ('Room Service', 'Food and Beverage', 1250.005)
       RETURNING service_id, current_price, active, created_at, updated_at`,
    );
    const serviceId = inserted.rows[0].service_id;
    assert.equal(inserted.rows[0].current_price, '1250.01');
    assert.equal(inserted.rows[0].active, true);
    assert.ok(inserted.rows[0].created_at);
    assert.ok(inserted.rows[0].updated_at);

    const version = await client.query(
      'SELECT uuid_extract_version($1::uuid) AS service_version',
      [serviceId],
    );
    assert.equal(version.rows[0].service_version, 7);

    await expectSqlError(client,
      `INSERT INTO service (name, category, current_price)
       VALUES ('Room Service', 'Food and Beverage', 100)`, [], '23505');
    await expectSqlError(client,
      `INSERT INTO service (name, category, current_price)
       VALUES ('Invalid', 'Food and Beverage', -1)`, [], '23514');
    await expectSqlError(client,
      `INSERT INTO service (name, category, current_price)
       VALUES ('Invalid', 'Food and Beverage', 'NaN'::numeric)`, [], '23514');
    await expectSqlError(client,
      `INSERT INTO service (name, category, current_price)
       VALUES ('Invalid', 'Food and Beverage', 10000000000)`, [], '22003');
    await expectSqlError(client,
      `INSERT INTO service (service_id, name, category, current_price)
       VALUES (uuidv4(), 'Invalid', 'Food and Beverage', 100)`, [], '23514');
    await expectSqlError(client,
      `INSERT INTO service (service_id, name, category, current_price)
       VALUES ('00000000-0000-0000-0000-000000000000', 'Invalid', 'Food and Beverage', 100)`,
      [], '23514');
    await expectSqlError(client,
      `INSERT INTO service (name, category, current_price)
       VALUES ('   ', 'Food and Beverage', 100)`, [], '23514');
    await expectSqlError(client,
      `INSERT INTO service (name, category, current_price)
       VALUES ('Invalid', '   ', 100)`, [], '23514');

    const inactive = await client.query(
      `INSERT INTO service (name, category, current_price, active)
       VALUES ('Laundry', 'Housekeeping', 900, false)
       RETURNING active`,
    );
    assert.equal(inactive.rows[0].active, false);
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