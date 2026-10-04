import { PoolClient, QueryResultRow } from 'pg';
import { pool } from '../db';

const bookingReadSchema = process.env.PG_SCHEMA;
if (bookingReadSchema && !/^[a-z_][a-z0-9_]*$/.test(bookingReadSchema)) {
  throw new Error('PG_SCHEMA must be a lowercase PostgreSQL identifier.');
}

type BookingChannel = 'DIRECT_ONLINE' | 'FRONT_DESK' | 'PHONE' | 'EMAIL';
type LineStatus = 'BOOKED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED' | 'NO_SHOW';
type RoomCondition = 'READY' | 'CLEANING' | 'OUT_OF_SERVICE';

interface BookingListRow extends QueryResultRow {
  booking_id: string;
  booking_ref: string;
  booking_channel: BookingChannel;
  created_at: Date;
  updated_at: Date;
  created_by: string;
  guest_id: string;
  guest_full_name: string;
  guest_email: string | null;
  guest_phone: string | null;
  line_count: number;
  booked_count: number;
  checked_in_count: number;
  checked_out_count: number;
  cancelled_count: number;
  no_show_count: number;
  first_stay_date: string;
  last_stay_date: string;
}

interface BookingHeaderRow extends QueryResultRow {
  booking_id: string;
  booking_ref: string;
  booking_channel: BookingChannel;
  created_at: Date;
  updated_at: Date;
  created_by: string;
  guest_id: string;
  guest_full_name: string;
  guest_email: string | null;
  guest_phone: string | null;
  guest_nic: string | null;
}

interface BookingLineRow extends QueryResultRow {
  line_id: string;
  stay_start_date: string;
  stay_end_date: string;
  guest_count: number;
  rate_snapshot: string;
  status: LineStatus;
  created_at: Date;
  updated_at: Date;
}

interface AssignmentRow extends QueryResultRow {
  assignment_id: string;
  line_id: string;
  room_id: string;
  room_number: string;
  branch_id: string;
  room_active: boolean;
  operational_status: RoomCondition;
  room_type_id: string;
  room_type_name: string;
  room_type_capacity: number;
  assigned_at: Date;
  unassigned_at: Date | null;
  occupied_from: Date | null;
  occupied_to: Date | null;
}

interface StatusHistoryRow extends QueryResultRow {
  history_id: string;
  line_id: string;
  old_status: LineStatus | null;
  new_status: LineStatus;
  changed_at: Date;
  changed_by: string;
  reason: string | null;
}

interface RevisionRow extends QueryResultRow {
  revision_id: string;
  line_id: string;
  old_stay_start_date: string;
  old_stay_end_date: string;
  old_guest_count: number;
  old_rate_snapshot: string;
  new_stay_start_date: string;
  new_stay_end_date: string;
  new_guest_count: number;
  new_rate_snapshot: string;
  changed_at: Date;
  changed_by: string;
  reason: string;
}

export interface BookingListInput {
  limit: number;
  offset: number;
}

export interface StaffBookingListItem {
  bookingId: string;
  bookingRef: string;
  bookingChannel: BookingChannel;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  guest: {
    guestId: string;
    fullName: string;
    email: string | null;
    phone: string | null;
  };
  lineSummary: {
    total: number;
    booked: number;
    checkedIn: number;
    checkedOut: number;
    cancelled: number;
    noShow: number;
    firstStayDate: string;
    lastStayDate: string;
  };
}

export interface StaffBookingListResult {
  items: StaffBookingListItem[];
  pagination: { limit: number; offset: number; returned: number };
}

