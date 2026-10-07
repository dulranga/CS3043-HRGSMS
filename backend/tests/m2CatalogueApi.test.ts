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

const readableRoles = new Set([
  'CHAIN_MANAGER',
  'BRANCH_MANAGER',
  'FRONT_DESK',
  'SERVICE_STAFF',
  'SYSTEM_ADMINISTRATOR',
  'AUDITOR',
  'GUEST',
]);

function testReadAuthorization(req: Request, res: Response, next: NextFunction): void {
  const role = req.header('x-test-role');
  if (!role) {
    res.status(401).json({ error: { code: 'AUTHENTICATION_REQUIRED' } });
    return;
  }
  if (!readableRoles.has(role)) {
    res.status(403).json({ error: { code: 'FORBIDDEN' } });
    return;
  }
  next();
}

function testChainManagerAuthorization(req: Request, res: Response, next: NextFunction): void {
  const role = req.header('x-test-role');
  if (!role) {
    res.status(401).json({ error: { code: 'AUTHENTICATION_REQUIRED' } });
    return;
  }
  if (role !== 'CHAIN_MANAGER') {
    res.status(403).json({ error: { code: 'FORBIDDEN' } });
    return;
  }
  next();
}

test('M2-S07 catalogue API supports validated reads/writes and reservation conflicts', async () => {
  assert.ok(process.env.PG_URL, 'PG_URL must point to a PostgreSQL 18 test-capable database');
  const originalPgUrl = process.env.PG_URL;
  const originalPgSchema = process.env.PG_SCHEMA;
  const admin = new Client({ connectionString: originalPgUrl });
  const schema = `m2_catalogue_api_${randomBytes(8).toString('hex')}`;
  let server: ReturnType<express.Express['listen']> | undefined;
  let applicationPool: { end: () => Promise<void> } | undefined;

  await admin.connect();
  try {
    await admin.query('BEGIN');
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET LOCAL search_path TO "${schema}", public`);
    for (const migration of migrations) {
      await admin.query(migration);
    }
    await admin.query('COMMIT');

    process.env.PG_SCHEMA = schema;

    const [{ createCatalogueRouter }, { pool }] = await Promise.all([
      import('../src/routes/catalogueRoutes'),
      import('../src/db'),
    ]);
    applicationPool = pool;

    const app = express();
    app.use(express.json());
    app.use('/api', createCatalogueRouter({
      requireRead: testReadAuthorization,
      requireChainManager: testChainManagerAuthorization,
    }));

    server = await new Promise((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    async function api(
      pathname: string,
      options: { method?: string; role?: string; body?: unknown } = {},
    ): Promise<{ response: globalThis.Response; json: any }> {
      const headers: Record<string, string> = {};
      if (options.role) headers['x-test-role'] = options.role;
      if (options.body !== undefined) headers['content-type'] = 'application/json';
      const response = await fetch(`${baseUrl}${pathname}`, {
        method: options.method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      const json = await response.json();
      return { response, json };
    }

    const unauthenticatedRead = await api('/api/room-types');
    assert.equal(unauthenticatedRead.response.status, 401);

    for (const role of [
      'BRANCH_MANAGER',
      'FRONT_DESK',
      'SERVICE_STAFF',
      'SYSTEM_ADMINISTRATOR',
      'AUDITOR',
    ]) {
      const denied = await api('/api/amenities', {
        method: 'POST',
        role,
        body: { name: `Forbidden ${role}` },
      });
      assert.equal(denied.response.status, 403, `${role} must not edit the catalogue`);
    }

    const createdAmenity = await api('/api/amenities', {
      method: 'POST',
      role: 'CHAIN_MANAGER',
      body: { name: 'Ocean View', description: 'Upper-floor sea-facing room' },
    });
    assert.equal(createdAmenity.response.status, 201);
    const amenityId = createdAmenity.json.data.amenityId as string;
    assert.equal(createdAmenity.json.data.active, true);

    const createdRoomType = await api('/api/room-types', {
      method: 'POST',
      role: 'CHAIN_MANAGER',
      body: {
        name: 'Deluxe Sea View',
        capacity: 3,
        baseDailyRate: '18000.00',
        amenityIds: [amenityId],
      },
    });
    assert.equal(createdRoomType.response.status, 201);
    const roomTypeId = createdRoomType.json.data.roomTypeId as string;
    assert.equal(createdRoomType.json.data.baseDailyRate, '18000.00');
    assert.deepEqual(
      createdRoomType.json.data.amenities.map((amenity: any) => amenity.amenityId),
      [amenityId],
    );

    const guestSearch = await api('/api/room-types?search=sea', { role: 'GUEST' });
    assert.equal(guestSearch.response.status, 200);
    assert.equal(guestSearch.json.data.length, 1);
    assert.equal(guestSearch.json.data[0].roomTypeId, roomTypeId);

    const literalInjectionSearch = await api(
      `/api/room-types?search=${encodeURIComponent("' OR 1=1 --")}`,
      { role: 'AUDITOR' },
    );
    assert.equal(literalInjectionSearch.response.status, 200);
    assert.deepEqual(literalInjectionSearch.json.data, []);

    const badCapacity = await api('/api/room-types', {
      method: 'POST',
      role: 'CHAIN_MANAGER',
      body: { name: 'Invalid', capacity: 0, baseDailyRate: 1000 },
    });
    assert.equal(badCapacity.response.status, 400);
    assert.equal(badCapacity.json.error.code, 'VALIDATION_ERROR');

    const unknownField = await api(`/api/amenities/${amenityId}`, {
      method: 'PATCH',
      role: 'CHAIN_MANAGER',
      body: { label: 'Unsupported' },
    });
    assert.equal(unknownField.response.status, 400);

    const updatedAmenity = await api(`/api/amenities/${amenityId}`, {
      method: 'PATCH',
      role: 'CHAIN_MANAGER',
      body: { description: 'Panoramic sea-facing room' },
    });
    assert.equal(updatedAmenity.response.status, 200);
    assert.equal(updatedAmenity.json.data.description, 'Panoramic sea-facing room');

    await admin.query('BEGIN');
    await admin.query(`SET LOCAL search_path TO "${schema}", public`);
    const branch = await admin.query('SELECT branch_id FROM branch ORDER BY name LIMIT 1');
    const actor = await admin.query(
      "SELECT user_id FROM user_account WHERE username = 'system'",
    );
    const guest = await admin.query(
      `INSERT INTO guest (full_name, email)
       VALUES ('Catalogue Test Guest', 'catalogue@example.test')
       RETURNING guest_id`,
    );
    const room = await admin.query(
      `INSERT INTO room (room_number, branch_id, room_type_id)
       VALUES ($1, $2, $3)
       RETURNING room_id`,
      [`API-${randomBytes(3).toString('hex')}`, branch.rows[0].branch_id, roomTypeId],
    );

    const booking = await admin.query(
      `INSERT INTO booking (booking_ref, booking_channel, guest_id, created_by)
       VALUES ($1, 'FRONT_DESK', $2, $3)
       RETURNING booking_id, booking_ref`,
      [`CAT-${randomBytes(4).toString('hex')}`, guest.rows[0].guest_id, actor.rows[0].user_id],
    );
    const line = await admin.query(
      `INSERT INTO booking_room_line (
         booking_id, stay_start_date, stay_end_date, guest_count, rate_snapshot
       ) VALUES ($1, '2027-12-01', '2027-12-04', 3, 18000)
       RETURNING line_id`,
      [booking.rows[0].booking_id],
    );
    await admin.query(
      `INSERT INTO booking_room_line_status_history (
         line_id, old_status, new_status, changed_by, reason
       ) VALUES ($1, NULL, 'BOOKED', $2, 'Catalogue API test booking')`,
      [line.rows[0].line_id, actor.rows[0].user_id],
    );
    const assignment = await admin.query(
      `INSERT INTO booking_room_assignment (line_id, room_id)
       VALUES ($1, $2)
       RETURNING assignment_id`,
      [line.rows[0].line_id, room.rows[0].room_id],
    );
    await admin.query('COMMIT');

    const rateChange = await api(`/api/room-types/${roomTypeId}`, {
      method: 'PATCH',
      role: 'CHAIN_MANAGER',
      body: { baseDailyRate: '19500.00' },
    });
    assert.equal(rateChange.response.status, 200);
    assert.equal(rateChange.json.data.baseDailyRate, '19500.00');

    const preservedRate = await admin.query(
      `SELECT rate_snapshot::text
         FROM "${schema}".booking_room_line
        WHERE line_id = $1`,
      [line.rows[0].line_id],
    );
    assert.equal(preservedRate.rows[0].rate_snapshot, '18000.00');

    const capacityConflict = await api(`/api/room-types/${roomTypeId}`, {
      method: 'PATCH',
      role: 'CHAIN_MANAGER',
      body: { capacity: 2 },
    });
    assert.equal(capacityConflict.response.status, 409);
    assert.equal(capacityConflict.json.error.code, 'CATALOGUE_CONFLICT');
    assert.deepEqual(capacityConflict.json.error.affectedLines, [{
      lineId: line.rows[0].line_id, bookingId: booking.rows[0].booking_id,
      bookingRef: booking.rows[0].booking_ref,
      status: 'BOOKED', stayStartDate: '2027-12-01', stayEndDate: '2027-12-04', guestCount: 3,
    }]);

    const deactivationConflict = await api(`/api/room-types/${roomTypeId}`, {
      method: 'PATCH',
      role: 'CHAIN_MANAGER',
      body: { active: false },
    });
    assert.equal(deactivationConflict.response.status, 409);
    assert.deepEqual(deactivationConflict.json.error.affectedLines, capacityConflict.json.error.affectedLines);
    const unchangedType = await api(`/api/room-types/${roomTypeId}`, { role: 'CHAIN_MANAGER' });
    assert.equal(unchangedType.json.data.capacity, 3);
    assert.equal(unchangedType.json.data.active, true);
    const safeCapacity = await api(`/api/room-types/${roomTypeId}`, {
      method: 'PATCH', role: 'CHAIN_MANAGER', body: { capacity: 4 },
    });
    assert.equal(safeCapacity.response.status, 200);
    assert.equal(safeCapacity.json.data.capacity, 4);

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
       ) VALUES ($1, 'BOOKED', 'CANCELLED', $2, 'Catalogue API test release')`,
      [line.rows[0].line_id, actor.rows[0].user_id],
    );
    await admin.query('COMMIT');

    const deactivated = await api(`/api/room-types/${roomTypeId}`, {
      method: 'PATCH',
      role: 'CHAIN_MANAGER',
      body: { active: false },
    });
    assert.equal(deactivated.response.status, 200);
    assert.equal(deactivated.json.data.active, false);

    const activeList = await api('/api/room-types', { role: 'FRONT_DESK' });
    assert.equal(activeList.response.status, 200);
    assert.deepEqual(activeList.json.data, []);

    const historicalList = await api('/api/room-types?active=all', { role: 'AUDITOR' });
    assert.equal(historicalList.response.status, 200);
    assert.equal(historicalList.json.data[0].roomTypeId, roomTypeId);

    const history = await admin.query(
      `SELECT line.status,
              line.rate_snapshot::text,
              assignment.unassigned_at IS NOT NULL AS assignment_closed
         FROM "${schema}".booking_room_line AS line
         JOIN "${schema}".booking_room_assignment AS assignment
           ON assignment.line_id = line.line_id
        WHERE line.line_id = $1`,
      [line.rows[0].line_id],
    );
    assert.deepEqual(history.rows[0], {
      status: 'CANCELLED',
      rate_snapshot: '18000.00',
      assignment_closed: true,
    });
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()));
      });
    }
    if (applicationPool) await applicationPool.end();
    process.env.PG_URL = originalPgUrl;
    if (originalPgSchema === undefined) delete process.env.PG_SCHEMA;
    else process.env.PG_SCHEMA = originalPgSchema;
    try { await admin.query('ROLLBACK'); } catch {}
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});
