import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RawInvoiceDetail,
  buildInvoiceDetailView,
  describeInvoiceError,
} from '../src/lib/invoiceViewModel.ts';

// Fixture helpers
function sampleInvoice(overrides: Partial<RawInvoiceDetail> = {}): RawInvoiceDetail {
  return {
    invoice_id: '01930000-0000-7000-8000-000000000001',
    booking_id: '01930000-0000-7000-8000-000000000010',
    billing_policy_id: '01930000-0000-7000-8000-000000000099',
    invoice_number: null,
    status: 'DRAFT',
    is_provisional: true,
    issued_at: null,
    created_at: '2026-10-05T08:00:00.000Z',
    lines: [
      {
        invoice_line_id: '01930000-0000-7000-8000-000000000101',
        invoice_id: '01930000-0000-7000-8000-000000000001',
        line_type: 'ROOM_NIGHT',
        booking_room_line_id: '01930000-0000-7000-8000-000000000021',
        description: 'Deluxe Room - 2 nights',
        amount: '20000.00',
      },
      {
        invoice_line_id: '01930000-0000-7000-8000-000000000102',
        invoice_id: '01930000-0000-7000-8000-000000000001',
        line_type: 'ROOM_NIGHT',
        booking_room_line_id: '01930000-0000-7000-8000-000000000022',
        description: 'Standard Room - 2 nights',
        amount: '12000.00',
      },
      {
        invoice_line_id: '01930000-0000-7000-8000-000000000103',
        invoice_id: '01930000-0000-7000-8000-000000000001',
        line_type: 'SERVICE',
        booking_room_line_id: '01930000-0000-7000-8000-000000000021',
        description: 'Room Dining Service',
        amount: '3500.00',
      },
      {
        invoice_line_id: '01930000-0000-7000-8000-000000000104',
        invoice_id: '01930000-0000-7000-8000-000000000001',
        line_type: 'DISCOUNT',
        booking_room_line_id: null,
        description: 'Promotional Discount (10%)',
        amount: '-3200.00',
      },
      {
        invoice_line_id: '01930000-0000-7000-8000-000000000105',
        invoice_id: '01930000-0000-7000-8000-000000000001',
        line_type: 'SERVICE_CHARGE',
        booking_room_line_id: null,
        description: 'Service Charge (10%)',
        amount: '3230.00',
      },
      {
        invoice_line_id: '01930000-0000-7000-8000-000000000106',
        invoice_id: '01930000-0000-7000-8000-000000000001',
        line_type: 'TAX',
        booking_room_line_id: null,
        description: 'Tourism Tax (12%)',
        amount: '4263.60',
      },
    ],
    summary: {
      total_amount: 39793.60,
      successful_payments: 20000.00,
      successful_refunds: 0.00,
      net_payments: 20000.00,
      outstanding_balance: 19793.60,
      credit_amount: 0.00,
      is_credit: false,
      is_settled: false,
      is_provisional: true,
    },
    ...overrides,
  };
}

test('two-room booking with partial checkout segregates lines by room and booking-wide', () => {
  const raw = sampleInvoice();
  const view = buildInvoiceDetailView(raw);

  assert.equal(view.roomLines.length, 2, 'Should group lines into 2 distinct room lines');

  const room1 = view.roomLines.find((r) => r.roomLineId === '01930000-0000-7000-8000-000000000021');
  const room2 = view.roomLines.find((r) => r.roomLineId === '01930000-0000-7000-8000-000000000022');

  assert.ok(room1, 'Room 1 must exist');
  assert.ok(room2, 'Room 2 must exist');

  // Room 1 has ROOM_NIGHT (20000) and SERVICE (3500) -> 23500
  assert.equal(room1.lines.length, 2);
  assert.equal(room1.subtotalFormatted, 'LKR 23,500.00');

  // Room 2 has ROOM_NIGHT (12000) -> 12000
  assert.equal(room2.lines.length, 1);
  assert.equal(room2.subtotalFormatted, 'LKR 12,000.00');

  // Booking-wide charges (Discount, Service charge, Tax)
  assert.equal(view.bookingWideLines.length, 3);
  assert.deepEqual(
    view.bookingWideLines.map((l) => l.lineType),
    ['DISCOUNT', 'SERVICE_CHARGE', 'TAX']
  );
});

