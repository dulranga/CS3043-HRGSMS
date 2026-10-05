import { PoolClient, QueryResultRow } from 'pg';
import { BillingPolicy, findEffectiveBillingPolicy } from '../billingPolicy';
import { pool } from '../db';

const onlineBookingSchema = process.env.PG_SCHEMA;
if (onlineBookingSchema && !/^[a-z_][a-z0-9_]*$/.test(onlineBookingSchema)) {
  throw new Error('PG_SCHEMA must be a lowercase PostgreSQL identifier.');
}

export class OnlineGuestAccessError extends Error {}
export class OnlineBookingPolicyUnavailableError extends Error {}
export class OnlineBookingInventoryConflictError extends Error {}

export interface OnlineBookingLineSelection {
  roomId: string;
  checkIn: string;
  checkOut: string;
  guestCount: number;
}

export interface ConfirmedOnlineBookingLineInput extends OnlineBookingLineSelection {
  quotedRoomTypeId: string;
  quotedBaseDailyRate: string;
}

export interface OnlineGuestBookingInput {
  branchId: string;
  quotedBillingPolicyId: string;
  lines: ConfirmedOnlineBookingLineInput[];
}

interface GuestAccountRow extends QueryResultRow {
  guest_id: string;
}

interface AvailableQuoteRow extends QueryResultRow {
  room_id: string;
  room_number: string;
  room_type_id: string;
  room_type_name: string;
  room_type_capacity: number;
  base_daily_rate: string;
}

interface BookingResultRow extends QueryResultRow {
  booking_id: string;
}

interface BookingHeaderRow extends QueryResultRow {
  booking_id: string;
  booking_ref: string;
  guest_id: string;
  created_by: string;
  created_at: Date;
  invoice_id: string;
  billing_policy_id: string;
  invoice_status: 'DRAFT';
  invoice_total: string;
}

interface BookingLineRow extends QueryResultRow {
  line_id: string;
  room_id: string;
  room_number: string;
  room_type_id: string;
  room_type_name: string;
  stay_start_date: string;
  stay_end_date: string;
  guest_count: number;
  rate_snapshot: string;
  status: 'BOOKED';
}

export interface OnlineBookingQuote {
  branchId: string;
  billingPolicy: {
    billingPolicyId: string;
    effectiveFrom: string;
    taxPercent: string;
    serviceChargePercent: string;
    maxDiscountPercent: string;
    cancellationFee: string;
    noShowFee: string;
    lateCheckoutFee: string;
    noShowGraceDays: number;
    createdAt: string;
  };
  lines: Array<{
    roomId: string;
    roomNumber: string;
    checkIn: string;
    checkOut: string;
    guestCount: number;
    roomTypeId: string;
    roomTypeName: string;
    capacity: number;
    baseDailyRate: string;
  }>;
}

export interface CreatedOnlineGuestBooking {
  bookingId: string;
  bookingRef: string;
  bookingChannel: 'DIRECT_ONLINE';
  guestId: string;
  createdBy: string;
  createdAt: string;
  invoice: {
    invoiceId: string;
    billingPolicyId: string;
    status: 'DRAFT';
    total: string;
  };
  lines: Array<{
    lineId: string;
    roomId: string;
    roomNumber: string;
    roomTypeId: string;
    roomTypeName: string;
    checkIn: string;
    checkOut: string;
    guestCount: number;
    rateSnapshot: string;
    status: 'BOOKED';
  }>;
}

async function begin(client: PoolClient, readOnly = false): Promise<void> {
  await client.query(readOnly ? 'BEGIN READ ONLY' : 'BEGIN');
  if (onlineBookingSchema) {
    // Exclude public so isolated tests cannot resolve duplicate objects from an
    // unrelated application schema on the same PostgreSQL database.
    await client.query(`SET LOCAL search_path TO "${onlineBookingSchema}"`);
  }
}

async function requireActiveGuestAccount(
  client: PoolClient,
  authenticatedUserId: string,
): Promise<string> {
  const result = await client.query<GuestAccountRow>(
    `SELECT guest_link.guest_id
       FROM user_account AS account
       JOIN guest_account AS guest_link ON guest_link.user_id = account.user_id
       JOIN guest AS linked_guest ON linked_guest.guest_id = guest_link.guest_id
      WHERE account.user_id = $1
        AND account.active
        AND linked_guest.active`,
    [authenticatedUserId],
  );
  if (result.rowCount === 0) {
    throw new OnlineGuestAccessError(
      'Online booking requires an active authenticated guest account.',
    );
  }
  return result.rows[0].guest_id;
}

function mapPolicy(policy: BillingPolicy): OnlineBookingQuote['billingPolicy'] {
  return {
    billingPolicyId: policy.billingPolicyId,
    effectiveFrom: policy.effectiveFrom,
    taxPercent: policy.taxPercent,
    serviceChargePercent: policy.serviceChargePercent,
    maxDiscountPercent: policy.maxDiscountPercent,
    cancellationFee: policy.cancellationFee,
    noShowFee: policy.noShowFee,
    lateCheckoutFee: policy.lateCheckoutFee,
    noShowGraceDays: policy.noShowGraceDays,
    createdAt: policy.createdAt.toISOString(),
  };
}

