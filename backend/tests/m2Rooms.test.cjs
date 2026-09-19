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

test('M2-S04 room inventory migration and constraints in a clean isolated schema', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const client = new Client({ connectionString: process.env.PG_URL });
  const schema = `m2_rooms_test_${randomBytes(8).toString('hex')}`;
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}", public`);

    // These minimal Member 1 parents exist only in the rolled-back test schema.
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
              character_maximum_length, is_nullable, column_default
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
        'room.branch_id', 'room.booking_id', 'room.room_type_id',
        'room_block.block_id', 'room_block.start_date', 'room_block.end_date',
        'room_block.reason', 'room_block.created_at', 'room_block.room_id',
        'room_block.created_by',
      ],
    );
    assert.equal(
      columns.rows.find(
        (row) => row.table_name === 'room' && row.column_name === 'operational_status',
      ).udt_name,
      'room_status_enum',
    );
    assert.equal(
      columns.rows.find(
        (row) => row.table_name === 'room' && row.column_name === 'booking_id',
      ).is_nullable,
      'YES',
    );
    assert.equal(
      columns.rows.find(
        (row) => row.table_name === 'room_block' && row.column_name === 'created_at',
      ).data_type,
      'timestamp with time zone',
    );
    for (const [table, field] of [
      ['room', 'room_number'], ['room_block', 'reason'],
    ]) {
      const column = columns.rows.find(
        (row) => row.table_name === table && row.column_name === field,
      );
      assert.equal(column.data_type, 'character varying');
      assert.equal(column.character_maximum_length, 255);
    }

    const enumLabels = await client.query(
      `SELECT enum.enumlabel
         FROM pg_type AS type
         JOIN pg_enum AS enum ON enum.enumtypid = type.oid
         JOIN pg_namespace AS namespace ON namespace.oid = type.typnamespace
        WHERE namespace.nspname = $1
          AND type.typname = 'room_status_enum'
        ORDER BY enum.enumsortorder`,
      [schema],
    );
    assert.deepEqual(enumLabels.rows.map(({ enumlabel }) => enumlabel), [
      'AVAILABLE', 'RESERVED', 'OCCUPIED', 'CLEANING', 'OUT_OF_SERVICE',
    ]);

    const branchOne = await client.query('INSERT INTO branch DEFAULT VALUES RETURNING branch_id');
    const branchOneId = branchOne.rows[0].branch_id;
    const branchTwo = await client.query('INSERT INTO branch DEFAULT VALUES RETURNING branch_id');
    const branchTwoId = branchTwo.rows[0].branch_id;
    const actor = await client.query(
      'INSERT INTO user_account DEFAULT VALUES RETURNING user_id',
    );
    const actorId = actor.rows[0].user_id;
    const guest = await client.query('INSERT INTO guest DEFAULT VALUES RETURNING guest_id');
    const guestId = guest.rows[0].guest_id;
    const type = await client.query(
      `INSERT INTO room_type (name, capacity, base_daily_rate)
       VALUES ('Deluxe King', 2, 18000) RETURNING room_type_id`,
    );
    const roomTypeId = type.rows[0].room_type_id;
    const booking = await client.query(
      `INSERT INTO booking (
         booking_ref, check_in_date, check_out_date, booking_channel,
         guest_count, rate_snapshot, guest_id, created_by
       ) VALUES ('ROOM-POINTER-FIXTURE', '2026-10-01', '2026-10-03',
                 'FRONT_DESK', 2, 18000, $1, $2)
       RETURNING booking_id`,
      [guestId, actorId],
    );
    const bookingId = booking.rows[0].booking_id;
    await client.query(
      `INSERT INTO booking_status_history (
         booking_id, old_status, new_status, changed_by, reason
       ) VALUES ($1, NULL, 'BOOKED', $2, 'Room FK fixture')`,
      [bookingId, actorId],
    );
    await client.query(
      `UPDATE booking
          SET status = 'CHECKED_IN',
              actual_check_in = TIMESTAMPTZ '2026-10-01 08:00:00+00',
              updated_at = CURRENT_TIMESTAMP
        WHERE booking_id = $1`,
      [bookingId],
    );
    await client.query(
      `INSERT INTO booking_status_history (
         booking_id, old_status, new_status, changed_by, reason
       ) VALUES ($1, 'BOOKED', 'CHECKED_IN', $2, 'Current-stay pointer fixture')`,
      [bookingId, actorId],
    );

    const room = await client.query(
      `INSERT INTO room (room_number, branch_id, room_type_id)
       VALUES ('101', $1, $2)
       RETURNING room_id, operational_status, active, booking_id`,
      [branchOneId, roomTypeId],
    );
    const roomId = room.rows[0].room_id;
    assert.equal(room.rows[0].operational_status, 'AVAILABLE');
    assert.equal(room.rows[0].active, true);
    assert.equal(room.rows[0].booking_id, null);

    const pointedRoom = await client.query(
      `INSERT INTO room (room_number, branch_id, booking_id, room_type_id)
       VALUES ('102', $1, $2, $3) RETURNING room_id, booking_id`,
      [branchOneId, bookingId, roomTypeId],
    );
    assert.equal(pointedRoom.rows[0].booking_id, bookingId);

    const otherBranchRoom = await client.query(
      `INSERT INTO room (room_number, branch_id, room_type_id)
       VALUES ('101', $1, $2) RETURNING room_id`,
      [branchTwoId, roomTypeId],
    );
    assert.ok(otherBranchRoom.rows[0].room_id);

    const versions = await client.query(
      `SELECT uuid_extract_version($1::uuid) AS room_version,
              uuid_extract_version($2::uuid) AS pointed_room_version`,
      [roomId, pointedRoom.rows[0].room_id],
    );
    assert.equal(versions.rows[0].room_version, 7);
    assert.equal(versions.rows[0].pointed_room_version, 7);

    const validRoomSql = `INSERT INTO room (
      room_number, operational_status, branch_id, booking_id, room_type_id
    ) VALUES ($1, $2, $3, $4, $5)`;
    await expectSqlError(client, validRoomSql,
      ['101', 'AVAILABLE', branchOneId, null, roomTypeId], '23505');
    await expectSqlError(client, validRoomSql,
      ['   ', 'AVAILABLE', branchOneId, null, roomTypeId], '23514');
    await expectSqlError(client, validRoomSql,
      ['103', 'DIRTY', branchOneId, null, roomTypeId], '22P02');
    await expectSqlError(client, validRoomSql,
      ['103', 'AVAILABLE', '00000000-0000-7000-8000-000000000001', null, roomTypeId],
      '23503');
    await expectSqlError(client, validRoomSql,
      ['103', 'AVAILABLE', branchOneId, null,
        '00000000-0000-7000-8000-000000000002'],
      '23503');
    await expectSqlError(client, validRoomSql,
      ['103', 'AVAILABLE', branchOneId,
        '00000000-0000-7000-8000-000000000003', roomTypeId],
      '23503');
    await expectSqlError(client,
      `INSERT INTO room (
         room_id, room_number, branch_id, room_type_id
       ) VALUES (uuidv4(), '103', $1, $2)`,
      [branchOneId, roomTypeId], '23514');
    await expectSqlError(client,
      `INSERT INTO room (
         room_id, room_number, branch_id, room_type_id
       ) VALUES ('00000000-0000-0000-0000-000000000000', '103', $1, $2)`,
      [branchOneId, roomTypeId], '23514');

    const block = await client.query(
      `INSERT INTO room_block (start_date, end_date, reason, room_id, created_by)
       VALUES ('2026-11-01', '2026-11-04', 'Scheduled maintenance', $1, $2)
       RETURNING block_id, created_at`,
      [roomId, actorId],
    );
    const blockId = block.rows[0].block_id;
    assert.ok(block.rows[0].created_at instanceof Date);
    const blockVersion = await client.query(
      'SELECT uuid_extract_version($1::uuid) AS block_version',
      [blockId],
    );
    assert.equal(blockVersion.rows[0].block_version, 7);

    const validBlockSql = `INSERT INTO room_block (
      start_date, end_date, reason, room_id, created_by
    ) VALUES ($1, $2, $3, $4, $5)`;
    await expectSqlError(client, validBlockSql,
      ['2026-11-01', '2026-11-01', 'Invalid interval', roomId, actorId], '23514');
    await expectSqlError(client, validBlockSql,
      ['2026-11-04', '2026-11-01', 'Invalid interval', roomId, actorId], '23514');
    await expectSqlError(client, validBlockSql,
      ['2026-11-05', '2026-11-06', '   ', roomId, actorId], '23514');
    await expectSqlError(client, validBlockSql,
      ['2026-11-05', '2026-11-06', 'Maintenance',
        '00000000-0000-7000-8000-000000000004', actorId],
      '23503');
    await expectSqlError(client, validBlockSql,
      ['2026-11-05', '2026-11-06', 'Maintenance', roomId,
        '00000000-0000-7000-8000-000000000005'],
      '23503');
    await expectSqlError(client,
      `INSERT INTO room_block (
         block_id, start_date, end_date, reason, room_id, created_by
       ) VALUES (uuidv4(), '2026-11-05', '2026-11-06', 'Maintenance', $1, $2)`,
      [roomId, actorId], '23514');
    await expectSqlError(client, 'DELETE FROM room WHERE room_id = $1', [roomId], '23001');
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
