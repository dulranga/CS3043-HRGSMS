const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const test = require('node:test');
const { Client } = require('pg');
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });

const schemaSql = `
  CREATE TYPE booking_room_line_status_enum AS ENUM ('BOOKED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW');
  CREATE TYPE room_condition_enum AS ENUM ('READY', 'CLEANING', 'OUT_OF_SERVICE');
  CREATE TABLE user_account (
    user_id uuid PRIMARY KEY DEFAULT uuidv7()
  );
  CREATE TABLE booking (
    booking_id uuid PRIMARY KEY DEFAULT uuidv7()
  );
  CREATE TABLE room (
    room_id uuid PRIMARY KEY DEFAULT uuidv7(),
    operational_status room_condition_enum NOT NULL DEFAULT 'READY'
  );
  CREATE TABLE booking_room_line (
    line_id uuid PRIMARY KEY DEFAULT uuidv7(),
    booking_id uuid NOT NULL REFERENCES booking (booking_id),
    stay_start_date date NOT NULL,
    stay_end_date date NOT NULL,
    status booking_room_line_status_enum NOT NULL DEFAULT 'BOOKED',
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE booking_room_assignment (
    assignment_id uuid PRIMARY KEY DEFAULT uuidv7(),
    line_id uuid NOT NULL REFERENCES booking_room_line (line_id),
    room_id uuid NOT NULL REFERENCES room (room_id),
    assigned_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    unassigned_at timestamptz,
    occupied_from timestamptz,
    occupied_to timestamptz
  );
  CREATE TABLE booking_room_line_status_history (
    history_id uuid PRIMARY KEY DEFAULT uuidv7(),
    line_id uuid NOT NULL REFERENCES booking_room_line (line_id),
    old_status booking_room_line_status_enum,
    new_status booking_room_line_status_enum NOT NULL,
    changed_at timestamptz NOT NULL,
    changed_by uuid NOT NULL REFERENCES user_account (user_id),
    reason varchar(255) NOT NULL
  );
  CREATE TABLE audit_log (
    audit_id uuid PRIMARY KEY DEFAULT uuidv7(),
    entity_name varchar(255) NOT NULL,
    entity_id varchar(255) NOT NULL,
    action varchar(50) NOT NULL,
    before_value text,
    after_value text,
    changed_at timestamptz NOT NULL,
    user_id uuid REFERENCES user_account (user_id)
  );
  CREATE TABLE room_status_history (
    room_history_id uuid PRIMARY KEY DEFAULT uuidv7(),
    room_id uuid NOT NULL REFERENCES room (room_id),
    old_status room_condition_enum NOT NULL,
    new_status room_condition_enum NOT NULL,
    changed_at timestamptz NOT NULL,
    changed_by uuid NOT NULL REFERENCES user_account (user_id)
  );
`;

async function seed(client) {
  const actor = await client.query('INSERT INTO user_account DEFAULT VALUES RETURNING user_id');
  const booking = await client.query('INSERT INTO booking DEFAULT VALUES RETURNING booking_id');
  const rooms = await client.query('INSERT INTO room DEFAULT VALUES RETURNING room_id');
  const secondRoom = await client.query('INSERT INTO room DEFAULT VALUES RETURNING room_id');
  const lines = [];
  for (const room of [rooms.rows[0].room_id, secondRoom.rows[0].room_id]) {
    const line = await client.query(
      `INSERT INTO booking_room_line (booking_id, stay_start_date, stay_end_date)
       VALUES ($1, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::date, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Colombo')::date + 3) RETURNING line_id`,
      [booking.rows[0].booking_id],
    );
    await client.query(
      `INSERT INTO booking_room_assignment (line_id, room_id)
       VALUES ($1, $2)`,
      [line.rows[0].line_id, room],
    );
    lines.push(line.rows[0].line_id);
  }
  return { actorId: actor.rows[0].user_id, bookingId: booking.rows[0].booking_id, lineIds: lines };
}

