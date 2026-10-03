import { Client } from 'pg';

export type InvoiceLineType =
  | 'ROOM'
  | 'SERVICE'
  | 'DISCOUNT'
  | 'PERCENT_SERVICE_CHARGE'
  | 'TAX'
  | 'CANCELLATION_FEE'
  | 'NO_SHOW_FEE'
  | 'LATE_CHECKOUT_FEE'
  | 'PRICE_ADJUSTMENT';

export interface CalculatedInvoiceLine {
  line_type: InvoiceLineType;
  booking_room_line_id: string | null;
  description: string;
  amount: number; // Signed numeric(14,2)
  is_provisional?: boolean;
}

export interface BillingPolicyData {
  billing_policy_id: string;
  tax_percent: number;
  service_charge_percent: number;
  max_discount_percent: number;
  cancellation_fee: number;
  no_show_fee: number;
  late_checkout_fee: number;
  no_show_grace_days: number;
  is_demo?: boolean;
}

export interface RoomLineData {
  line_id: string;
  stay_start_date: string | Date;
  stay_end_date: string | Date;
  rate_snapshot: number | string;
  status: 'BOOKED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED' | 'NO_SHOW';
}

export interface ServiceUsageData {
  usage_id: string;
  booking_room_line_id?: string | null;
  service_name: string;
  quantity: number | string;
  unit_price_snapshot: number | string;
  voided: boolean;
}

export interface PriceAdjustmentData {
  booking_room_line_id?: string | null;
  description: string;
  amount: number;
}

export interface CalculationOptions {
  approvedDiscount?: number;
  lateCheckoutLineIds?: string[];
  priceAdjustments?: PriceAdjustmentData[];
}

export interface CalculatedInvoiceSummary {
  lines: CalculatedInvoiceLine[];
  room_subtotal: number;
  service_subtotal: number;
  gross_subtotal: number; // G = room + service
  discount_amount: number; // D (positive absolute representation)
  max_allowed_discount: number;
  base_after_discount: number; // G - D
  service_charge_amount: number;
  tax_base: number; // G - D + service_charge
  tax_amount: number;
  flat_fees_subtotal: number;
  adjustments_subtotal: number;
  total_amount: number;
}

/**
 * Rounds a number to 2 decimal places, rounding half away from zero.
 * Matches PostgreSQL's numeric(14,2) rounding behavior.
 */
export function roundCurrency(val: number): number {
  if (isNaN(val) || !isFinite(val)) return 0;
  const sign = val < 0 ? -1 : 1;
  const abs = Math.abs(val);
  return sign * Number(Math.round(Number(abs + 'e2')) + 'e-2');
}

/**
 * Calculates reserved stay nights from stay_start_date to stay_end_date.
 * Per SRS §4.7.4 / Table 45: stay_end_date - stay_start_date; early departure does not reduce them.
 */
export function calculateBillableNights(startDate: string | Date, endDate: string | Date): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = end.getTime() - start.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) {
    throw new Error(`stay_end_date (${endDate}) must be greater than stay_start_date (${startDate})`);
  }
  return diffDays;
}

/**
 * Deterministically computes invoice lines adhering strictly to SRS §4.7.4 calculation order:
 * 1. Room lines: rate_snapshot * reserved nights for BOOKED/CHECKED_IN/CHECKED_OUT; CANCELLED/NO_SHOW room nights excluded.
 * 2. Non-void service usages: rounded quantity * unit_price_snapshot once.
 * 3. Gross G = sum(ROOM) + sum(SERVICE).
 * 4. Discount D: capped at max_discount_percent of G, never > G, represented as negative line.
 * 5. Percentage service charge on (G - D).
 * 6. Tax on (G - D + service_charge).
 * 7. Flat fees (cancellation, no-show, late checkout) and price adjustments added after tax.
 * 8. Total amount: sum of all signed lines.
 */
