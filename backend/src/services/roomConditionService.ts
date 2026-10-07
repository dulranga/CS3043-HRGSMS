import { DbClient } from './invoiceService.js';

// SRS FR-012 / §4.4.3: room.operational_status stores physical condition only.
// `AVAILABLE`, `RESERVED` and `OCCUPIED` stay derived and are never stored.
export const ROOM_CONDITIONS = ['READY', 'CLEANING', 'OUT_OF_SERVICE'] as const;
export type RoomCondition = (typeof ROOM_CONDITIONS)[number];

// SRS §6.1.4 Table 24: SERVICE_STAFF records own-branch physical room-condition
// changes and BRANCH_MANAGER handles own-branch physical rooms. FRONT_DESK owns
// reservations, check-in and checkout; a checkout may invoke the internal
// CLEANING transition inside its own transaction but is not granted a general
// condition-edit right. Audit of the change is the append-only
// `room_status_history` trail Member 3 owns (M2-S01 §audit ownership); this
// operation never invents an `audit_log` action for a physical condition.
const ROOM_CONDITION_EDIT_ROLES = new Set(['SERVICE_STAFF', 'BRANCH_MANAGER']);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCHEMA_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class RoomConditionError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, statusCode: number, message: string) {
    super(message);
    this.name = 'RoomConditionError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface RoomConditionChangeInput {
  roomId: string;
  condition: string;
  actorId: string;
  reason?: string;
  schema?: string;
}

export interface RoomConditionChangeResult {
  roomId: string;
  roomNumber: string | null;
  branchId: string;
  previousCondition: string;
  condition: string;
  changed: boolean;
  historyId: string | null;
  changedAt: string | null;
}

