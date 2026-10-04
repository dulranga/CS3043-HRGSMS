import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import express, { NextFunction, Request, Response } from 'express';
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
];

const migrations = migrationFiles.map((file) =>
  readFileSync(path.join(__dirname, '..', 'migrations', file), 'utf8'),
);

function requireTestRole(allowed: Set<string>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = req.header('x-test-role');
    if (!role) {
      res.status(401).json({ error: { code: 'AUTHENTICATION_REQUIRED' } });
      return;
    }
    if (!allowed.has(role)) {
      res.status(403).json({ error: { code: 'FORBIDDEN' } });
      return;
    }
    next();
  };
}

test('M2-S08 room and block API core enforces branch scope and reservation conflicts', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const originalPgUrl = process.env.PG_URL;
  const originalPgSchema = process.env.PG_SCHEMA;
  const admin = new Client({ connectionString: originalPgUrl });
  const schema = `m2_room_api_${randomBytes(8).toString('hex')}`;
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
    const actor = await admin.query(
      "SELECT user_id FROM user_account WHERE username = 'system'",
    );
    const primaryType = await admin.query(
      `INSERT INTO room_type (name, capacity, base_daily_rate)
       VALUES ($1, 3, 18000)
       RETURNING room_type_id`,
      [`Room API Primary ${randomBytes(3).toString('hex')}`],
    );
    const alternateType = await admin.query(
      `INSERT INTO room_type (name, capacity, base_daily_rate)
       VALUES ($1, 4, 23000)
       RETURNING room_type_id`,
      [`Room API Alternate ${randomBytes(3).toString('hex')}`],
    );
    const inactiveType = await admin.query(
      `INSERT INTO room_type (name, capacity, base_daily_rate, active)
       VALUES ($1, 2, 15000, false)
       RETURNING room_type_id`,
      [`Room API Inactive ${randomBytes(3).toString('hex')}`],
    );
    const otherBranchRoom = await admin.query(
      `INSERT INTO room (room_number, branch_id, room_type_id)
       VALUES ($1, $2, $3)
       RETURNING room_id`,
      [
        `OTHER-${randomBytes(3).toString('hex')}`,
        branches.rows[1].branch_id,
        primaryType.rows[0].room_type_id,
      ],
    );
    await admin.query('COMMIT');

    const branchOneId = branches.rows[0].branch_id as string;
    const branchTwoId = branches.rows[1].branch_id as string;
    const actorId = actor.rows[0].user_id as string;
    process.env.PG_SCHEMA = schema;

    const [{ createRoomInventoryRouter }, { pool }] = await Promise.all([
      import('../src/routes/roomInventoryRoutes'),
      import('../src/db'),
    ]);
    applicationPool = pool;

    const app = express();
    app.use(express.json());
    app.use('/api', createRoomInventoryRouter(
      {
        requireBranchRead: requireTestRole(new Set(['BRANCH_MANAGER', 'SERVICE_STAFF'])),
        requireBranchManager: requireTestRole(new Set(['BRANCH_MANAGER'])),
      },
      {
        branchId: (req) => req.header('x-test-branch-id') ?? '',
        actorId: (req) => req.header('x-test-actor-id') ?? '',
      },
    ));

    server = await new Promise((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    async function api(
      pathname: string,
      options: {
        method?: string;
        role?: string;
        branchId?: string;
        actorId?: string;
        body?: unknown;
      } = {},
    ): Promise<{ response: globalThis.Response; json: any }> {
      const headers: Record<string, string> = {};
      if (options.role) headers['x-test-role'] = options.role;
      if (options.branchId) headers['x-test-branch-id'] = options.branchId;
      if (options.actorId) headers['x-test-actor-id'] = options.actorId;
      if (options.body !== undefined) headers['content-type'] = 'application/json';
      const response = await fetch(`${baseUrl}${pathname}`, {
        method: options.method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      const text = await response.text();
      const contentType = response.headers.get("content-type") ?? "";
      const json =
        text.length === 0
          ? null
          : contentType.includes("application/json")
            ? JSON.parse(text)
            : text;
      return { response, json };
    }

    const noAuth = await api('/api/rooms', { branchId: branchOneId });
    assert.equal(noAuth.response.status, 401);

    for (const role of [
      'CHAIN_MANAGER',
      'FRONT_DESK',
      'SERVICE_STAFF',
      'SYSTEM_ADMINISTRATOR',
      'AUDITOR',
    ]) {
      const denied = await api('/api/rooms', {
        method: 'POST',
        role,
        branchId: branchOneId,
        actorId,
        body: {
          roomNumber: `DENIED-${role}`,
          roomTypeId: primaryType.rows[0].room_type_id,
        },
      });
      assert.equal(denied.response.status, 403, `${role} must not create rooms`);
    }

    const created = await api('/api/rooms', {
      method: 'POST',
      role: 'BRANCH_MANAGER',
      branchId: branchOneId,
      actorId,
      body: { roomNumber: 'A-101', roomTypeId: primaryType.rows[0].room_type_id },
    });
    assert.equal(created.response.status, 201);
    const roomId = created.json.data.roomId as string;
    assert.equal(created.json.data.branchId, branchOneId);
    assert.equal(created.json.data.operationalStatus, 'READY');

    const duplicate = await api('/api/rooms', {
      method: 'POST',
      role: 'BRANCH_MANAGER',
      branchId: branchOneId,
      actorId,
      body: { roomNumber: 'A-101', roomTypeId: primaryType.rows[0].room_type_id },
    });
    assert.equal(duplicate.response.status, 409);
    assert.equal(duplicate.json.error.code, 'ROOM_NUMBER_CONFLICT');

    const suppliedBranch = await api('/api/rooms', {
      method: 'POST',
      role: 'BRANCH_MANAGER',
      branchId: branchOneId,
      actorId,
      body: {
        roomNumber: 'A-102',
        roomTypeId: primaryType.rows[0].room_type_id,
        branchId: branchTwoId,
      },
    });
    assert.equal(suppliedBranch.response.status, 400);

    const inactiveTypeRoom = await api('/api/rooms', {
      method: 'POST',
      role: 'BRANCH_MANAGER',
      branchId: branchOneId,
      actorId,
      body: { roomNumber: 'A-103', roomTypeId: inactiveType.rows[0].room_type_id },
    });
    assert.equal(inactiveTypeRoom.response.status, 409);

    const branchList = await api('/api/rooms?search=A-101', {
      role: 'SERVICE_STAFF',
      branchId: branchOneId,
      actorId,
    });
    assert.equal(branchList.response.status, 200);
    assert.deepEqual(branchList.json.data.map((room: any) => room.roomId), [roomId]);

    const crossBranchRead = await api(
      `/api/rooms/${otherBranchRoom.rows[0].room_id}`,
      { role: 'BRANCH_MANAGER', branchId: branchOneId, actorId },
    );
    assert.equal(crossBranchRead.response.status, 404);

    const directConditionWrite = await api(`/api/rooms/${roomId}`, {
      method: 'PATCH',
      role: 'BRANCH_MANAGER',
      branchId: branchOneId,
      actorId,
      body: { operationalStatus: 'OUT_OF_SERVICE' },
    });
    assert.equal(directConditionWrite.response.status, 400);

    const missingConditionRoute = await api(`/api/rooms/${roomId}/condition`, {
      method: 'PATCH',
      role: 'SERVICE_STAFF',
      branchId: branchOneId,
      actorId,
      body: { operationalStatus: 'CLEANING' },
    });
    assert.equal(missingConditionRoute.response.status, 404);

    const invalidBlock = await api(`/api/rooms/${roomId}/blocks`, {
      method: 'POST',
      role: 'BRANCH_MANAGER',
      branchId: branchOneId,
      actorId,
      body: { startDate: '2027-05-03', endDate: '2027-05-03', reason: 'Invalid' },
    });
    assert.equal(invalidBlock.response.status, 400);

    const firstBlock = await api(`/api/rooms/${roomId}/blocks`, {
      method: 'POST',
      role: 'BRANCH_MANAGER',
      branchId: branchOneId,
      actorId,
      body: { startDate: '2027-05-10', endDate: '2027-05-12', reason: 'Painting' },
    });
    assert.equal(firstBlock.response.status, 201);
    const firstBlockId = firstBlock.json.data.blockId as string;
    assert.equal(firstBlock.json.data.createdBy, actorId);

    const changedBlock = await api(`/api/room-blocks/${firstBlockId}`, {
      method: 'PATCH',
      role: 'BRANCH_MANAGER',
      branchId: branchOneId,
      actorId,
      body: { endDate: '2027-05-13', reason: 'Painting and inspection' },
    });
    assert.equal(changedBlock.response.status, 200);
    assert.equal(changedBlock.json.data.endDate, '2027-05-13');

    const crossBranchBlockChange = await api(`/api/room-blocks/${firstBlockId}`, {
      method: 'PATCH',
      role: 'BRANCH_MANAGER',
      branchId: branchTwoId,
      actorId,
      body: { reason: 'Forbidden cross-branch change' },
    });
    assert.equal(crossBranchBlockChange.response.status, 404);

    const removedBlock = await api(`/api/room-blocks/${firstBlockId}`, {
      method: 'DELETE',
      role: 'BRANCH_MANAGER',
      branchId: branchOneId,
      actorId,
    });
    assert.equal(removedBlock.response.status, 204);

    await admin.query('BEGIN');
    await admin.query(`SET LOCAL search_path TO "${schema}", public`);
    const guest = await admin.query(
      `INSERT INTO guest (full_name) VALUES ('Room API Guest') RETURNING guest_id`,
    );
    const booking = await admin.query(
      `INSERT INTO booking (booking_ref, booking_channel, guest_id, created_by)
       VALUES ($1, 'FRONT_DESK', $2, $3)
       RETURNING booking_id, booking_ref`,
      [`ROOM-${randomBytes(4).toString('hex')}`, guest.rows[0].guest_id, actorId],
    );
    const line = await admin.query(
      `INSERT INTO booking_room_line (
         booking_id, stay_start_date, stay_end_date, guest_count, rate_snapshot
       ) VALUES ($1, '2027-06-01', '2027-06-04', 3, 18000)
       RETURNING line_id`,
      [booking.rows[0].booking_id],
    );
    await admin.query(
      `INSERT INTO booking_room_line_status_history (
         line_id, old_status, new_status, changed_by, reason
       ) VALUES ($1, NULL, 'BOOKED', $2, 'Room API test booking')`,
      [line.rows[0].line_id, actorId],
    );
    const assignment = await admin.query(
      `INSERT INTO booking_room_assignment (line_id, room_id)
       VALUES ($1, $2)
       RETURNING assignment_id`,
      [line.rows[0].line_id, roomId],
    );
    await admin.query('COMMIT');

    const blockConflict = await api(`/api/rooms/${roomId}/blocks`, {
      method: 'POST',
      role: 'BRANCH_MANAGER',
      branchId: branchOneId,
      actorId,
      body: { startDate: '2027-06-02', endDate: '2027-06-03', reason: 'Overlap' },
    });
    assert.equal(blockConflict.response.status, 409);
    assert.equal(blockConflict.json.error.affectedLines.length, 1);
    assert.equal(blockConflict.json.error.affectedLines[0].bookingRef, booking.rows[0].booking_ref);

    const deactivateConflict = await api(`/api/rooms/${roomId}`, {
      method: 'PATCH',
      role: 'BRANCH_MANAGER',
      branchId: branchOneId,
      actorId,
      body: { active: false },
    });
    assert.equal(deactivateConflict.response.status, 409);
    assert.equal(deactivateConflict.json.error.affectedLines[0].lineId, line.rows[0].line_id);

    const typeConflict = await api(`/api/rooms/${roomId}`, {
      method: 'PATCH',
      role: 'BRANCH_MANAGER',
      branchId: branchOneId,
      actorId,
      body: { roomTypeId: alternateType.rows[0].room_type_id },
    });
    assert.equal(typeConflict.response.status, 409);
    assert.equal(typeConflict.json.error.affectedLines.length, 1);

    const adjacentBlock = await api(`/api/rooms/${roomId}/blocks`, {
      method: 'POST',
      role: 'BRANCH_MANAGER',
      branchId: branchOneId,
      actorId,
      body: { startDate: '2027-06-04', endDate: '2027-06-05', reason: 'Adjacent work' },
    });
    assert.equal(adjacentBlock.response.status, 201);
    const adjacentBlockId = adjacentBlock.json.data.blockId as string;

    await admin.query('BEGIN');
    await admin.query(`SET LOCAL search_path TO "${schema}", public`);
    await admin.query(
      `UPDATE booking_room_assignment
          SET unassigned_at = assigned_at + interval '1 second'
        WHERE assignment_id = $1`,
      [assignment.rows[0].assignment_id],
    );
    await admin.query(
      `UPDATE booking_room_line
          SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
        WHERE line_id = $1`,
      [line.rows[0].line_id],
    );
    await admin.query(
      `INSERT INTO booking_room_line_status_history (
         line_id, old_status, new_status, changed_by, reason
       ) VALUES ($1, 'BOOKED', 'CANCELLED', $2, 'Room API test release')`,
      [line.rows[0].line_id, actorId],
    );
    await admin.query('COMMIT');

    const updatedRoom = await api(`/api/rooms/${roomId}`, {
      method: 'PATCH',
      role: 'BRANCH_MANAGER',
      branchId: branchOneId,
      actorId,
      body: {
        roomNumber: 'A-101-R',
        roomTypeId: alternateType.rows[0].room_type_id,
        active: false,
      },
    });
    assert.equal(updatedRoom.response.status, 200);
    assert.equal(updatedRoom.json.data.roomNumber, 'A-101-R');
    assert.equal(updatedRoom.json.data.active, false);
    assert.equal(updatedRoom.json.data.roomType.roomTypeId, alternateType.rows[0].room_type_id);

    await admin.query(
      `UPDATE "${schema}".room_type SET active = false WHERE room_type_id = $1`,
      [alternateType.rows[0].room_type_id],
    );
    const inactiveTypeReactivation = await api(`/api/rooms/${roomId}`, {
      method: 'PATCH',
      role: 'BRANCH_MANAGER',
      branchId: branchOneId,
      actorId,
      body: { active: true },
    });
    assert.equal(inactiveTypeReactivation.response.status, 409);

    const blockOnInactiveRoom = await api(`/api/rooms/${roomId}/blocks`, {
      method: 'POST',
      role: 'BRANCH_MANAGER',
      branchId: branchOneId,
      actorId,
      body: { startDate: '2027-07-01', endDate: '2027-07-02', reason: 'Inactive' },
    });
    assert.equal(blockOnInactiveRoom.response.status, 409);

    const deleteAdjacent = await api(`/api/room-blocks/${adjacentBlockId}`, {
      method: 'DELETE',
      role: 'BRANCH_MANAGER',
      branchId: branchOneId,
      actorId,
    });
    assert.equal(deleteAdjacent.response.status, 204);

    const history = await admin.query(
      `SELECT line.status,
              assignment.unassigned_at IS NOT NULL AS assignment_closed
         FROM "${schema}".booking_room_line AS line
         JOIN "${schema}".booking_room_assignment AS assignment
           ON assignment.line_id = line.line_id
        WHERE line.line_id = $1`,
      [line.rows[0].line_id],
    );
    assert.deepEqual(history.rows[0], { status: 'CANCELLED', assignment_closed: true });
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
