import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const migrationFiles = [
  'm1_001_create_branch_and_role.sql',
  'm1_002_create_user_account_and_officer.sql',
  'm1_003_create_guest_and_guest_account.sql',
  'm2_001_room_catalogue.sql',
  'm2_002_booking.sql',
  'm2_003_room_inventory.sql',
  'm2_004_booking_room_assignment.sql',
  'm2_005_reservation_integrity_guards.sql',
  'm2_006_capacity_type_edit_guards.sql',
  'm2_007_available_rooms.sql',
];

const migrations = migrationFiles.map((file) =>
  readFileSync(path.join(__dirname, '..', 'migrations', file), 'utf8'),
);

test('M2-S09 derives available rooms from dates, capacity, condition, blocks and assignments', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const originalPgUrl = process.env.PG_URL;
  const originalPgSchema = process.env.PG_SCHEMA;
  const admin = new Client({ connectionString: originalPgUrl });
  const schema = `m2_availability_${randomBytes(8).toString('hex')}`;
  let server: ReturnType<express.Express['listen']> | undefined;
  let applicationPool: { end: () => Promise<void> } | undefined;

  await admin.connect();
  try {
    await admin.query('BEGIN');
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET LOCAL search_path TO "${schema}", public`);
    for (const migration of migrations) await admin.query(migration);

    const branches = await admin.query(
      'SELECT branch_id FROM branch ORDER BY name, branch_id LIMIT 2',
    );
    assert.equal(branches.rowCount, 2);
    const branchId = branches.rows[0].branch_id as string;
    const inactiveBranchId = branches.rows[1].branch_id as string;
    const actor = await admin.query(
      "SELECT user_id FROM user_account WHERE username = 'system'",
    );
    const actorId = actor.rows[0].user_id as string;

    const activeType = await admin.query(
      `INSERT INTO room_type (name, capacity, base_daily_rate)
       VALUES ('Availability Deluxe', 4, 20000)
       RETURNING room_type_id`,
    );
    const smallType = await admin.query(
      `INSERT INTO room_type (name, capacity, base_daily_rate)
       VALUES ('Availability Small', 2, 12000)
       RETURNING room_type_id`,
    );
    const inactiveType = await admin.query(
      `INSERT INTO room_type (name, capacity, base_daily_rate)
       VALUES ('Availability Inactive', 5, 25000)
       RETURNING room_type_id`,
    );
    const activeTypeId = activeType.rows[0].room_type_id as string;
    const smallTypeId = smallType.rows[0].room_type_id as string;
    const inactiveTypeId = inactiveType.rows[0].room_type_id as string;

    const activeAmenity = await admin.query(
      `INSERT INTO amenity (name, description)
       VALUES ('Availability Wi-Fi', 'Included')
       RETURNING amenity_id`,
    );
    const inactiveAmenity = await admin.query(
      `INSERT INTO amenity (name, description)
       VALUES ('Retired Availability Amenity', 'No longer advertised')
       RETURNING amenity_id`,
    );
    await admin.query(
      `INSERT INTO room_type_amenity (room_type_id, amenity_id)
       VALUES ($1, $2), ($1, $3)`,
      [
        activeTypeId,
        activeAmenity.rows[0].amenity_id,
        inactiveAmenity.rows[0].amenity_id,
      ],
    );
    await admin.query('UPDATE amenity SET active = false WHERE amenity_id = $1', [
      inactiveAmenity.rows[0].amenity_id,
    ]);

    async function createRoom(
      roomNumber: string,
      roomTypeId = activeTypeId,
      options: {
        branch?: string;
        condition?: 'READY' | 'CLEANING' | 'OUT_OF_SERVICE';
        active?: boolean;
      } = {},
    ): Promise<string> {
      const result = await admin.query(
        `INSERT INTO room (
           room_number, operational_status, active, branch_id, room_type_id
         ) VALUES ($1, $2, $3, $4, $5)
         RETURNING room_id`,
        [
          roomNumber,
          options.condition ?? 'READY',
          options.active ?? true,
          options.branch ?? branchId,
          roomTypeId,
        ],
      );
      return result.rows[0].room_id as string;
    }

    const readyFreeId = await createRoom('A-READY-FREE');
    await createRoom('B-CLEANING-FREE', activeTypeId, { condition: 'CLEANING' });
    await createRoom('C-OUT-OF-SERVICE', activeTypeId, { condition: 'OUT_OF_SERVICE' });
    await createRoom('D-INACTIVE-ROOM', activeTypeId, { active: false });
    await createRoom('E-SMALL-CAPACITY', smallTypeId);
    const blockedOverlapId = await createRoom('F-BLOCKED-OVERLAP');
    const blockAdjacentId = await createRoom('G-BLOCK-ADJACENT');
    const bookedOverlapId = await createRoom('H-BOOKED-OVERLAP');
    await createRoom('I-BOOKED-ADJACENT');
    await createRoom('J-CLOSED-HISTORY');
    await createRoom('K-CHECKED-IN-OVERLAP');
    await createRoom('L-INACTIVE-TYPE', inactiveTypeId);
    await createRoom('M-INACTIVE-BRANCH', activeTypeId, { branch: inactiveBranchId });

    await admin.query(
      `INSERT INTO room_block (start_date, end_date, reason, room_id, created_by)
       VALUES
         ('2027-06-02', '2027-06-03', 'Overlapping work', $1, $3),
         ('2027-06-04', '2027-06-05', 'Adjacent work', $2, $3)`,
      [blockedOverlapId, blockAdjacentId, actorId],
    );

    const guest = await admin.query(
      `INSERT INTO guest (full_name) VALUES ('Availability Guest') RETURNING guest_id`,
    );
    const booking = await admin.query(
      `INSERT INTO booking (booking_ref, booking_channel, guest_id, created_by)
       VALUES ($1, 'FRONT_DESK', $2, $3)
       RETURNING booking_id`,
      [`AVAIL-${randomBytes(4).toString('hex')}`, guest.rows[0].guest_id, actorId],
    );

    async function createAssignedLine(
      roomNumber: string,
      startDate: string,
      endDate: string,
      finalStatus: 'BOOKED' | 'CHECKED_IN' | 'CANCELLED',
    ): Promise<void> {
      const room = await admin.query('SELECT room_id FROM room WHERE room_number = $1', [
        roomNumber,
      ]);
      const line = await admin.query(
        `INSERT INTO booking_room_line (
           booking_id, stay_start_date, stay_end_date, guest_count, rate_snapshot
         ) VALUES ($1, $2, $3, 3, 20000)
         RETURNING line_id`,
        [booking.rows[0].booking_id, startDate, endDate],
      );
      await admin.query(
        `INSERT INTO booking_room_line_status_history (
           line_id, old_status, new_status, changed_by, reason
         ) VALUES ($1, NULL, 'BOOKED', $2, 'Availability test')`,
        [line.rows[0].line_id, actorId],
      );
      const assignment = await admin.query(
        `INSERT INTO booking_room_assignment (line_id, room_id)
         VALUES ($1, $2)
         RETURNING assignment_id`,
        [line.rows[0].line_id, room.rows[0].room_id],
      );

      if (finalStatus === 'CHECKED_IN') {
        await admin.query(
          `UPDATE booking_room_assignment
              SET occupied_from = CURRENT_TIMESTAMP
            WHERE assignment_id = $1`,
          [assignment.rows[0].assignment_id],
        );
        await admin.query(
          `UPDATE booking_room_line SET status = 'CHECKED_IN' WHERE line_id = $1`,
          [line.rows[0].line_id],
        );
        await admin.query(
          `INSERT INTO booking_room_line_status_history (
             line_id, old_status, new_status, changed_by, reason
           ) VALUES ($1, 'BOOKED', 'CHECKED_IN', $2, 'Availability test')`,
          [line.rows[0].line_id, actorId],
        );
      }

      if (finalStatus === 'CANCELLED') {
        await admin.query(
          `UPDATE booking_room_assignment
              SET unassigned_at = assigned_at + interval '1 second'
            WHERE assignment_id = $1`,
          [assignment.rows[0].assignment_id],
        );
        await admin.query(
          `UPDATE booking_room_line SET status = 'CANCELLED' WHERE line_id = $1`,
          [line.rows[0].line_id],
        );
        await admin.query(
          `INSERT INTO booking_room_line_status_history (
             line_id, old_status, new_status, changed_by, reason
           ) VALUES ($1, 'BOOKED', 'CANCELLED', $2, 'Availability test')`,
          [line.rows[0].line_id, actorId],
        );
      }
    }

    await createAssignedLine('H-BOOKED-OVERLAP', '2027-06-02', '2027-06-03', 'BOOKED');
    await createAssignedLine('I-BOOKED-ADJACENT', '2027-06-04', '2027-06-05', 'BOOKED');
    await createAssignedLine('J-CLOSED-HISTORY', '2027-06-02', '2027-06-03', 'CANCELLED');
    await createAssignedLine('K-CHECKED-IN-OVERLAP', '2027-06-01', '2027-06-02', 'CHECKED_IN');

    await admin.query('UPDATE room_type SET active = false WHERE room_type_id = $1', [
      inactiveTypeId,
    ]);
    await admin.query('UPDATE branch SET active = false WHERE branch_id = $1', [
      inactiveBranchId,
    ]);
    await admin.query('COMMIT');

    const functionRows = await admin.query(
      `SELECT room_number, operational_status, room_type_capacity, base_daily_rate::text, amenities
         FROM "${schema}".fn_available_rooms($1, '2027-06-01', '2027-06-04', 3, false, NULL)`,
      [branchId],
    );
    assert.deepEqual(
      functionRows.rows.map((row) => row.room_number).sort(),
      [
        'A-READY-FREE',
        'B-CLEANING-FREE',
        'G-BLOCK-ADJACENT',
        'I-BOOKED-ADJACENT',
        'J-CLOSED-HISTORY',
      ],
    );
    assert.equal(
      functionRows.rows.find((row) => row.room_number === 'A-READY-FREE').amenities.length,
      1,
    );
    assert.equal(
      functionRows.rows.find((row) => row.room_number === 'A-READY-FREE').amenities[0].name,
      'Availability Wi-Fi',
    );

    const immediateRows = await admin.query(
      `SELECT room_number
         FROM "${schema}".fn_available_rooms($1, '2027-06-01', '2027-06-04', 3, true, NULL)`,
      [branchId],
    );
    assert.ok(!immediateRows.rows.some((row) => row.room_number === 'B-CLEANING-FREE'));
    assert.ok(immediateRows.rows.some((row) => row.room_number === 'A-READY-FREE'));

    const smallCapacityRows = await admin.query(
      `SELECT room_number
         FROM "${schema}".fn_available_rooms($1, '2027-06-01', '2027-06-04', 2, false, $2)`,
      [branchId, smallTypeId],
    );
    assert.deepEqual(smallCapacityRows.rows.map((row) => row.room_number), ['E-SMALL-CAPACITY']);

    const inactiveBranchRows = await admin.query(
      `SELECT room_id
         FROM "${schema}".fn_available_rooms($1, '2027-06-01', '2027-06-04', 1, false, NULL)`,
      [inactiveBranchId],
    );
    assert.equal(inactiveBranchRows.rowCount, 0);

    await assert.rejects(
      admin.query(
        `SELECT *
           FROM "${schema}".fn_available_rooms($1, '2027-06-04', '2027-06-04', 1, false, NULL)`,
        [branchId],
      ),
      (error: any) => error.code === '22023',
    );

    const objects = await admin.query(
      `SELECT indexname
         FROM pg_indexes
        WHERE schemaname = $1
          AND indexname = 'booking_room_line_active_stay_idx'`,
      [schema],
    );
    assert.equal(objects.rowCount, 1);

    process.env.PG_SCHEMA = schema;
    const [{ default: availabilityRoutes }, { pool }] = await Promise.all([
      import('../src/routes/availabilityRoutes'),
      import('../src/db'),
    ]);
    applicationPool = pool;

    const app = express();
    app.use('/api', availabilityRoutes);
    server = await new Promise((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    async function api(query: string): Promise<{ status: number; json: any }> {
      const response = await fetch(`${baseUrl}/api/availability?${query}`);
      return { status: response.status, json: await response.json() };
    }

    const validQuery = new URLSearchParams({
      branchId,
      checkIn: '2027-06-01',
      checkOut: '2027-06-04',
      guestCount: '3',
      immediateCheckIn: 'false',
    }).toString();
    const apiResult = await api(validQuery);
    assert.equal(apiResult.status, 200);
    assert.equal(apiResult.json.meta.resultCount, 5);
    assert.equal(apiResult.json.data[0].branchId, branchId);
    assert.equal(apiResult.json.data[0].roomType.baseDailyRate, '20000.00');
    assert.ok(apiResult.json.data.some((room: any) => room.roomId === readyFreeId));

    const immediateResult = await api(`${validQuery.replace('immediateCheckIn=false', 'immediateCheckIn=true')}`);
    assert.equal(immediateResult.status, 200);
    assert.ok(
      !immediateResult.json.data.some((room: any) => room.operationalStatus === 'CLEANING'),
    );

    const noCapacity = await api(
      new URLSearchParams({
        branchId,
        checkIn: '2027-06-01',
        checkOut: '2027-06-04',
        guestCount: '5',
      }).toString(),
    );
    assert.equal(noCapacity.status, 200);
    assert.deepEqual(noCapacity.json.data, []);

    for (const invalidQuery of [
      new URLSearchParams({
        branchId,
        checkIn: '2027-06-04',
        checkOut: '2027-06-04',
        guestCount: '3',
      }).toString(),
      new URLSearchParams({
        branchId,
        checkIn: '2027-06-01',
        checkOut: '2027-06-04',
        guestCount: '0',
      }).toString(),
      new URLSearchParams({
        branchId: "' OR true --",
        checkIn: '2027-06-01',
        checkOut: '2027-06-04',
        guestCount: '3',
      }).toString(),
      `${validQuery}&unexpected=true`,
    ]) {
      const invalidResult = await api(invalidQuery);
      assert.equal(invalidResult.status, 400);
      assert.equal(invalidResult.json.error.code, 'VALIDATION_ERROR');
    }
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()));
      });
    }
    if (applicationPool) await applicationPool.end();
    if (originalPgSchema === undefined) delete process.env.PG_SCHEMA;
    else process.env.PG_SCHEMA = originalPgSchema;
    try { await admin.query('ROLLBACK'); } catch {}
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});