async function inSchema(client, schema, work) {
  await client.query('BEGIN');
  await client.query(`SET LOCAL search_path TO "${schema}"`);
  try {
    const result = await work();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

test('M3-S06 checks in one line while the other line remains BOOKED', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const client = new Client({ connectionString: process.env.PG_URL });
  const schema = `m3_check_in_${randomBytes(8).toString('hex')}`;
  await client.connect();

  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    const fixture = await inSchema(client, schema, async () => {
      await client.query(schemaSql);
      return seed(client);
    });
    const { checkInRoomLine } = await import('../src/services/checkInService.ts');

    const result = await checkInRoomLine(client, {
      lineId: fixture.lineIds[0],
      actorId: fixture.actorId,
      schema,
    });
    assert.equal(result.lineId, fixture.lineIds[0]);

    const lines = await inSchema(client, schema, () => client.query(
      'SELECT line_id, status FROM booking_room_line ORDER BY line_id',
    ));
    assert.equal(lines.rows.find((row) => row.line_id === fixture.lineIds[0]).status, 'CHECKED_IN');
    assert.equal(lines.rows.find((row) => row.line_id === fixture.lineIds[1]).status, 'BOOKED');

    const assignment = await inSchema(client, schema, () => client.query(
      `SELECT occupied_from, occupied_to
         FROM booking_room_assignment
        WHERE line_id = $1`,
      [fixture.lineIds[0]],
    ));
    assert.ok(assignment.rows[0].occupied_from);
    assert.equal(assignment.rows[0].occupied_to, null);

    const history = await inSchema(client, schema, () => client.query('SELECT old_status, new_status FROM booking_room_line_status_history'));
    assert.deepEqual(history.rows, [{ old_status: 'BOOKED', new_status: 'CHECKED_IN' }]);
    assert.equal((await inSchema(client, schema, () => client.query('SELECT count(*)::int AS count FROM audit_log'))).rows[0].count, 1);
    assert.equal((await inSchema(client, schema, () => client.query('SELECT count(*)::int AS count FROM room_status_history'))).rows[0].count, 0);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
});

test('M3-S06 rejects non-READY rooms and leaves the line and assignment unchanged', async () => {
  const client = new Client({ connectionString: process.env.PG_URL });
  const schema = `m3_check_in_reject_${randomBytes(8).toString('hex')}`;
  await client.connect();

  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    const fixture = await inSchema(client, schema, async () => {
      await client.query(schemaSql);
      return seed(client);
    });
    await inSchema(client, schema, () => client.query(
      `UPDATE room
          SET operational_status = 'CLEANING'
        WHERE room_id = (SELECT room_id FROM booking_room_assignment WHERE line_id = $1)`,
      [fixture.lineIds[0]],
    ));
    const { checkInRoomLine } = await import('../src/services/checkInService.ts');

    await assert.rejects(
      checkInRoomLine(client, {
        lineId: fixture.lineIds[0],
        actorId: fixture.actorId,
        schema,
      }),
      /READY/,
    );

    assert.equal(
      (await inSchema(client, schema, () => client.query('SELECT status FROM booking_room_line WHERE line_id = $1', [fixture.lineIds[0]]))).rows[0].status,
      'BOOKED',
    );
    assert.equal(
      (await inSchema(client, schema, () => client.query('SELECT occupied_from FROM booking_room_assignment WHERE line_id = $1', [fixture.lineIds[0]]))).rows[0].occupied_from,
      null,
    );
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
});

test('M3-S06 rolls back line, occupancy, history, and audit when a later write fails', async () => {
  const client = new Client({ connectionString: process.env.PG_URL });
  const schema = `m3_check_in_rollback_${randomBytes(8).toString('hex')}`;
  await client.connect();

  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    const fixture = await inSchema(client, schema, async () => {
      await client.query(schemaSql);
      return seed(client);
    });
    await inSchema(client, schema, () => client.query(`
      CREATE FUNCTION reject_check_in_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'forced audit failure';
      END;
      $$;
      CREATE TRIGGER reject_check_in_audit_trigger
      BEFORE INSERT ON audit_log
      FOR EACH ROW EXECUTE FUNCTION reject_check_in_audit();
    `));
    const { checkInRoomLine } = await import('../src/services/checkInService.ts');

    await assert.rejects(
      checkInRoomLine(client, {
        lineId: fixture.lineIds[0],
        actorId: fixture.actorId,
        schema,
      }),
      /forced audit failure/,
    );

    const state = await inSchema(client, schema, () => client.query(
      `SELECT line.status, assignment.occupied_from
         FROM booking_room_line AS line
         JOIN booking_room_assignment AS assignment USING (line_id)
        WHERE line.line_id = $1`,
      [fixture.lineIds[0]],
    ));
    assert.equal(state.rows[0].status, 'BOOKED');
    assert.equal(state.rows[0].occupied_from, null);
    assert.equal((await inSchema(client, schema, () => client.query('SELECT count(*)::int AS count FROM booking_room_line_status_history'))).rows[0].count, 0);
    assert.equal((await inSchema(client, schema, () => client.query('SELECT count(*)::int AS count FROM audit_log'))).rows[0].count, 0);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
});