export async function quoteOnlineGuestBooking(
  authenticatedUserId: string,
  branchId: string,
  lines: OnlineBookingLineSelection[],
): Promise<OnlineBookingQuote> {
  const client = await pool.connect();
  try {
    await begin(client, true);
    await requireActiveGuestAccount(client, authenticatedUserId);
    const policy = await findEffectiveBillingPolicy(client, { production: true });
    if (!policy) {
      throw new OnlineBookingPolicyUnavailableError(
        'No approved billing policy is available for booking confirmation.',
      );
    }

    const quotedLines: OnlineBookingQuote['lines'] = [];
    for (const line of lines) {
      const result = await client.query<AvailableQuoteRow>(
        `SELECT room_id,
                room_number,
                room_type_id,
                room_type_name,
                room_type_capacity,
                base_daily_rate::text
           FROM fn_available_rooms($1, $2, $3, $4, false, NULL)
          WHERE room_id = $5`,
        [branchId, line.checkIn, line.checkOut, line.guestCount, line.roomId],
      );
      if (result.rowCount === 0) {
        throw new OnlineBookingInventoryConflictError(
          'A selected room is no longer available for its requested dates and guest count.',
        );
      }
      const row = result.rows[0];
      quotedLines.push({
        roomId: row.room_id,
        roomNumber: row.room_number,
        checkIn: line.checkIn,
        checkOut: line.checkOut,
        guestCount: line.guestCount,
        roomTypeId: row.room_type_id,
        roomTypeName: row.room_type_name,
        capacity: row.room_type_capacity,
        baseDailyRate: row.base_daily_rate,
      });
    }

    await client.query('COMMIT');
    return { branchId, billingPolicy: mapPolicy(policy), lines: quotedLines };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function createOnlineGuestBooking(
  authenticatedUserId: string,
  input: OnlineGuestBookingInput,
): Promise<CreatedOnlineGuestBooking> {
  const client = await pool.connect();
  try {
    await begin(client);
    const created = await client.query<BookingResultRow>(
      `SELECT booking_id
         FROM sp_create_online_guest_booking(
           $1::uuid,
           $2::uuid,
           $3::uuid,
           $4::jsonb
         )`,
      [
        authenticatedUserId,
        input.branchId,
        input.quotedBillingPolicyId,
        JSON.stringify(input.lines),
      ],
    );
    const bookingId = created.rows[0].booking_id;

    const header = await client.query<BookingHeaderRow>(
      `SELECT target_booking.booking_id,
              target_booking.booking_ref,
              target_booking.guest_id,
              target_booking.created_by,
              target_booking.created_at,
              target_invoice.invoice_id,
              target_invoice.billing_policy_id,
              target_invoice.status AS invoice_status,
              COALESCE(sum(invoice_line.amount), 0)::text AS invoice_total
         FROM booking AS target_booking
         JOIN invoice AS target_invoice
           ON target_invoice.booking_id = target_booking.booking_id
         LEFT JOIN invoice_line
           ON invoice_line.invoice_id = target_invoice.invoice_id
        WHERE target_booking.booking_id = $1
        GROUP BY target_booking.booking_id,
                 target_invoice.invoice_id,
                 target_invoice.billing_policy_id,
                 target_invoice.status`,
      [bookingId],
    );
    const lineRows = await client.query<BookingLineRow>(
      `SELECT line.line_id,
              assignment.room_id,
              target_room.room_number,
              target_type.room_type_id,
              target_type.name AS room_type_name,
              line.stay_start_date::text,
              line.stay_end_date::text,
              line.guest_count,
              line.rate_snapshot::text,
              line.status
         FROM booking_room_line AS line
         JOIN booking_room_assignment AS assignment
           ON assignment.line_id = line.line_id
          AND assignment.unassigned_at IS NULL
         JOIN room AS target_room ON target_room.room_id = assignment.room_id
         JOIN room_type AS target_type ON target_type.room_type_id = target_room.room_type_id
        WHERE line.booking_id = $1
        ORDER BY line.stay_start_date, target_room.room_number, line.line_id`,
      [bookingId],
    );
    await client.query('COMMIT');

    const booking = header.rows[0];
    return {
      bookingId: booking.booking_id,
      bookingRef: booking.booking_ref,
      bookingChannel: 'DIRECT_ONLINE',
      guestId: booking.guest_id,
      createdBy: booking.created_by,
      createdAt: booking.created_at.toISOString(),
      invoice: {
        invoiceId: booking.invoice_id,
        billingPolicyId: booking.billing_policy_id,
        status: booking.invoice_status,
        total: booking.invoice_total,
      },
      lines: lineRows.rows.map((line) => ({
        lineId: line.line_id,
        roomId: line.room_id,
        roomNumber: line.room_number,
        roomTypeId: line.room_type_id,
        roomTypeName: line.room_type_name,
        checkIn: line.stay_start_date,
        checkOut: line.stay_end_date,
        guestCount: line.guest_count,
        rateSnapshot: line.rate_snapshot,
        status: line.status,
      })),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
