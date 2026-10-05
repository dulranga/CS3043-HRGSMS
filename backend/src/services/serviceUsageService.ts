import { getBookingBalance, refreshDraftInvoice, DbClient } from './invoiceService';

export interface RecordServiceUsageInput {
  bookingId: string;
  serviceId: string;
  quantity: number | string;
  recordedBy: string;
  bookingRoomLineId?: string;
  usedAt?: string;
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
  const usedAt = input.usedAt ? new Date(input.usedAt) : new Date();
  if (Number.isNaN(usedAt.getTime())) {
    throw new Error('Service usage time must be a valid timestamp.');
  }
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
         booking_id, service_id, booking_room_line_id, used_at, quantity, unit_price_snapshot, recorded_by
       ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::timestamptz, $5, $6, $7::uuid)
       RETURNING usage_id, booking_id, service_id, booking_room_line_id, quantity, unit_price_snapshot`,
      [
        input.bookingId,
        input.serviceId,
        input.bookingRoomLineId || null,
        usedAt.toISOString(),
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

export interface VoidServiceUsageInput {
  usageId: string;
  bookingId?: string;
  voidedBy: string;
  reason?: string;
}

export interface VoidedServiceUsage {
  usageId: string;
  bookingId: string;
  serviceId: string;
  bookingRoomLineId: string | null;
  quantity: string;
  unitPriceSnapshot: string;
  voidedAmount: string;
  voidedAt: string;
  voidedBy: string;
  invoiceId: string;
  balance: {
    totalAmount: string;
    netPaid: string;
    balance: string;
    isCredit: boolean;
    creditAmount: string;
  };
}

// SRS §4.6.2/FR-048: a controlled, auditable reversal. The original row, its
// recording actor, quantity and price snapshot are retained; only the void
// metadata is added. Member 4's DRAFT bill is refreshed in the same
// transaction so the voided charge stops being billed, and any resulting
// credit is reported for Member 4's manual refund handling.
export async function voidServiceUsage(
  client: DbClient,
  input: VoidServiceUsageInput,
): Promise<VoidedServiceUsage> {
  if (!input.usageId || !input.voidedBy) {
    throw new Error('usageId and voidedBy are required.');
  }

  await client.query('BEGIN');

  try {
    const usageReference = await client.query<{ booking_id: string }>(
      `SELECT booking_id
         FROM service_usage
        WHERE usage_id = $1::uuid`,
      [input.usageId],
    );
    if (!usageReference.rows.length) {
      throw new Error('Service usage not found.');
    }
    const bookingId = usageReference.rows[0].booking_id;
    if (input.bookingId !== undefined && input.bookingId !== bookingId) {
      throw new Error('Service usage not found.');
    }

    await client.query(
      `SELECT booking_id
         FROM booking
        WHERE booking_id = $1::uuid
        FOR UPDATE`,
      [bookingId],
    );

    const invoice = await client.query<{ invoice_id: string; status: string }>(
      `SELECT invoice_id, status::text AS status
         FROM invoice
        WHERE booking_id = $1::uuid
        FOR UPDATE`,
      [bookingId],
    );
    if (invoice.rows[0]?.status === 'FINAL') {
      throw new Error('Invoice is FINAL. Service usage cannot be voided.');
    }

    const usage = await client.query<{
      usage_id: string;
      booking_id: string;
      service_id: string;
      booking_room_line_id: string | null;
      quantity: string;
      unit_price_snapshot: string;
      voided: boolean;
      recorded_at: string;
      recorded_by: string;
    }>(
      `SELECT usage_id, booking_id, service_id, booking_room_line_id, quantity,
              unit_price_snapshot, voided, recorded_at, recorded_by
         FROM service_usage
        WHERE usage_id = $1::uuid
        FOR UPDATE`,
      [input.usageId],
    );
    const target = usage.rows[0];
    if (!target) {
      throw new Error('Service usage not found.');
    }
    if (target.voided) {
      throw new Error('Service usage is already voided.');
    }

    const voidedAt = await client.query<{ instant: string }>(
      `SELECT instant FROM (SELECT clock_timestamp() AS instant) AS clock`,
    );
    const instant = voidedAt.rows[0].instant;
    const voidedAmount = await client.query<{ amount: string }>(
      `SELECT ROUND(quantity * unit_price_snapshot, 2) AS amount
         FROM service_usage
        WHERE usage_id = $1::uuid`,
      [input.usageId],
    );
    const amount = voidedAmount.rows[0].amount;

    await client.query(
      `UPDATE service_usage
          SET voided = true, voided_at = $2::timestamptz, voided_by = $3::uuid
        WHERE usage_id = $1::uuid`,
      [input.usageId, instant, input.voidedBy],
    );

    await client.query(
      `INSERT INTO audit_log (
         entity_name, entity_id, action, before_value, after_value, changed_at, user_id
       ) VALUES (
         'service_usage', $1, 'VOID',
         json_build_object('voided', false, 'amount', $2::numeric)::text,
         json_build_object(
           'voided', true, 'voided_at', $3::timestamptz, 'voided_by', $4::uuid,
           'reason', $5::text
         )::text,
         $3::timestamptz, $4::uuid
       )`,
      [input.usageId, amount, instant, input.voidedBy, input.reason || null],
    );

    const refreshed = await refreshDraftInvoice(client, bookingId, input.voidedBy);
    const balance = await getBookingBalance(client, bookingId);
    await client.query('COMMIT');

    const outstandingBalance = balance.balance;
    const isCredit = outstandingBalance < 0;

    return {
      usageId: target.usage_id,
      bookingId: target.booking_id,
      serviceId: target.service_id,
      bookingRoomLineId: target.booking_room_line_id,
      quantity: target.quantity,
      unitPriceSnapshot: target.unit_price_snapshot,
      voidedAmount: amount,
      voidedAt: instant,
      voidedBy: input.voidedBy,
      invoiceId: refreshed.invoiceId,
      balance: {
        totalAmount: String(balance.total_amount),
        netPaid: String(balance.net_paid),
        balance: String(outstandingBalance),
        isCredit,
        creditAmount: isCredit ? String(Math.abs(outstandingBalance)) : '0',
      },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
