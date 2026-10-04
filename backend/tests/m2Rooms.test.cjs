const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const catalogueMigration = readFileSync(
  path.join(__dirname, '..', 'migrations', 'm2_001_room_catalogue.sql'),
  'utf8',
);
const bookingMigration = readFileSync(
  path.join(__dirname, '..', 'migrations', 'm2_002_booking.sql'),
  'utf8',
);
const roomMigration = readFileSync(
  path.join(__dirname, '..', 'migrations', 'm2_003_room_inventory.sql'),
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

test('M2-S04 creates target physical rooms without a booking pointer', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const client = new Client({ connectionString: process.env.PG_URL });
  const schema = `m2_rooms_test_${randomBytes(8).toString('hex')}`;
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}", public`);
    await client.query(`
      CREATE TABLE branch (
        branch_id uuid PRIMARY KEY DEFAULT uuidv7(),
        CONSTRAINT branch_uuidv7_check
          CHECK ((uuid_extract_version(branch_id) = 7) IS TRUE)
      );
      CREATE TABLE user_account (
        user_id uuid PRIMARY KEY DEFAULT uuidv7(),
        CONSTRAINT user_account_uuidv7_check
          CHECK ((uuid_extract_version(user_id) = 7) IS TRUE)
      );
      CREATE TABLE guest (
        guest_id uuid PRIMARY KEY DEFAULT uuidv7(),
        CONSTRAINT guest_uuidv7_check
          CHECK ((uuid_extract_version(guest_id) = 7) IS TRUE)
      );
    `);
    await client.query(catalogueMigration);
    await client.query(bookingMigration);
    await client.query(roomMigration);

    const columns = await client.query(
      `SELECT table_name, column_name, data_type, udt_name,
              character_maximum_length, column_default
         FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name IN ('room', 'room_block')
        ORDER BY table_name, ordinal_position`,
      [schema],
    );
    assert.deepEqual(
      columns.rows.map(({ table_name, column_name }) => `${table_name}.${column_name}`),
      [
        'room.room_id', 'room.room_number', 'room.operational_status', 'room.active',
        'room.branch_id', 'room.room_type_id',
        'room_block.block_id', 'room_block.start_date', 'room_block.end_date',
        'room_block.reason', 'room_block.created_at', 'room_block.room_id',
        'room_block.created_by',
      ],
    );
    assert.equal(
      columns.rows.some(
        (row) => row.table_name === 'room' && row.column_name === 'booking_id',
      ),
      false,
    );
    const conditionColumn = columns.rows.find(
      (row) => row.table_name === 'room' && row.column_name === 'operational_status',
    );
    assert.equal(conditionColumn.udt_name, 'room_condition_enum');
    assert.match(conditionColumn.column_default, /READY/);

    const enumLabels = await client.query(
      `SELECT enum.enumlabel
         FROM pg_type AS type
         JOIN pg_enum AS enum ON enum.enumtypid = type.oid
         JOIN pg_namespace AS namespace ON namespace.oid = type.typnamespace
        WHERE namespace.nspname = $1
          AND type.typname = 'room_condition_enum'
        ORDER BY enum.enumsortorder`,
      [schema],
    );
    assert.deepEqual(
      enumLabels.rows.map((row) => row.enumlabel),
      ['READY', 'CLEANING', 'OUT_OF_SERVICE'],
    );

    const branchOne = await client.query('INSERT INTO branch DEFAULT VALUES RETURNING branch_id');
    const branchTwo = await client.query('INSERT INTO branch DEFAULT VALUES RETURNING branch_id');
    const actor = await client.query(
      'INSERT INTO user_account DEFAULT VALUES RETURNING user_id',
    );
    const roomType = await client.query(
      `INSERT INTO room_type (name, capacity, base_daily_rate)
       VALUES ('Deluxe King', 2, 18000) RETURNING room_type_id`,
    );
    const branchOneId = branchOne.rows[0].branch_id;
    const branchTwoId = branchTwo.rows[0].branch_id;
    const actorId = actor.rows[0].user_id;
    const roomTypeId = roomType.rows[0].room_type_id;

    const room = await client.query(
      `INSERT INTO room (room_number, branch_id, room_type_id)
       VALUES ('101', $1, $2)
       RETURNING room_id, operational_status, active`,
      [branchOneId, roomTypeId],
    );
    const roomId = room.rows[0].room_id;
    assert.equal(room.rows[0].operational_status, 'READY');
    assert.equal(room.rows[0].active, true);

    const cleaningRoom = await client.query(
      `INSERT INTO room (
         room_number, operational_status, branch_id, room_type_id
       ) VALUES ('102', 'CLEANING', $1, $2)
       RETURNING operational_status`,
      [branchOneId, roomTypeId],
    );
    assert.equal(cleaningRoom.rows[0].operational_status, 'CLEANING');

    const otherBranchRoom = await client.query(
      `INSERT INTO room (room_number, branch_id, room_type_id)
       VALUES ('101', $1, $2) RETURNING room_id`,
      [branchTwoId, roomTypeId],
    );
    assert.ok(otherBranchRoom.rows[0].room_id);

    const validRoomSql = `INSERT INTO room (
      room_number, operational_status, branch_id, room_type_id
    ) VALUES ($1, $2, $3, $4)`;
    await expectSqlError(
      client,
      validRoomSql,
      ['101', 'READY', branchOneId, roomTypeId],
      '23505',
    );
    await expectSqlError(
      client,
      validRoomSql,
      ['   ', 'READY', branchOneId, roomTypeId],
      '23514',
    );
    await expectSqlError(
      client,
      validRoomSql,
      ['103', 'AVAILABLE', branchOneId, roomTypeId],
      '22P02',
    );
    await expectSqlError(
      client,
      validRoomSql,
      ['103', 'RESERVED', branchOneId, roomTypeId],
      '22P02',
    );
    await expectSqlError(
      client,
      validRoomSql,
      ['103', 'OCCUPIED', branchOneId, roomTypeId],
      '22P02',
    );
    await expectSqlError(
      client,
      validRoomSql,
      ['103', 'READY', '00000000-0000-7000-8000-000000000001', roomTypeId],
      '23503',
    );
    await expectSqlError(
      client,
      validRoomSql,
      ['103', 'READY', branchOneId, '00000000-0000-7000-8000-000000000002'],
      '23503',
    );
    await expectSqlError(
      client,
      `INSERT INTO room (
         room_id, room_number, branch_id, room_type_id
       ) VALUES (uuidv4(), '103', $1, $2)`,
      [branchOneId, roomTypeId],
      '23514',
    );

    const block = await client.query(
      `INSERT INTO room_block (
         start_date, end_date, reason, room_id, created_by
       ) VALUES ('2026-11-01', '2026-11-04', 'Scheduled maintenance', $1, $2)
       RETURNING block_id`,
      [roomId, actorId],
    );
    assert.ok(block.rows[0].block_id);

    const validBlockSql = `INSERT INTO room_block (
      start_date, end_date, reason, room_id, created_by
    ) VALUES ($1, $2, $3, $4, $5)`;
    await expectSqlError(
      client,
      validBlockSql,
      ['2026-11-01', '2026-11-01', 'Invalid interval', roomId, actorId],
      '23514',
    );
    await expectSqlError(
      client,
      validBlockSql,
      ['2026-11-01', '2026-11-03', '   ', roomId, actorId],
      '23514',
    );
    await expectSqlError(
      client,
      validBlockSql,
      [
        '2026-11-01', '2026-11-03', 'Missing room',
        '00000000-0000-7000-8000-000000000003', actorId,
      ],
      '23503',
    );
    await expectSqlError(
      client,
      validBlockSql,
      [
        '2026-11-01', '2026-11-03', 'Missing actor', roomId,
        '00000000-0000-7000-8000-000000000004',
      ],
      '23503',
    );
    await expectSqlError(
      client,
      'DELETE FROM room WHERE room_id = $1',
      [roomId],
      '23001',
    );
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