function normalized(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function accessDenied(message: string): RoomConditionError {
  return new RoomConditionError('ROOM_CONDITION_ACCESS_DENIED', 403, message);
}

async function applySearchPath(db: DbClient, schema?: string): Promise<void> {
  if (schema === undefined) {
    return;
  }
  if (!SCHEMA_PATTERN.test(schema)) {
    throw new RoomConditionError('INVALID_ROOM_CONDITION_INPUT', 400, 'Invalid database schema.');
  }
  await db.query(`SET LOCAL search_path TO "${schema}"`);
}

async function requireActiveOfficer(db: DbClient, actorId: string): Promise<{ roleName: string; branchId: string }> {
  const result = await db.query<{ role_name: string; branch_id: string }>(
    `SELECT role.role_name, officer.branch_id
       FROM officer
       JOIN role ON role.role_id = officer.role_id
       JOIN user_account ON user_account.user_id = officer.officer_id
      WHERE officer.officer_id = $1::uuid
        AND officer.active
        AND user_account.active`,
    [actorId],
  );
  const actor = result.rows[0];
  if (!actor?.role_name) {
    throw accessDenied('Only an active staff officer may change physical room condition.');
  }
  return { roleName: actor.role_name.trim().toUpperCase(), branchId: actor.branch_id.trim().toLowerCase() };
}

async function lockRoom(db: DbClient, roomId: string): Promise<{ room_id: string; room_number: string | null; branch_id: string; operational_status: string }> {
  const result = await db.query<{ room_id: string; room_number: string | null; branch_id: string; operational_status: string }>(
    `SELECT room.room_id, room.room_number, room.branch_id, room.operational_status
       FROM room
      WHERE room.room_id = $1::uuid
      FOR UPDATE`,
    [roomId],
  );
  const room = result.rows[0];
  if (!room) {
    throw new RoomConditionError('ROOM_NOT_FOUND', 404, `Room ${roomId} was not found.`);
  }
  return room;
}

async function activeAssignmentExists(db: DbClient, roomId: string): Promise<boolean> {
  const result = await db.query<{ exists: boolean }>(
    `SELECT EXISTS (
        SELECT 1
          FROM booking_room_assignment AS assignment
          JOIN booking_room_line AS line ON line.line_id = assignment.line_id
         WHERE assignment.room_id = $1::uuid
           AND assignment.unassigned_at IS NULL
           AND line.status IN ('BOOKED', 'CHECKED_IN')
     ) AS exists`,
    [roomId],
  );
  return result.rows[0]?.exists === true;
}

// M2-S06 owns the assignment/line guards; the function's own OUT_OF_SERVICE
// guard is still the authority, so its 23514 is mapped to the same conflict.
function mapConditionError(error: unknown): RoomConditionError {
  if (error instanceof RoomConditionError) {
    return error;
  }
  const code = (error as { code?: string } | null)?.code;
  const message = (error as { message?: string } | null)?.message || 'Physical room condition could not be changed.';
  if (code === '23514') {
    return new RoomConditionError('ROOM_CONDITION_CONFLICT', 409, message);
  }
  if (code === '23503' || code === '23502') {
    return new RoomConditionError('ROOM_NOT_FOUND', 404, message);
  }
  return new RoomConditionError('ROOM_CONDITION_CHANGE_FAILED', 500, message);
}

/**
 * Changes one room's physical condition as an authorized own-branch staff
 * operation (SRS FR-012, FR-014 and §6.1.4).
 *
 * The room row is locked first, then the actor is resolved from `officer` and
 * `role`: only an active BRANCH_MANAGER or SERVICE_STAFF of the room's own
 * branch may proceed. A repeated value is a no-op that writes no history, and
 * OUT_OF_SERVICE is refused while any current BOOKED/CHECKED_IN assignment
 * remains. `fn_set_room_condition` performs the atomic update and appends at
 * most one `room_status_history` row, for a real change only.
 */
export async function changeRoomCondition(
  db: DbClient,
  input: RoomConditionChangeInput,
): Promise<RoomConditionChangeResult> {
  const roomId = typeof input.roomId === 'string' ? input.roomId.trim() : '';
  const actorId = typeof input.actorId === 'string' ? input.actorId.trim() : '';
  const condition = normalized(input.condition);
  if (!UUID_PATTERN.test(roomId) || !UUID_PATTERN.test(actorId) || !(ROOM_CONDITIONS as readonly string[]).includes(condition)) {
    throw new RoomConditionError(
      'INVALID_ROOM_CONDITION_INPUT',
      400,
      'A room UUID, an actor UUID and one of READY, CLEANING or OUT_OF_SERVICE are required.',
    );
  }

  await db.query('BEGIN');
  try {
    await applySearchPath(db, input.schema);
    const room = await lockRoom(db, roomId);
    const actor = await requireActiveOfficer(db, actorId);
    if (!ROOM_CONDITION_EDIT_ROLES.has(actor.roleName)) {
      throw accessDenied('Only an active BRANCH_MANAGER or SERVICE_STAFF of this branch may change physical room condition.');
    }
    if (actor.branchId !== room.branch_id.trim().toLowerCase()) {
      throw accessDenied('Physical room condition changes are restricted to the actor\'s own branch.');
    }

    const previousCondition = room.operational_status.trim().toUpperCase();
    if (previousCondition === condition) {
      await db.query('COMMIT');
      return {
        roomId: room.room_id,
        roomNumber: room.room_number,
        branchId: room.branch_id,
        previousCondition,
        condition,
        changed: false,
        historyId: null,
        changedAt: null,
      };
    }
    if (condition === 'OUT_OF_SERVICE' && await activeAssignmentExists(db, roomId)) {
      throw new RoomConditionError(
        'ROOM_CONDITION_CONFLICT',
        409,
        'A room cannot become OUT_OF_SERVICE while a current BOOKED or CHECKED_IN assignment remains.',
      );
    }

    await db.query('SELECT fn_set_room_condition($1::uuid, $2::room_condition_enum, $3::uuid, $4::varchar)',
      [roomId, condition, actorId, input.reason ?? null]);
    const history = await db.query<{ room_history_id: string; changed_at: string }>(
      `SELECT room_history_id, changed_at
         FROM room_status_history
        WHERE room_id = $1::uuid
        ORDER BY changed_at DESC, room_history_id DESC
        LIMIT 1`,
      [roomId],
    );
    await db.query('COMMIT');
    const row = history.rows[0];
    return {
      roomId: room.room_id,
      roomNumber: room.room_number,
      branchId: room.branch_id,
      previousCondition,
      condition,
      changed: true,
      historyId: row?.room_history_id ?? null,
      changedAt: row?.changed_at ?? null,
    };
  } catch (error) {
    await db.query('ROLLBACK');
    throw mapConditionError(error);
  }
}

/**
 * The internal CLEANING transition Member 4's authorized checkout invokes inside
 * its larger transaction (SRS FR-060). It deliberately grants no direct
 * condition-edit authority: the caller's own checkout authorization decides the
 * actor, this entry point only requires an active officer row and delegates
 * the atomic update, active-assignment guards and `room_status_history`
 * append to `fn_set_room_condition`. It never begins or commits, so a checkout
 * rollback removes the condition change and its history row together.
 */
export async function checkoutCleaningTransition(
  db: DbClient,
  input: { roomId: string; actorId: string; reason?: string; schema?: string },
): Promise<RoomConditionChangeResult> {
  const roomId = typeof input.roomId === 'string' ? input.roomId.trim() : '';
  const actorId = typeof input.actorId === 'string' ? input.actorId.trim() : '';
  if (!UUID_PATTERN.test(roomId) || !UUID_PATTERN.test(actorId)) {
    throw new RoomConditionError('INVALID_ROOM_CONDITION_INPUT', 400, 'A room UUID and an actor UUID are required.');
  }

  try {
    await applySearchPath(db, input.schema);
    await requireActiveOfficer(db, actorId);
    const room = await lockRoom(db, roomId);
    const previousCondition = room.operational_status.trim().toUpperCase();
    if (previousCondition === 'CLEANING') {
      return {
        roomId: room.room_id,
        roomNumber: room.room_number,
        branchId: room.branch_id,
        previousCondition,
        condition: 'CLEANING',
        changed: false,
        historyId: null,
        changedAt: null,
      };
    }

    const reason = input.reason ?? 'Room released to cleaning after checkout';
    await db.query('SELECT fn_set_room_condition($1::uuid, $2::room_condition_enum, $3::uuid, $4::varchar)',
      [roomId, 'CLEANING', actorId, reason]);
    const history = await db.query<{ room_history_id: string; changed_at: string }>(
      `SELECT room_history_id, changed_at
         FROM room_status_history
        WHERE room_id = $1::uuid
        ORDER BY changed_at DESC, room_history_id DESC
        LIMIT 1`,
      [roomId],
    );
    const row = history.rows[0];
    return {
      roomId: room.room_id,
      roomNumber: room.room_number,
      branchId: room.branch_id,
      previousCondition,
      condition: 'CLEANING',
      changed: true,
      historyId: row?.room_history_id ?? null,
      changedAt: row?.changed_at ?? null,
    };
  } catch (error) {
    throw mapConditionError(error);
  }
}