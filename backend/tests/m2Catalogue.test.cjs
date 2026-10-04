const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const migration = readFileSync(
  path.join(__dirname, '..', 'migrations', 'm2_001_room_catalogue.sql'),
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

test('M2-S02 catalogue migration and constraints in a clean isolated schema', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const client = new Client({ connectionString: process.env.PG_URL });
  const schema = `m2_catalogue_test_${randomBytes(8).toString('hex')}`;
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}", public`);
    await client.query(migration);

    const columns = await client.query(
      `SELECT table_name, column_name, data_type, character_maximum_length,
              numeric_precision, numeric_scale
         FROM information_schema.columns
        WHERE table_schema = $1
        ORDER BY table_name, ordinal_position`,
      [schema],
    );
    assert.deepEqual(
      columns.rows.map(({ table_name, column_name }) => `${table_name}.${column_name}`),
      [
        'amenity.amenity_id', 'amenity.name', 'amenity.description', 'amenity.active',
        'room_type.room_type_id', 'room_type.name', 'room_type.capacity',
        'room_type.base_daily_rate', 'room_type.active',
        'room_type_amenity.room_type_id', 'room_type_amenity.amenity_id',
      ],
    );
    const rateColumn = columns.rows.find(
      (row) => row.table_name === 'room_type' && row.column_name === 'base_daily_rate',
    );
    assert.equal(rateColumn.data_type, 'numeric');
    assert.equal(rateColumn.numeric_precision, 12);
    assert.equal(rateColumn.numeric_scale, 2);
    for (const [table, field, dataType] of [
      ['room_type', 'room_type_id', 'uuid'],
      ['room_type', 'capacity', 'smallint'],
      ['room_type', 'active', 'boolean'],
      ['amenity', 'amenity_id', 'uuid'],
      ['amenity', 'active', 'boolean'],
      ['room_type_amenity', 'room_type_id', 'uuid'],
      ['room_type_amenity', 'amenity_id', 'uuid'],
    ]) {
      assert.equal(
        columns.rows.find((row) => row.table_name === table && row.column_name === field).data_type,
        dataType,
        `${table}.${field} must use ${dataType}`,
      );
    }
    for (const [table, field] of [
      ['room_type', 'name'], ['amenity', 'name'], ['amenity', 'description'],
    ]) {
      const column = columns.rows.find(
        (row) => row.table_name === table && row.column_name === field,
      );
      assert.equal(column.data_type, 'character varying');
      assert.equal(column.character_maximum_length, 255);
    }

    const type = await client.query(
      `INSERT INTO room_type (name, capacity, base_daily_rate)
       VALUES ('Sky Suite', 2, 12500.005)
       RETURNING room_type_id, base_daily_rate, active`,
    );
    const typeId = type.rows[0].room_type_id;
    assert.equal(type.rows[0].base_daily_rate, '12500.01');
    assert.equal(type.rows[0].active, true);
    const amenity = await client.query(
      `INSERT INTO amenity (name) VALUES ('Wi-Fi') RETURNING amenity_id, active`,
    );
    const amenityId = amenity.rows[0].amenity_id;
    assert.equal(amenity.rows[0].active, true);
    const versions = await client.query(
      'SELECT uuid_extract_version($1::uuid) AS room_type_version, uuid_extract_version($2::uuid) AS amenity_version',
      [typeId, amenityId],
    );
    assert.equal(versions.rows[0].room_type_version, 7);
    assert.equal(versions.rows[0].amenity_version, 7);

    await client.query(
      'INSERT INTO room_type_amenity (room_type_id, amenity_id) VALUES ($1, $2)',
      [typeId, amenityId],
    );
    await expectSqlError(client,
      'INSERT INTO room_type_amenity (room_type_id, amenity_id) VALUES ($1, $2)',
      [typeId, amenityId], '23505');
    await expectSqlError(client,
      'INSERT INTO room_type_amenity (room_type_id, amenity_id) VALUES (uuidv7(), $1)',
      [amenityId], '23503');
    await expectSqlError(client,
      'INSERT INTO room_type_amenity (room_type_id, amenity_id) VALUES ($1, NULL)',
      [typeId], '23502');
    await expectSqlError(client,
      'DELETE FROM amenity WHERE amenity_id = $1', [amenityId], '23001');
    await expectSqlError(client,
      `INSERT INTO room_type (name, capacity, base_daily_rate)
       VALUES ('Invalid', 0, 10)`, [], '23514');
    await expectSqlError(client,
      `INSERT INTO room_type (name, capacity, base_daily_rate)
       VALUES ('Invalid', 1, -1)`, [], '23514');
    await expectSqlError(client,
      `INSERT INTO room_type (name, capacity, base_daily_rate)
       VALUES ('Invalid', 1, 'NaN'::numeric)`, [], '23514');
    await expectSqlError(client,
      `INSERT INTO room_type (name, capacity, base_daily_rate)
       VALUES ('Invalid', 1, 10000000000)`, [], '22003');
    await expectSqlError(client,
      `INSERT INTO room_type (room_type_id, name, capacity, base_daily_rate)
       VALUES (uuidv4(), 'Invalid', 1, 10)`, [], '23514');
    await expectSqlError(client,
      `INSERT INTO room_type (room_type_id, name, capacity, base_daily_rate)
       VALUES ('00000000-0000-0000-0000-000000000000', 'Invalid', 1, 10)`, [], '23514');
    await expectSqlError(client,
      `INSERT INTO room_type (name, capacity, base_daily_rate)
       VALUES ('   ', 1, 10)`, [], '23514');
    await expectSqlError(client,
      `INSERT INTO amenity (amenity_id, name) VALUES (uuidv4(), 'Invalid')`, [], '23514');
    await expectSqlError(client,
      `INSERT INTO amenity (amenity_id, name)
       VALUES ('00000000-0000-0000-0000-000000000000', 'Invalid')`, [], '23514');
    await expectSqlError(client,
      `INSERT INTO amenity (name) VALUES ('   ')`, [], '23514');
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
