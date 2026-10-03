import { PoolClient, QueryResultRow } from 'pg';
import { pool } from '../db';

const inventorySchema = process.env.PG_SCHEMA;
if (inventorySchema && !/^[a-z_][a-z0-9_]*$/.test(inventorySchema)) {
  throw new Error('PG_SCHEMA must be a lowercase PostgreSQL identifier.');
}

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (inventorySchema) {
      await client.query(`SET LOCAL search_path TO "${inventorySchema}", public`);
    }
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export class InventoryValidationError extends Error {}
export class InventoryNotFoundError extends Error {}

export interface AffectedRoomLine {
  lineId: string;
  bookingId: string;
  bookingRef: string;
  status: 'BOOKED' | 'CHECKED_IN';
  stayStartDate: string;
  stayEndDate: string;
  guestCount: number;
}

export class InventoryConflictError extends Error {
  constructor(message: string, readonly affectedLines: AffectedRoomLine[]) {
    super(message);
  }
}

export interface InventoryFilters {
  search: string;
  active: boolean | null;
}

export interface CreateRoomInput {
  roomNumber: string;
  roomTypeId: string;
  active: boolean;
}

export interface UpdateRoomInput {
  roomNumber?: string;
  roomTypeId?: string;
  active?: boolean;
}

export interface CreateBlockInput {
  startDate: string;
  endDate: string;
  reason: string;
}

export interface UpdateBlockInput {
  startDate?: string;
  endDate?: string;
  reason?: string;
}

interface RoomRow extends QueryResultRow {
  room_id: string;
  room_number: string;
  operational_status: 'READY' | 'CLEANING' | 'OUT_OF_SERVICE';
  active: boolean;
  branch_id: string;
  room_type_id: string;
  room_type_name: string;
  room_type_capacity: number;
  room_type_active: boolean;
  block_count: number;
  active_assignment_count: number;
}

interface BlockRow extends QueryResultRow {
  block_id: string;
  room_id: string;
  start_date: string;
  end_date: string;
  reason: string;
  created_at: Date;
  created_by: string;
}

interface AffectedLineRow extends QueryResultRow {
  line_id: string;
  booking_id: string;
  booking_ref: string;
  status: 'BOOKED' | 'CHECKED_IN';
  stay_start_date: string;
  stay_end_date: string;
  guest_count: number;
}

export interface RoomDto {
  roomId: string;
  roomNumber: string;
  operationalStatus: 'READY' | 'CLEANING' | 'OUT_OF_SERVICE';
  active: boolean;
  branchId: string;
  roomType: {
    roomTypeId: string;
    name: string;
    capacity: number;
    active: boolean;
  };
  blockCount: number;
  activeAssignmentCount: number;
  affectedLines?: AffectedRoomLine[];
}

export interface RoomBlockDto {
  blockId: string;
  roomId: string;
  startDate: string;
  endDate: string;
  reason: string;
  createdAt: string;
  createdBy: string;
}

const ROOM_SELECT = `
  SELECT target_room.room_id,
         target_room.room_number,
         target_room.operational_status,
         target_room.active,
         target_room.branch_id,
         target_type.room_type_id,
         target_type.name AS room_type_name,
         target_type.capacity AS room_type_capacity,
         target_type.active AS room_type_active,
         (SELECT count(*)::integer
            FROM room_block AS block
           WHERE block.room_id = target_room.room_id) AS block_count,
         (SELECT count(*)::integer
            FROM booking_room_assignment AS assignment
            JOIN booking_room_line AS line ON line.line_id = assignment.line_id
           WHERE assignment.room_id = target_room.room_id
             AND assignment.unassigned_at IS NULL
             AND line.status IN ('BOOKED', 'CHECKED_IN')) AS active_assignment_count
    FROM room AS target_room
    JOIN room_type AS target_type ON target_type.room_type_id = target_room.room_type_id
`;