export interface StaffBookingDetail {
  bookingId: string;
  bookingRef: string;
  bookingChannel: BookingChannel;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  guest: {
    guestId: string;
    fullName: string;
    email: string | null;
    phone: string | null;
    nic: string | null;
  };
  lines: Array<{
    lineId: string;
    checkIn: string;
    checkOut: string;
    guestCount: number;
    rateSnapshot: string;
    status: LineStatus;
    createdAt: string;
    updatedAt: string;
    assignments: Array<{
      assignmentId: string;
      roomId: string;
      roomNumber: string;
      branchId: string;
      roomActive: boolean;
      operationalStatus: RoomCondition;
      roomType: { roomTypeId: string; name: string; capacity: number };
      assignedAt: string;
      unassignedAt: string | null;
      occupiedFrom: string | null;
      occupiedTo: string | null;
      current: boolean;
    }>;
    statusHistory: Array<{
      historyId: string;
      oldStatus: LineStatus | null;
      newStatus: LineStatus;
      changedAt: string;
      changedBy: string;
      reason: string | null;
    }>;
    revisions: Array<{
      revisionId: string;
      oldValues: { checkIn: string; checkOut: string; guestCount: number; rateSnapshot: string };
      newValues: { checkIn: string; checkOut: string; guestCount: number; rateSnapshot: string };
      changedAt: string;
      changedBy: string;
      reason: string;
    }>;
  }>;
}

async function beginConsistentRead(client: PoolClient): Promise<void> {
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  if (bookingReadSchema) {
    await client.query(`SET LOCAL search_path TO "${bookingReadSchema}", public`);
  }
}

async function withReadClient<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await beginConsistentRead(client);
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

const fullyScopedBookingPredicate = `
  EXISTS (
    SELECT 1
      FROM booking_room_line AS scoped_line
      JOIN booking_room_assignment AS scoped_assignment
        ON scoped_assignment.line_id = scoped_line.line_id
      JOIN room AS scoped_room ON scoped_room.room_id = scoped_assignment.room_id
     WHERE scoped_line.booking_id = target_booking.booking_id
       AND scoped_room.branch_id = $1
  )
  AND NOT EXISTS (
    SELECT 1
      FROM booking_room_line AS other_line
      JOIN booking_room_assignment AS other_assignment
        ON other_assignment.line_id = other_line.line_id
      JOIN room AS other_room ON other_room.room_id = other_assignment.room_id
     WHERE other_line.booking_id = target_booking.booking_id
       AND other_room.branch_id <> $1
  )`;

export async function listStaffBookings(
  branchId: string,
  input: BookingListInput,
): Promise<StaffBookingListResult> {
  return withReadClient(async (client) => {
    const result = await client.query<BookingListRow>(
      `SELECT target_booking.booking_id,
              target_booking.booking_ref,
              target_booking.booking_channel,
              target_booking.created_at,
              target_booking.updated_at,
              target_booking.created_by,
              target_guest.guest_id,
              target_guest.full_name AS guest_full_name,
              target_guest.email AS guest_email,
              target_guest.phone AS guest_phone,
              count(line.line_id)::integer AS line_count,
              count(*) FILTER (WHERE line.status = 'BOOKED')::integer AS booked_count,
              count(*) FILTER (WHERE line.status = 'CHECKED_IN')::integer AS checked_in_count,
              count(*) FILTER (WHERE line.status = 'CHECKED_OUT')::integer AS checked_out_count,
              count(*) FILTER (WHERE line.status = 'CANCELLED')::integer AS cancelled_count,
              count(*) FILTER (WHERE line.status = 'NO_SHOW')::integer AS no_show_count,
              min(line.stay_start_date)::text AS first_stay_date,
              max(line.stay_end_date)::text AS last_stay_date
         FROM booking AS target_booking
         JOIN guest AS target_guest ON target_guest.guest_id = target_booking.guest_id
         JOIN booking_room_line AS line ON line.booking_id = target_booking.booking_id
        WHERE ${fullyScopedBookingPredicate}
        GROUP BY target_booking.booking_id, target_guest.guest_id
        ORDER BY target_booking.created_at DESC, target_booking.booking_id DESC
        LIMIT $2 OFFSET $3`,
      [branchId, input.limit, input.offset],
    );

    const items = result.rows.map((row): StaffBookingListItem => ({
      bookingId: row.booking_id,
      bookingRef: row.booking_ref,
      bookingChannel: row.booking_channel,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      createdBy: row.created_by,
      guest: {
        guestId: row.guest_id,
        fullName: row.guest_full_name,
        email: row.guest_email,
        phone: row.guest_phone,
      },
      lineSummary: {
        total: row.line_count,
        booked: row.booked_count,
        checkedIn: row.checked_in_count,
        checkedOut: row.checked_out_count,
        cancelled: row.cancelled_count,
        noShow: row.no_show_count,
        firstStayDate: row.first_stay_date,
        lastStayDate: row.last_stay_date,
      },
    }));

    return {
      items,
      pagination: { limit: input.limit, offset: input.offset, returned: items.length },
    };
  });
}