test('lines respect SRS §4.7.4 hierarchy order', () => {
  const raw = sampleInvoice();
  const view = buildInvoiceDetailView(raw);

  // Line order check
  const types = view.lines.map((l) => l.lineType);
  const orderIndices = view.lines.map((l) => l.sortOrder);

  for (let i = 0; i < orderIndices.length - 1; i++) {
    assert.ok(
      orderIndices[i] <= orderIndices[i + 1],
      `Line order violated: ${types[i]} (rank ${orderIndices[i]}) came before ${types[i + 1]} (rank ${orderIndices[i + 1]})`
    );
  }
});

test('DRAFT vs FINAL invoice presentation states', () => {
  // DRAFT state
  const draftRaw = sampleInvoice({
    status: 'DRAFT',
    is_provisional: true,
    invoice_number: null,
    issued_at: null,
  });
  const draftView = buildInvoiceDetailView(draftRaw);
  assert.equal(draftView.isProvisional, true);
  assert.equal(draftView.status, 'DRAFT');
  assert.equal(draftView.invoiceNumber, null);
  assert.equal(draftView.issuedAt, null);

  // FINAL state
  const finalRaw = sampleInvoice({
    status: 'FINAL',
    is_provisional: false,
    invoice_number: 'INV-20261006-00001',
    issued_at: '2026-10-06T12:00:00.000Z',
    summary: {
      total_amount: 39793.60,
      successful_payments: 39793.60,
      successful_refunds: 0.00,
      net_payments: 39793.60,
      outstanding_balance: 0.00,
      credit_amount: 0.00,
      is_credit: false,
      is_settled: true,
      is_provisional: false,
    },
  });
  const finalView = buildInvoiceDetailView(finalRaw);
  assert.equal(finalView.isProvisional, false);
  assert.equal(finalView.status, 'FINAL');
  assert.equal(finalView.invoiceNumber, 'INV-20261006-00001');
  assert.ok(finalView.issuedAt instanceof Date);
  assert.equal(finalView.summary.isSettled, true);
  assert.equal(finalView.summary.outstandingBalanceFormatted, 'LKR 0.00');
});

test('unrefunded credit state formats cleanly with negative indicator', () => {
  const creditRaw = sampleInvoice({
    summary: {
      total_amount: 5000.00,
      successful_payments: 10000.00,
      successful_refunds: 0.00,
      net_payments: 10000.00,
      outstanding_balance: -5000.00,
      credit_amount: 5000.00,
      is_credit: true,
      is_settled: false,
      is_provisional: true,
    },
  });
  const creditView = buildInvoiceDetailView(creditRaw);
  assert.equal(creditView.summary.isCredit, true);
  assert.equal(creditView.summary.creditAmountFormatted, 'LKR 5,000.00');

  // Check deduction flag on discount lines
  const discountLine = creditView.lines.find((l) => l.lineType === 'DISCOUNT');
  assert.ok(discountLine, 'Discount line should exist');
  assert.equal(discountLine.isDeduction, true);
});

test('role-scope and authorization error descriptions match API behavior', () => {
  // 401 Unauthenticated
  const err401 = describeInvoiceError({
    ok: false,
    status: 401,
    code: 'AUTHENTICATION_REQUIRED',
    message: 'User authentication is required',
  });
  assert.match(err401, /Authentication required/i);

  // 403 Forbidden (cross-branch staff or unauthorized guest)
  const err403 = describeInvoiceError({
    ok: false,
    status: 403,
    code: 'CROSS_BRANCH_FORBIDDEN',
    message: 'Staff may not access invoices of another branch',
  });
  assert.match(err403, /Access denied/i);

  // 404 Not Found
  const err404 = describeInvoiceError({
    ok: false,
    status: 404,
    code: 'INVOICE_NOT_FOUND',
    message: 'No invoice exists for this booking',
  });
  assert.match(err404, /No invoice found/i);

  // Fallback generic error
  const errGeneric = describeInvoiceError({
    ok: false,
    status: 500,
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Database query timed out',
  });
  assert.equal(errGeneric, 'Database query timed out');
});