function mapAffectedLine(row: AffectedLineRow): AffectedRoomLine {
  return {
    lineId: row.line_id,
    bookingId: row.booking_id,
    bookingRef: row.booking_ref,
    status: row.status,
    stayStartDate: row.stay_start_date,
    stayEndDate: row.stay_end_date,
    guestCount: row.guest_count,
  };
}

function mapRoom(row: RoomRow, affectedLines?: AffectedRoomLine[]): RoomDto {
  return {
    roomId: row.room_id,
    roomNumber: row.room_number,
    operationalStatus: row.operational_status,
    active: row.active,
    branchId: row.branch_id,
    roomType: {
      roomTypeId: row.room_type_id,
      name: row.room_type_name,
      capacity: row.room_type_capacity,
      active: row.room_type_active,
    },
    blockCount: row.block_count,
    activeAssignmentCount: row.active_assignment_count,
    ...(affectedLines !== undefined && { affectedLines }),
  };
}

function mapBlock(row: BlockRow): RoomBlockDto {
  return {
    blockId: row.block_id,
    roomId: row.room_id,
    startDate: row.start_date,
    endDate: row.end_date,
    reason: row.reason,
    createdAt: row.created_at.toISOString(),
    createdBy: row.created_by,
  };
}

async function assertActiveBranch(client: PoolClient, branchId: string): Promise<void> {
  const branch = await client.query<{ active: boolean }>(
    'SELECT active FROM branch WHERE branch_id = $1 FOR KEY SHARE',
    [branchId],
  );
  if (branch.rowCount === 0) throw new InventoryNotFoundError('Branch was not found.');
  if (!branch.rows[0].active) {
    throw new InventoryConflictError('The branch is inactive.', []);
  }
}

async function assertActiveRoomType(client: PoolClient, roomTypeId: string): Promise<void> {
  const roomType = await client.query<{ active: boolean }>(
    'SELECT active FROM room_type WHERE room_type_id = $1 FOR KEY SHARE',
    [roomTypeId],
  );
  if (roomType.rowCount === 0) {
    throw new InventoryValidationError('roomTypeId must identify an existing room type.');
  }
  if (!roomType.rows[0].active) {
    throw new InventoryConflictError('The selected room type is inactive.', []);
  }
}

async function listAffectedLinesWith(
  client: PoolClient,
  roomId: string,
  startDate?: string,
  endDate?: string,
): Promise<AffectedRoomLine[]> {
  const result = await client.query<AffectedLineRow>(
    `SELECT line.line_id,
            line.booking_id,
            booking.booking_ref,
            line.status,
            line.stay_start_date::text,
            line.stay_end_date::text,
            line.guest_count
       FROM booking_room_assignment AS assignment
       JOIN booking_room_line AS line ON line.line_id = assignment.line_id
       JOIN booking ON booking.booking_id = line.booking_id
      WHERE assignment.room_id = $1
        AND assignment.unassigned_at IS NULL
        AND line.status IN ('BOOKED', 'CHECKED_IN')
        AND ($2::date IS NULL OR line.stay_start_date < $3::date)
        AND ($3::date IS NULL OR $2::date < line.stay_end_date)
      ORDER BY line.stay_start_date, booking.booking_ref, line.line_id`,
    [roomId, startDate ?? null, endDate ?? null],
  );
  return result.rows.map(mapAffectedLine);
}

async function getRoomWith(
  client: PoolClient,
  branchId: string,
  roomId: string,
  includeAffectedLines: boolean,
): Promise<RoomDto> {
  const result = await client.query<RoomRow>(
    `${ROOM_SELECT}
      WHERE target_room.branch_id = $1
        AND target_room.room_id = $2`,
    [branchId, roomId],
  );
  if (result.rowCount === 0) throw new InventoryNotFoundError('Room was not found.');
  const affectedLines = includeAffectedLines
    ? await listAffectedLinesWith(client, roomId)
    : undefined;
  return mapRoom(result.rows[0], affectedLines);
}

