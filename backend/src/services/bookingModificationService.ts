import { PoolClient, QueryResultRow } from 'pg';
import { pool } from '../db';

const modificationSchema = process.env.PG_SCHEMA;
if (modificationSchema && !/^[a-z_][a-z0-9_]*$/.test(modificationSchema)) {
  throw new Error('PG_SCHEMA must be a lowercase PostgreSQL identifier.');
}

export interface BookingLineValuesInput {
  roomId: string;
  checkIn: string;
  checkOut: string;
  guestCount: number;
  quotedRoomTypeId: string;
  quotedBaseDailyRate: string;
  reason: string;
}

export interface BookingLineChangeInput {
  checkIn: string;
  checkOut: string;
  guestCount: number;
  quotedRoomTypeId: string;
  quotedBaseDailyRate: string;
  reason: string;
}

export interface BookingRoomMoveInput {
  roomId: string;
  quotedRoomTypeId: string;
  quotedBaseDailyRate: string;
  reason: string;
  approvedPriceAdjustment: string | null;
}

interface MutationRow extends QueryResultRow {
  result_booking_id: string;
  result_line_id: string;
  result_assignment_id: string;
  result_invoice_id: string;
  result_invoice_total: string;
  result_balance: string;
  result_is_credit: boolean;
  result_credit_amount: string;
}

interface MutationDetailRow extends QueryResultRow {
  booking_id: string;
  line_id: string;
  stay_start_date: string;
  stay_end_date: string;
  guest_count: number;
  rate_snapshot: string;
  status: 'BOOKED' | 'CHECKED_IN';
  assignment_id: string;
  room_id: string;
  room_number: string;
  room_type_id: string;
  room_type_name: string;
  assigned_at: Date;
  occupied_from: Date | null;
}

export interface BookingLineMutationResult {
  bookingId: string;
  line: {
    lineId: string;
    checkIn: string;
    checkOut: string;
    guestCount: number;
    rateSnapshot: string;
    status: 'BOOKED' | 'CHECKED_IN';
    currentAssignment: {
      assignmentId: string;
      roomId: string;
      roomNumber: string;
      roomTypeId: string;
      roomTypeName: string;
      assignedAt: string;
      occupiedFrom: string | null;
    };
  };
  invoice: {
    invoiceId: string;
    total: string;
    balance: string;
    isCredit: boolean;
    creditAmount: string;
  };
}

async function begin(client: PoolClient): Promise<void> {
  await client.query('BEGIN');
  if (modificationSchema) {
    await client.query(`SET LOCAL search_path TO "${modificationSchema}"`);
  }
}

async function loadMutationResult(
  client: PoolClient,
  mutation: MutationRow,
): Promise<BookingLineMutationResult> {
  const detail = await client.query<MutationDetailRow>(
    `SELECT line.booking_id,
            line.line_id,
            line.stay_start_date::text,
            line.stay_end_date::text,
            line.guest_count,
            line.rate_snapshot::text,
            line.status,
            assignment.assignment_id,
            assignment.room_id,
            target_room.room_number,
            target_type.room_type_id,
            target_type.name AS room_type_name,
            assignment.assigned_at,
            assignment.occupied_from
       FROM booking_room_line AS line
       JOIN booking_room_assignment AS assignment
         ON assignment.line_id = line.line_id
        AND assignment.unassigned_at IS NULL
       JOIN room AS target_room ON target_room.room_id = assignment.room_id
       JOIN room_type AS target_type ON target_type.room_type_id = target_room.room_type_id
      WHERE line.line_id = $1
        AND assignment.assignment_id = $2`,
    [mutation.result_line_id, mutation.result_assignment_id],
  );
  const row = detail.rows[0];
  if (!row) throw new Error('Booking modification committed without a current line assignment.');

  return {
    bookingId: row.booking_id,
    line: {
      lineId: row.line_id,
      checkIn: row.stay_start_date,
      checkOut: row.stay_end_date,
      guestCount: row.guest_count,
      rateSnapshot: row.rate_snapshot,
      status: row.status,
      currentAssignment: {
        assignmentId: row.assignment_id,
        roomId: row.room_id,
        roomNumber: row.room_number,
        roomTypeId: row.room_type_id,
        roomTypeName: row.room_type_name,
        assignedAt: row.assigned_at.toISOString(),
        occupiedFrom: row.occupied_from?.toISOString() ?? null,
      },
    },
    invoice: {
      invoiceId: mutation.result_invoice_id,
      total: mutation.result_invoice_total,
      balance: mutation.result_balance,
      isCredit: mutation.result_is_credit,
      creditAmount: mutation.result_credit_amount,
    },
  };
}

async function executeMutation(
  query: string,
  values: unknown[],
): Promise<BookingLineMutationResult> {
  const client = await pool.connect();
  try {
    await begin(client);
    const result = await client.query<MutationRow>(query, values);
    const mutation = result.rows[0];
    if (!mutation) throw new Error('Booking modification returned no result.');
    const response = await loadMutationResult(client, mutation);
    await client.query('COMMIT');
    return response;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function addBookingRoomLine(
  actorId: string,
  branchId: string,
  bookingId: string,
  input: BookingLineValuesInput,
): Promise<BookingLineMutationResult> {
  return executeMutation(
    `SELECT *
       FROM sp_add_booking_room_line(
         $1::uuid, $2::uuid, $3::date, $4::date, $5::smallint,
         $6::uuid, $7::numeric, $8::uuid, $9::uuid, $10::varchar
       )`,
    [
      bookingId,
      input.roomId,
      input.checkIn,
      input.checkOut,
      input.guestCount,
      input.quotedRoomTypeId,
      input.quotedBaseDailyRate,
      actorId,
      branchId,
      input.reason,
    ],
  );
}

export async function changeBookingRoomLine(
  actorId: string,
  branchId: string,
  bookingId: string,
  lineId: string,
  input: BookingLineChangeInput,
): Promise<BookingLineMutationResult> {
  return executeMutation(
    `SELECT *
       FROM sp_change_booking_room_line(
         $1::uuid, $2::uuid, $3::date, $4::date, $5::smallint,
         $6::uuid, $7::numeric, $8::uuid, $9::uuid, $10::varchar
       )`,
    [
      bookingId,
      lineId,
      input.checkIn,
      input.checkOut,
      input.guestCount,
      input.quotedRoomTypeId,
      input.quotedBaseDailyRate,
      actorId,
      branchId,
      input.reason,
    ],
  );
}

export async function moveBookingRoomLine(
  actorId: string,
  branchId: string,
  bookingId: string,
  lineId: string,
  input: BookingRoomMoveInput,
): Promise<BookingLineMutationResult> {
  return executeMutation(
    `SELECT *
       FROM sp_move_booking_room_line(
         $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::numeric,
         $6::uuid, $7::uuid, $8::varchar, $9::numeric
       )`,
    [
      bookingId,
      lineId,
      input.roomId,
      input.quotedRoomTypeId,
      input.quotedBaseDailyRate,
      actorId,
      branchId,
      input.reason,
      input.approvedPriceAdjustment,
    ],
  );
}
