export interface QueryResult<Row = Record<string, unknown>> {
  rows: Row[];
  rowCount?: number;
}

export interface TransactionClient {
  query<Row = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<QueryResult<Row>>;
}

export interface CheckInInput {
  lineId: string;
  actorId: string;
  stayDate?: string;
  schema?: string;
}

export interface CheckInResult {
  bookingId: string;
  lineId: string;
  assignmentId: string;
  roomId: string;
  checkedInAt: string;
}

export async function checkInRoomLine(
  client: TransactionClient,
  input: CheckInInput,
): Promise<CheckInResult> {
  if (!input.lineId || !input.actorId) {
    throw new Error('lineId and actorId are required.');
  }

  const stayDate = input.stayDate ?? new Date().toISOString().slice(0, 10);
  await client.query('BEGIN');

  try {
    if (input.schema !== undefined) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.schema)) {
        throw new Error('Invalid database schema.');
      }
      await client.query(`SET LOCAL search_path TO "${input.schema}", public`);
    }

    const lineReference = await client.query<{ booking_id: string }>(
      `SELECT booking_id
         FROM booking_room_line
        WHERE line_id = $1::uuid`,
      [input.lineId],
    );
    if (!lineReference.rows.length) {
      throw new Error('Booking room line not found.');
    }

    const bookingId = lineReference.rows[0].booking_id;
    const booking = await client.query<{ booking_id: string }>(
      `SELECT booking_id
         FROM booking
        WHERE booking_id = $1::uuid
        FOR UPDATE`,
      [bookingId],
    );
    if (!booking.rows.length) {
      throw new Error('Booking not found.');
    }

    const line = await client.query<{
      line_id: string;
      booking_id: string;
      stay_start_date: string;
      stay_end_date: string;
      status: string;
    }>(
      `SELECT line_id, booking_id, stay_start_date, stay_end_date, status
         FROM booking_room_line
        WHERE line_id = $1::uuid
        FOR UPDATE`,
      [input.lineId],
    );
    const selectedLine = line.rows[0];
    if (!selectedLine || selectedLine.booking_id !== bookingId) {
      throw new Error('Booking room line is no longer available.');
    }
    if (selectedLine.status !== 'BOOKED') {
      throw new Error('Only BOOKED room lines can be checked in.');
    }
    if (stayDate < selectedLine.stay_start_date || stayDate >= selectedLine.stay_end_date) {
      throw new Error('Check-in date is outside the room line stay.');
    }

    const assignment = await client.query<{ assignment_id: string; room_id: string }>(
      `SELECT assignment_id, room_id
         FROM booking_room_assignment
        WHERE line_id = $1::uuid
          AND unassigned_at IS NULL
        ORDER BY assignment_id
        FOR UPDATE`,
      [input.lineId],
    );
    if (assignment.rows.length !== 1) {
      throw new Error('A BOOKED room line must have exactly one open assignment.');
    }

    const openAssignment = assignment.rows[0];
    const room = await client.query<{ room_id: string; operational_status: string }>(
      `SELECT room_id, operational_status
         FROM room
        WHERE room_id = $1::uuid
        FOR UPDATE`,
      [openAssignment.room_id],
    );
    if (!room.rows.length) {
      throw new Error('Assigned room not found.');
    }
    if (room.rows[0].operational_status !== 'READY') {
      throw new Error('Assigned room must be READY for check-in.');
    }

    const checkedInAt = await client.query<{ now: string }>('SELECT CURRENT_TIMESTAMP AS now');
    const checkInInstant = checkedInAt.rows[0].now;

    await client.query(
      `UPDATE booking_room_line
          SET status = 'CHECKED_IN', updated_at = $2::timestamptz
        WHERE line_id = $1::uuid`,
      [input.lineId, checkInInstant],
    );
    await client.query(
      `UPDATE booking_room_assignment
          SET occupied_from = $2::timestamptz
        WHERE assignment_id = $1::uuid`,
      [openAssignment.assignment_id, checkInInstant],
    );
    await client.query(
      `INSERT INTO booking_room_line_status_history (
         line_id, old_status, new_status, changed_at, changed_by, reason
       ) VALUES ($1::uuid, 'BOOKED', 'CHECKED_IN', $2::timestamptz, $3::uuid, 'Check-in')`,
      [input.lineId, checkInInstant, input.actorId],
    );
    await client.query(
      `INSERT INTO audit_log (
         entity_name, entity_id, action, before_value, after_value, changed_at, user_id
       ) VALUES (
         'booking_room_line', $1, 'STATUS_CHANGE',
         '{"status":"BOOKED"}', '{"status":"CHECKED_IN"}', $2::timestamptz, $3::uuid
       )`,
      [input.lineId, checkInInstant, input.actorId],
    );

    await client.query('COMMIT');
    return {
      bookingId,
      lineId: input.lineId,
      assignmentId: openAssignment.assignment_id,
      roomId: openAssignment.room_id,
      checkedInAt: checkInInstant,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