export async function getStaffBookingDetail(
  branchId: string,
  bookingId: string,
): Promise<StaffBookingDetail | null> {
  return withReadClient(async (client) => {
    const header = await client.query<BookingHeaderRow>(
      `SELECT target_booking.booking_id,
              target_booking.booking_ref,
              target_booking.booking_channel,
              target_booking.created_at,
              target_booking.updated_at,
              target_booking.created_by,
              target_guest.guest_id,
              target_guest.full_name AS guest_full_name,
              target_guest.email AS guest_email,
              target_guest.phone AS guest_phone,
              target_guest.nic AS guest_nic
         FROM booking AS target_booking
         JOIN guest AS target_guest ON target_guest.guest_id = target_booking.guest_id
        WHERE target_booking.booking_id = $2
          AND ${fullyScopedBookingPredicate}`,
      [branchId, bookingId],
    );
    const booking = header.rows[0];
    if (!booking) return null;

    const lineResult = await client.query<BookingLineRow>(
        `SELECT line_id,
                stay_start_date::text,
                stay_end_date::text,
                guest_count,
                rate_snapshot::text,
                status,
                created_at,
                updated_at
           FROM booking_room_line
          WHERE booking_id = $1
          ORDER BY stay_start_date, stay_end_date, line_id`,
        [bookingId],
      );
    const assignmentResult = await client.query<AssignmentRow>(
        `SELECT assignment.assignment_id,
                assignment.line_id,
                assignment.room_id,
                target_room.room_number,
                target_room.branch_id,
                target_room.active AS room_active,
                target_room.operational_status,
                target_type.room_type_id,
                target_type.name AS room_type_name,
                target_type.capacity AS room_type_capacity,
                assignment.assigned_at,
                assignment.unassigned_at,
                assignment.occupied_from,
                assignment.occupied_to
           FROM booking_room_assignment AS assignment
           JOIN booking_room_line AS line ON line.line_id = assignment.line_id
           JOIN room AS target_room ON target_room.room_id = assignment.room_id
           JOIN room_type AS target_type ON target_type.room_type_id = target_room.room_type_id
          WHERE line.booking_id = $1
          ORDER BY assignment.line_id, assignment.assigned_at, assignment.assignment_id`,
        [bookingId],
      );
    const statusResult = await client.query<StatusHistoryRow>(
        `SELECT history.history_id,
                history.line_id,
                history.old_status,
                history.new_status,
                history.changed_at,
                history.changed_by,
                history.reason
           FROM booking_room_line_status_history AS history
           JOIN booking_room_line AS line ON line.line_id = history.line_id
          WHERE line.booking_id = $1
          ORDER BY history.line_id, history.changed_at, history.history_id`,
        [bookingId],
      );
    const revisionResult = await client.query<RevisionRow>(
        `SELECT revision.revision_id,
                revision.line_id,
                revision.old_stay_start_date::text,
                revision.old_stay_end_date::text,
                revision.old_guest_count,
                revision.old_rate_snapshot::text,
                revision.new_stay_start_date::text,
                revision.new_stay_end_date::text,
                revision.new_guest_count,
                revision.new_rate_snapshot::text,
                revision.changed_at,
                revision.changed_by,
                revision.reason
           FROM booking_room_line_revision AS revision
           JOIN booking_room_line AS line ON line.line_id = revision.line_id
          WHERE line.booking_id = $1
          ORDER BY revision.line_id, revision.changed_at, revision.revision_id`,
        [bookingId],
      );

    const assignmentsByLine = new Map<string, AssignmentRow[]>();
    for (const assignment of assignmentResult.rows) {
      const values = assignmentsByLine.get(assignment.line_id) ?? [];
      values.push(assignment);
      assignmentsByLine.set(assignment.line_id, values);
    }
    const statusesByLine = new Map<string, StatusHistoryRow[]>();
    for (const history of statusResult.rows) {
      const values = statusesByLine.get(history.line_id) ?? [];
      values.push(history);
      statusesByLine.set(history.line_id, values);
    }
    const revisionsByLine = new Map<string, RevisionRow[]>();
    for (const revision of revisionResult.rows) {
      const values = revisionsByLine.get(revision.line_id) ?? [];
      values.push(revision);
      revisionsByLine.set(revision.line_id, values);
    }

    return {
      bookingId: booking.booking_id,
      bookingRef: booking.booking_ref,
      bookingChannel: booking.booking_channel,
      createdAt: booking.created_at.toISOString(),
      updatedAt: booking.updated_at.toISOString(),
      createdBy: booking.created_by,
      guest: {
        guestId: booking.guest_id,
        fullName: booking.guest_full_name,
        email: booking.guest_email,
        phone: booking.guest_phone,
        nic: booking.guest_nic,
      },
      lines: lineResult.rows.map((line) => ({
        lineId: line.line_id,
        checkIn: line.stay_start_date,
        checkOut: line.stay_end_date,
        guestCount: line.guest_count,
        rateSnapshot: line.rate_snapshot,
        status: line.status,
        createdAt: line.created_at.toISOString(),
        updatedAt: line.updated_at.toISOString(),
        assignments: (assignmentsByLine.get(line.line_id) ?? []).map((assignment) => ({
          assignmentId: assignment.assignment_id,
          roomId: assignment.room_id,
          roomNumber: assignment.room_number,
          branchId: assignment.branch_id,
          roomActive: assignment.room_active,
          operationalStatus: assignment.operational_status,
          roomType: {
            roomTypeId: assignment.room_type_id,
            name: assignment.room_type_name,
            capacity: assignment.room_type_capacity,
          },
          assignedAt: assignment.assigned_at.toISOString(),
          unassignedAt: assignment.unassigned_at?.toISOString() ?? null,
          occupiedFrom: assignment.occupied_from?.toISOString() ?? null,
          occupiedTo: assignment.occupied_to?.toISOString() ?? null,
          current: assignment.unassigned_at === null,
        })),
        statusHistory: (statusesByLine.get(line.line_id) ?? []).map((history) => ({
          historyId: history.history_id,
          oldStatus: history.old_status,
          newStatus: history.new_status,
          changedAt: history.changed_at.toISOString(),
          changedBy: history.changed_by,
          reason: history.reason,
        })),
        revisions: (revisionsByLine.get(line.line_id) ?? []).map((revision) => ({
          revisionId: revision.revision_id,
          oldValues: {
            checkIn: revision.old_stay_start_date,
            checkOut: revision.old_stay_end_date,
            guestCount: revision.old_guest_count,
            rateSnapshot: revision.old_rate_snapshot,
          },
          newValues: {
            checkIn: revision.new_stay_start_date,
            checkOut: revision.new_stay_end_date,
            guestCount: revision.new_guest_count,
            rateSnapshot: revision.new_rate_snapshot,
          },
          changedAt: revision.changed_at.toISOString(),
          changedBy: revision.changed_by,
          reason: revision.reason,
        })),
      })),
    };
  });
}