export function computeInvoiceBreakdown(
  policy: BillingPolicyData,
  roomLines: RoomLineData[],
  serviceUsages: ServiceUsageData[] = [],
  options: CalculationOptions = {},
): CalculatedInvoiceSummary {
  const lines: CalculatedInvoiceLine[] = [];
  let roomSubtotal = 0;
  let serviceSubtotal = 0;
  let feesSubtotal = 0;
  let adjustmentsSubtotal = 0;

  // 1. Room Lines
  for (const line of roomLines) {
    const nights = calculateBillableNights(line.stay_start_date, line.stay_end_date);
    const rate = roundCurrency(Number(line.rate_snapshot));

    if (line.status === 'BOOKED' || line.status === 'CHECKED_IN' || line.status === 'CHECKED_OUT') {
      const amount = roundCurrency(rate * nights);
      roomSubtotal = roundCurrency(roomSubtotal + amount);
      const isProvisional = line.status === 'BOOKED';
      const desc = isProvisional
        ? `Room charge (${nights} nights @ ${rate.toFixed(2)}) [PROVISIONAL]`
        : `Room charge (${nights} nights @ ${rate.toFixed(2)})`;

      lines.push({
        line_type: 'ROOM',
        booking_room_line_id: line.line_id,
        description: desc,
        amount,
        is_provisional: isProvisional,
      });
    } else if (line.status === 'CANCELLED') {
      // Room nights excluded; flat cancellation fee applied
      const fee = roundCurrency(Number(policy.cancellation_fee));
      if (fee > 0) {
        feesSubtotal = roundCurrency(feesSubtotal + fee);
        lines.push({
          line_type: 'CANCELLATION_FEE',
          booking_room_line_id: line.line_id,
          description: 'Cancellation fee',
          amount: fee,
        });
      }
    } else if (line.status === 'NO_SHOW') {
      // Room nights excluded; flat no-show fee applied
      const fee = roundCurrency(Number(policy.no_show_fee));
      if (fee > 0) {
        feesSubtotal = roundCurrency(feesSubtotal + fee);
        lines.push({
          line_type: 'NO_SHOW_FEE',
          booking_room_line_id: line.line_id,
          description: 'No-show fee',
          amount: fee,
        });
      }
    }

    // Check for approved late checkout fee on this line
    if (options.lateCheckoutLineIds && options.lateCheckoutLineIds.includes(line.line_id)) {
      const lateFee = roundCurrency(Number(policy.late_checkout_fee));
      if (lateFee > 0) {
        feesSubtotal = roundCurrency(feesSubtotal + lateFee);
        lines.push({
          line_type: 'LATE_CHECKOUT_FEE',
          booking_room_line_id: line.line_id,
          description: 'Late checkout fee',
          amount: lateFee,
        });
      }
    }
  }

  // 2. Service Usages (non-void only, rounded each once)
  for (const usage of serviceUsages) {
    if (usage.voided) continue;
    const qty = Number(usage.quantity);
    const unitPrice = roundCurrency(Number(usage.unit_price_snapshot));
    const amount = roundCurrency(qty * unitPrice);
    serviceSubtotal = roundCurrency(serviceSubtotal + amount);

    lines.push({
      line_type: 'SERVICE',
      booking_room_line_id: usage.booking_room_line_id || null,
      description: `Service: ${usage.service_name} (${qty} @ ${unitPrice.toFixed(2)})`,
      amount,
    });
  }

  // 3. Gross G = room + service
  const grossSubtotal = roundCurrency(roomSubtotal + serviceSubtotal);

  // 4. Discount D (capped at policy.max_discount_percent of G, and never > G)
  const requestedDiscount = roundCurrency(options.approvedDiscount ?? 0);
  const maxDiscountPct = Number(policy.max_discount_percent);
  const maxAllowedDiscount = roundCurrency(grossSubtotal * (maxDiscountPct / 100));
  const actualDiscount = roundCurrency(Math.min(requestedDiscount, maxAllowedDiscount, grossSubtotal));

  if (actualDiscount > 0) {
    lines.push({
      line_type: 'DISCOUNT',
      booking_room_line_id: null,
      description: `Approved discount (${actualDiscount.toFixed(2)})`,
      amount: -actualDiscount, // Negative invoice line per SRS §4.7.4
    });
  }

  const baseAfterDiscount = roundCurrency(grossSubtotal - actualDiscount);

  // 5. Percentage Service Charge on (G - D)
  const serviceChargePct = Number(policy.service_charge_percent);
  const serviceChargeAmount =
    serviceChargePct > 0 ? roundCurrency(baseAfterDiscount * (serviceChargePct / 100)) : 0;

  if (serviceChargeAmount > 0) {
    lines.push({
      line_type: 'PERCENT_SERVICE_CHARGE',
      booking_room_line_id: null,
      description: `Service charge (${serviceChargePct}%)`,
      amount: serviceChargeAmount,
    });
  }

  // 6. Tax on (G - D + service_charge)
  const taxPct = Number(policy.tax_percent);
  const taxBase = roundCurrency(baseAfterDiscount + serviceChargeAmount);
  const taxAmount = taxPct > 0 ? roundCurrency(taxBase * (taxPct / 100)) : 0;

  if (taxAmount > 0) {
    lines.push({
      line_type: 'TAX',
      booking_room_line_id: null,
      description: `Tax (${taxPct}%)`,
      amount: taxAmount,
    });
  }

  // 7. Price Adjustments (explicit post-check-in differences or negotiated adjustments)
  if (options.priceAdjustments && options.priceAdjustments.length > 0) {
    for (const adj of options.priceAdjustments) {
      const adjAmount = roundCurrency(adj.amount);
      adjustmentsSubtotal = roundCurrency(adjustmentsSubtotal + adjAmount);
      lines.push({
        line_type: 'PRICE_ADJUSTMENT',
        booking_room_line_id: adj.booking_room_line_id || null,
        description: adj.description,
        amount: adjAmount,
      });
    }
  }

  // 8. Total Amount = sum of all signed lines
  let grandTotal = 0;
  for (const line of lines) {
    grandTotal = roundCurrency(grandTotal + line.amount);
  }

  return {
    lines,
    room_subtotal: roomSubtotal,
    service_subtotal: serviceSubtotal,
    gross_subtotal: grossSubtotal,
    discount_amount: actualDiscount,
    max_allowed_discount: maxAllowedDiscount,
    base_after_discount: baseAfterDiscount,
    service_charge_amount: serviceChargeAmount,
    tax_base: taxBase,
    tax_amount: taxAmount,
    flat_fees_subtotal: feesSubtotal,
    adjustments_subtotal: adjustmentsSubtotal,
    total_amount: grandTotal,
  };
}

