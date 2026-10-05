import { refreshDraftInvoice, DbClient } from './invoiceService';

export interface RecordServiceUsageInput {
  bookingId: string;
  serviceId: string;
  quantity: number | string;
  recordedBy: string;
  bookingRoomLineId?: string;
}

export interface RecordedServiceUsage {
  usageId: string;
  bookingId: string;
  serviceId: string;
  bookingRoomLineId: string | null;
  quantity: string;
  unitPriceSnapshot: string;
  invoiceId: string;
}

function parseQuantity(value: number | string): number {
  const quantity = typeof value === 'string' ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('Service usage quantity must be a positive finite number.');
  }
  return quantity;
}

export async function recordServiceUsage(
  client: DbClient,
  input: RecordServiceUsageInput,
): Promise<RecordedServiceUsage> {
  if (!input.bookingId || !input.serviceId || !input.recordedBy) {
    throw new Error('bookingId, serviceId and recordedBy are required.');
  }

  const quantity = parseQuantity(input.quantity);
  await client.query('BEGIN');

  try {
    const booking = await client.query<{ booking_id: string }>(
      `SELECT booking_id
         FROM booking
        WHERE booking_id = $1::uuid
        FOR UPDATE`,
      [input.bookingId],
    );
    if (!booking.rows.length) {
      throw new Error('Booking not found.');
    }

    const invoice = await client.query<{ status: string }>(
      `SELECT status::text AS status
         FROM invoice
        WHERE booking_id = $1::uuid
        FOR UPDATE`,
      [input.bookingId],
    );
    if (invoice.rows[0]?.status === 'FINAL') {
      throw new Error('Invoice is FINAL. Service usage cannot be recorded.');
    }

    const service = await client.query<{ service_id: string; current_price: string; active: boolean }>(
      `SELECT service_id, current_price, active
         FROM service
        WHERE service_id = $1::uuid
        FOR UPDATE`,
      [input.serviceId],
    );
    if (!service.rows.length) {
      throw new Error('Service not found.');
    }
    if (!service.rows[0].active) {
      throw new Error('Inactive services cannot be recorded.');
    }

    if (input.bookingRoomLineId) {
      const line = await client.query<{ booking_id: string; status: string }>(
        `SELECT booking_id, status::text AS status
           FROM booking_room_line
          WHERE line_id = $1::uuid
          FOR UPDATE`,
        [input.bookingRoomLineId],
      );
      if (!line.rows.length) {
        throw new Error('Booking room line not found.');
      }
      if (line.rows[0].booking_id !== input.bookingId) {
        throw new Error('Service usage room line must belong to the same booking.');
      }
      if (line.rows[0].status !== 'CHECKED_IN') {
        throw new Error('Service usage room line must be CHECKED_IN.');
      }
    } else {
      const checkedInLine = await client.query(
        `SELECT line_id
           FROM booking_room_line
          WHERE booking_id = $1::uuid
            AND status = 'CHECKED_IN'
          LIMIT 1
          FOR UPDATE`,
        [input.bookingId],
      );
      if (!checkedInLine.rows.length) {
        throw new Error('Service usage requires a CHECKED_IN room line.');
      }
    }

    const usage = await client.query<{
      usage_id: string;
      booking_id: string;
      service_id: string;
      booking_room_line_id: string | null;
      quantity: string;
      unit_price_snapshot: string;
    }>(
      `INSERT INTO service_usage (
         booking_id, service_id, booking_room_line_id, quantity, unit_price_snapshot, recorded_by
       ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::uuid)
       RETURNING usage_id, booking_id, service_id, booking_room_line_id, quantity, unit_price_snapshot`,
      [
        input.bookingId,
        input.serviceId,
        input.bookingRoomLineId || null,
        quantity,
        service.rows[0].current_price,
        input.recordedBy,
      ],
    );

    const refreshed = await refreshDraftInvoice(client, input.bookingId, input.recordedBy);
    await client.query('COMMIT');

    return {
      usageId: usage.rows[0].usage_id,
      bookingId: usage.rows[0].booking_id,
      serviceId: usage.rows[0].service_id,
      bookingRoomLineId: usage.rows[0].booking_room_line_id,
      quantity: usage.rows[0].quantity,
      unitPriceSnapshot: usage.rows[0].unit_price_snapshot,
      invoiceId: refreshed.invoiceId,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