async function lockOwnedRoom(
  client: PoolClient,
  branchId: string,
  roomId: string,
): Promise<{ active: boolean; roomTypeId: string }> {
  const result = await client.query<{ active: boolean; room_type_id: string }>(
    `SELECT active, room_type_id
       FROM room
      WHERE branch_id = $1 AND room_id = $2
      FOR UPDATE`,
    [branchId, roomId],
  );
  if (result.rowCount === 0) throw new InventoryNotFoundError('Room was not found.');
  return { active: result.rows[0].active, roomTypeId: result.rows[0].room_type_id };
}

export async function listRooms(branchId: string, filters: InventoryFilters): Promise<RoomDto[]> {
  return inTransaction(async (client) => {
    const result = await client.query<RoomRow>(
      `${ROOM_SELECT}
        WHERE target_room.branch_id = $1
          AND ($2::boolean IS NULL OR target_room.active = $2)
          AND (
            $3 = ''
            OR strpos(lower(target_room.room_number), lower($3)) > 0
            OR strpos(lower(target_type.name), lower($3)) > 0
          )
        ORDER BY target_room.room_number, target_room.room_id`,
      [branchId, filters.active, filters.search],
    );
    return result.rows.map((row) => mapRoom(row));
  });
}

export async function getRoom(branchId: string, roomId: string): Promise<RoomDto> {
  return inTransaction((client) => getRoomWith(client, branchId, roomId, true));
}

export async function createRoom(
  branchId: string,
  input: CreateRoomInput,
): Promise<RoomDto> {
  return inTransaction(async (client) => {
    await assertActiveBranch(client, branchId);
    await assertActiveRoomType(client, input.roomTypeId);
    const inserted = await client.query<{ room_id: string }>(
      `INSERT INTO room (room_number, active, branch_id, room_type_id)
       VALUES ($1, $2, $3, $4)
       RETURNING room_id`,
      [input.roomNumber, input.active, branchId, input.roomTypeId],
    );
    return getRoomWith(client, branchId, inserted.rows[0].room_id, true);
  });
}

export async function updateRoom(
  branchId: string,
  roomId: string,
  patch: UpdateRoomInput,
): Promise<RoomDto> {
  return inTransaction(async (client) => {
    const current = await lockOwnedRoom(client, branchId, roomId);
    await assertActiveBranch(client, branchId);
    const affectedLines = await listAffectedLinesWith(client, roomId);

    if (patch.active === false && current.active && affectedLines.length > 0) {
      throw new InventoryConflictError(
        'Reassign or cancel the affected room lines before deactivating this room.',
        affectedLines,
      );
    }
    const changesRoomType =
      patch.roomTypeId !== undefined && patch.roomTypeId !== current.roomTypeId;
    if (changesRoomType) {
      if (affectedLines.length > 0) {
        throw new InventoryConflictError(
          'Reassign or cancel the affected room lines before changing this room type.',
          affectedLines,
        );
      }
    }
    if (changesRoomType || (patch.active === true && !current.active)) {
      await assertActiveRoomType(client, patch.roomTypeId ?? current.roomTypeId);
    }

    const assignments: string[] = [];
    const values: unknown[] = [];
    const setValue = (column: string, value: unknown) => {
      values.push(value);
      assignments.push(`${column} = $${values.length}`);
    };
    if (patch.roomNumber !== undefined) setValue('room_number', patch.roomNumber);
    if (patch.roomTypeId !== undefined) setValue('room_type_id', patch.roomTypeId);
    if (patch.active !== undefined) setValue('active', patch.active);
    values.push(roomId, branchId);
    await client.query(
      `UPDATE room
          SET ${assignments.join(', ')}
        WHERE room_id = $${values.length - 1}
          AND branch_id = $${values.length}`,
      values,
    );
    return getRoomWith(client, branchId, roomId, true);
  });
}

