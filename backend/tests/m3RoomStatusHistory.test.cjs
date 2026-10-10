const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const migration = readFileSync(
  path.join(__dirname, '..', 'migrations', 'm3_005_room_status_history.sql'),
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

test('M3-S03 room status history is append-only and validates condition changes', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const client = new Client({ connectionString: process.env.PG_URL });
  const schema = `m3_room_history_test_${randomBytes(8).toString('hex')}`;
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query(`
      CREATE TYPE room_condition_enum AS ENUM ('READY', 'CLEANING', 'OUT_OF_SERVICE');
      CREATE TABLE user_account (
        user_id uuid PRIMARY KEY DEFAULT uuidv7()
      );
      CREATE TABLE room (
        room_id uuid PRIMARY KEY DEFAULT uuidv7()
      );
    `);
    await client.query(migration);

    const actor = await client.query('INSERT INTO user_account DEFAULT VALUES RETURNING user_id');
    const room = await client.query('INSERT INTO room DEFAULT VALUES RETURNING room_id');
    const actorId = actor.rows[0].user_id;
    const roomId = room.rows[0].room_id;

    const columns = await client.query(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'room_status_history'
        ORDER BY ordinal_position`,
      [schema],
    );
    assert.deepEqual(
      columns.rows.map(({ column_name }) => column_name),
      ['room_history_id', 'room_id', 'old_status', 'new_status', 'changed_at', 'changed_by', 'reason'],
    );
    assert.equal(columns.rows.find((row) => row.column_name === 'old_status').data_type, 'USER-DEFINED');
    assert.equal(columns.rows.find((row) => row.column_name === 'changed_by').is_nullable, 'NO');

    const inserted = await client.query(
      `INSERT INTO room_status_history (room_id, old_status, new_status, changed_by)
       VALUES ($1, 'READY', 'CLEANING', $2)
       RETURNING room_history_id, changed_at`,
      [roomId, actorId],
    );
    assert.ok(inserted.rows[0].room_history_id);
    assert.ok(inserted.rows[0].changed_at);

    const version = await client.query(
      'SELECT uuid_extract_version($1::uuid) AS history_version',
      [inserted.rows[0].room_history_id],
    );
    assert.equal(version.rows[0].history_version, 7);

    await client.query(
      `INSERT INTO room_status_history (room_id, old_status, new_status, changed_by)
       VALUES ($1, 'CLEANING', 'READY', $2)`,
      [roomId, actorId],
    );
    const count = await client.query('SELECT count(*)::int AS count FROM room_status_history');
    assert.equal(count.rows[0].count, 2);

    await expectSqlError(client,
      `INSERT INTO room_status_history (room_id, old_status, new_status, changed_by)
       VALUES ($1, 'READY', 'READY', $2)`,
      [roomId, actorId], '23514');
    await expectSqlError(client,
      `INSERT INTO room_status_history (room_id, old_status, new_status, changed_by)
       VALUES ($1, 'READY', 'CLEANING', uuidv4())`,
      [roomId], '23503');
    await expectSqlError(client,
      `INSERT INTO room_status_history (room_id, old_status, new_status, changed_by)
       VALUES (uuidv4(), 'READY', 'CLEANING', $1)`,
      [actorId], '23503');
    await expectSqlError(client,
      `INSERT INTO room_status_history (room_id, old_status, new_status, changed_by)
       VALUES ($1, 'AVAILABLE', 'READY', $2)`,
      [roomId, actorId], '22P02');

    const historyId = inserted.rows[0].room_history_id;
    await expectSqlError(client,
      'UPDATE room_status_history SET new_status = $1 WHERE room_history_id = $2',
      ['OUT_OF_SERVICE', historyId], '42501');
    await expectSqlError(client,
      'DELETE FROM room_status_history WHERE room_history_id = $1',
      [historyId], '42501');
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