/**
 * Loads the booking, its linked billing policy from invoice, its room lines,
 * and service usages directly from PostgreSQL, and computes the deterministic invoice breakdown.
 */
export async function calculateBookingInvoiceFromDb(
  client: Client,
  bookingId: string,
  options: CalculationOptions = {},
): Promise<CalculatedInvoiceSummary> {
  // 1. Fetch invoice to get linked billing_policy_id
  const invoiceRes = await client.query(
    `SELECT invoice_id, billing_policy_id, status FROM invoice WHERE booking_id = $1`,
    [bookingId],
  );

  if (invoiceRes.rows.length === 0) {
    throw new Error(`No invoice found for booking ${bookingId}`);
  }

  const { billing_policy_id: policyId } = invoiceRes.rows[0];

  // 2. Fetch the linked billing policy
  const policyRes = await client.query(
    `SELECT billing_policy_id, tax_percent, service_charge_percent, max_discount_percent,
            cancellation_fee, no_show_fee, late_checkout_fee, no_show_grace_days, is_demo
       FROM billing_policy
      WHERE billing_policy_id = $1`,
    [policyId],
  );

  if (policyRes.rows.length === 0) {
    throw new Error(`Linked billing policy ${policyId} not found`);
  }

  const policy: BillingPolicyData = {
    billing_policy_id: policyRes.rows[0].billing_policy_id,
    tax_percent: Number(policyRes.rows[0].tax_percent),
    service_charge_percent: Number(policyRes.rows[0].service_charge_percent),
    max_discount_percent: Number(policyRes.rows[0].max_discount_percent),
    cancellation_fee: Number(policyRes.rows[0].cancellation_fee),
    no_show_fee: Number(policyRes.rows[0].no_show_fee),
    late_checkout_fee: Number(policyRes.rows[0].late_checkout_fee),
    no_show_grace_days: Number(policyRes.rows[0].no_show_grace_days),
    is_demo: policyRes.rows[0].is_demo,
  };

  // 3. Fetch room lines
  const linesRes = await client.query(
    `SELECT line_id, stay_start_date, stay_end_date, rate_snapshot, status
       FROM booking_room_line
      WHERE booking_id = $1
      ORDER BY stay_start_date, line_id`,
    [bookingId],
  );

  const roomLines: RoomLineData[] = linesRes.rows.map((row) => ({
    line_id: row.line_id,
    stay_start_date: row.stay_start_date,
    stay_end_date: row.stay_end_date,
    rate_snapshot: row.rate_snapshot,
    status: row.status,
  }));

  // 4. Fetch non-void service usages (if service_usage table exists)
  let serviceUsages: ServiceUsageData[] = [];
  const tableCheck = await client.query(
    `SELECT to_regclass('service_usage') AS su_table, to_regclass('service') AS s_table`,
  );

  if (tableCheck.rows[0].su_table && tableCheck.rows[0].s_table) {
    const usagesRes = await client.query(
      `SELECT su.usage_id, su.booking_room_line_id, su.quantity, su.unit_price_snapshot, su.voided,
              s.name AS service_name
         FROM service_usage su
         JOIN service s ON s.service_id = su.service_id
        WHERE su.booking_id = $1 AND su.voided IS FALSE
        ORDER BY su.used_at, su.usage_id`,
      [bookingId],
    );

    serviceUsages = usagesRes.rows.map((row) => ({
      usage_id: row.usage_id,
      booking_room_line_id: row.booking_room_line_id,
      service_name: row.service_name,
      quantity: row.quantity,
      unit_price_snapshot: row.unit_price_snapshot,
      voided: row.voided,
    }));
  }

  // 5. Compute and return breakdown
  return computeInvoiceBreakdown(policy, roomLines, serviceUsages, options);
}