export async function listRoomBlocks(
  branchId: string,
  roomId: string,
): Promise<RoomBlockDto[]> {
  return inTransaction(async (client) => {
    await getRoomWith(client, branchId, roomId, false);
    const result = await client.query<BlockRow>(
      `SELECT block_id,
              room_id,
              start_date::text,
              end_date::text,
              reason,
              created_at,
              created_by
         FROM room_block
        WHERE room_id = $1
        ORDER BY start_date, end_date, block_id`,
      [roomId],
    );
    return result.rows.map(mapBlock);
  });
}

export async function createRoomBlock(
  branchId: string,
  roomId: string,
  actorId: string,
  input: CreateBlockInput,
): Promise<RoomBlockDto> {
  return inTransaction(async (client) => {
    const room = await lockOwnedRoom(client, branchId, roomId);
    await assertActiveBranch(client, branchId);
    if (!room.active) throw new InventoryConflictError('The room is inactive.', []);
    const affectedLines = await listAffectedLinesWith(
      client,
      roomId,
      input.startDate,
      input.endDate,
    );
    if (affectedLines.length > 0) {
      throw new InventoryConflictError(
        'Reassign or cancel the affected room lines before creating this room block.',
        affectedLines,
      );
    }
    const inserted = await client.query<BlockRow>(
      `INSERT INTO room_block (start_date, end_date, reason, room_id, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING block_id,
                 room_id,
                 start_date::text,
                 end_date::text,
                 reason,
                 created_at,
                 created_by`,
      [input.startDate, input.endDate, input.reason, roomId, actorId],
    );
    return mapBlock(inserted.rows[0]);
  });
}

export async function updateRoomBlock(
  branchId: string,
  blockId: string,
  patch: UpdateBlockInput,
): Promise<RoomBlockDto> {
  return inTransaction(async (client) => {
    const current = await client.query<BlockRow>(
      `SELECT block.block_id,
              block.room_id,
              block.start_date::text,
              block.end_date::text,
              block.reason,
              block.created_at,
              block.created_by
         FROM room_block AS block
         JOIN room AS target_room ON target_room.room_id = block.room_id
        WHERE block.block_id = $1
          AND target_room.branch_id = $2
        FOR UPDATE OF block, target_room`,
      [blockId, branchId],
    );
    if (current.rowCount === 0) throw new InventoryNotFoundError('Room block was not found.');
    await assertActiveBranch(client, branchId);

    const startDate = patch.startDate ?? current.rows[0].start_date;
    const endDate = patch.endDate ?? current.rows[0].end_date;
    if (endDate <= startDate) {
      throw new InventoryValidationError('endDate must be later than startDate.');
    }
    const affectedLines = await listAffectedLinesWith(
      client,
      current.rows[0].room_id,
      startDate,
      endDate,
    );
    if (affectedLines.length > 0) {
      throw new InventoryConflictError(
        'Reassign or cancel the affected room lines before changing this room block.',
        affectedLines,
      );
    }

    const updated = await client.query<BlockRow>(
      `UPDATE room_block
          SET start_date = $1,
              end_date = $2,
              reason = $3
        WHERE block_id = $4
        RETURNING block_id,
                  room_id,
                  start_date::text,
                  end_date::text,
                  reason,
                  created_at,
                  created_by`,
      [startDate, endDate, patch.reason ?? current.rows[0].reason, blockId],
    );
    return mapBlock(updated.rows[0]);
  });
}

export async function deleteRoomBlock(branchId: string, blockId: string): Promise<void> {
  return inTransaction(async (client) => {
    const current = await client.query(
      `SELECT block.block_id
         FROM room_block AS block
         JOIN room AS target_room ON target_room.room_id = block.room_id
        WHERE block.block_id = $1
          AND target_room.branch_id = $2
        FOR UPDATE OF block, target_room`,
      [blockId, branchId],
    );
    if (current.rowCount === 0) {
      throw new InventoryNotFoundError('Room block was not found.');
    }
    await assertActiveBranch(client, branchId);
    await client.query('DELETE FROM room_block WHERE block_id = $1', [blockId]);
  });
}
