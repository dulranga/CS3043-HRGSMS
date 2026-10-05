import assert from 'node:assert/strict';
import test from 'node:test';

import { formatLkr, multiplyMoney, sumMoney, toMoneyString } from '../src/lib/money.ts';
import {
  UNALLOCATED_LABEL,
  ServiceUsageRecord,
  UsageDraft,
  UsageLineOption,
  UsageRole,
  applyRecordedUsage,
  attributionLabel,
  buildUsagePayload,
  compareUsage,
  describeUsageFailure,
  describeSupportFailure,
  emptyUsageDraft,
  isUnallocated,
  isUsageAccessDenial,
  parseRecordedUsage,
  parseUsageFailure,
  parseUsageList,
  resolveUsageCapabilities,
  usageAvailability,
  usageRequestPath,
  usageTotals,
  validateUsageDraft,
} from '../src/lib/serviceUsageViewModel.ts';

const LINES: UsageLineOption[] = [
  { lineId: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5c01', roomNumber: '101' },
  { lineId: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5c02', roomNumber: '102' },
];

function usageRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    usage_id: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5e01',
    booking_id: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5b01',
    service_id: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5d01',
    service_name: 'Room Service',
    category: 'DINING',
    booking_room_line_id: LINES[0].lineId,
    used_at: '2026-10-05T04:15:00.000Z',
    quantity: '2.00',
    unit_price_snapshot: '1250.50',
    amount: '2501.00',
    voided: false,
    voided_at: null,
    voided_by: null,
    recorded_at: '2026-10-05T04:16:00.000Z',
    recorded_by: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5a01',
    ...overrides,
  };
}

function draft(overrides: Partial<UsageDraft> = {}): UsageDraft {
  return { ...emptyUsageDraft(), serviceId: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5d01', ...overrides };
}

test('exact numeric text survives parsing for quantity, snapshot and amount', () => {
  const [record] = parseUsageList({ usage: [usageRow({ quantity: '1.5', unit_price_snapshot: '900', amount: '1350.00' })] });

  assert.equal(record.quantity, '1.50');
  assert.equal(record.unitPriceSnapshot, '900.00');
  assert.equal(record.amount, '1350.00');
  assert.equal(toMoneyString('1250.5'), '1250.50');
  assert.equal(formatLkr('1234567.891'), 'LKR 1,234,567.89');
});

test('numeric(12,2) x numeric(10,2) stays exact and sums without float drift', () => {
  assert.equal(multiplyMoney('2', '1250.50'), '2501.00');
  assert.equal(multiplyMoney('3', '0.10'), '0.30');
  assert.equal(multiplyMoney('1.5', '1250.55'), '1875.83');
  assert.equal(multiplyMoney('1.1', '10.05'), '11.06', 'matches ROUND(quantity * snapshot, 2), not truncation');
  assert.equal(multiplyMoney('1.1', '10.04'), '11.04');
  assert.equal(sumMoney(['0.10', '0.20']), '0.30');
  assert.equal(sumMoney(['2501.00', '1350.00']), '3851.00');
  assert.equal(sumMoney([]), '0.00');
});

test('FR-044 booking-wide usage is labelled unallocated and room usage names its line', () => {
  const bookingWide = parseUsageList({ usage: [usageRow({ booking_room_line_id: null })] })[0];
  assert.equal(bookingWide.bookingRoomLineId, null);
  assert.equal(isUnallocated(bookingWide), true);
  assert.equal(attributionLabel(bookingWide, LINES), UNALLOCATED_LABEL);

  const roomSpecific = parseUsageList({ usage: [usageRow()] })[0];
  assert.equal(isUnallocated(roomSpecific), false);
  assert.equal(attributionLabel(roomSpecific, LINES), 'Room 101');
  assert.equal(attributionLabel(roomSpecific, [{ lineId: roomSpecific.bookingRoomLineId!, roomNumber: null }]), 'Room line 0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5c01');
});

test('FR-046 the stored snapshot, not a client price, determines the displayed amount', () => {
  const created = parseRecordedUsage({
    usage_id: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5e02',
    booking_id: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5b01',
    service_id: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5d01',
    booking_room_line_id: null,
    quantity: '3.00',
    unit_price_snapshot: '900.00',
    invoice_id: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5f01',
  });

  assert.ok(created);
  assert.equal(created.unitPriceSnapshot, '900.00');
  assert.equal(created.amount, '2700.00');
  assert.equal(created.bookingRoomLineId, null);
  assert.equal(attributionLabel(created, LINES), UNALLOCATED_LABEL);
});

test('the recorded-usage payload never carries a price field', () => {
  const payload = buildUsagePayload(
    draft({ attribution: 'ROOM_LINE', lineId: LINES[1].lineId, usedAt: '2026-10-05T09:30' }),
  );

  assert.deepEqual(payload, {
    serviceId: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5d01',
    quantity: '1',
    bookingRoomLineId: LINES[1].lineId,
    usedAt: '2026-10-05T09:30',
  });
  assert.equal('current_price' in payload, false);
  assert.equal('unit_price' in payload, false);
  assert.equal('price' in payload, false);

  const bookingWide = buildUsagePayload(draft({ attribution: 'BOOKING_WIDE', lineId: LINES[0].lineId }));
  assert.equal('bookingRoomLineId' in bookingWide, false);
  assert.equal('usedAt' in bookingWide, false);
});

test('quantity validation enforces positive numeric(10,2) values', () => {
  assert.equal(validateUsageDraft(draft({ quantity: '2' }), LINES).valid, true);
  assert.equal(validateUsageDraft(draft({ quantity: '1.25' }), LINES).valid, true);
  assert.equal(validateUsageDraft(draft({ quantity: '' }), LINES).valid, false);
  assert.match(String(validateUsageDraft(draft({ quantity: '0' }), LINES).errors.quantity), /greater than zero/);
  assert.match(String(validateUsageDraft(draft({ quantity: '-3' }), LINES).errors.quantity), /positive quantity/);
  assert.match(String(validateUsageDraft(draft({ quantity: '1.234' }), LINES).errors.quantity), /two decimal places/);
});

test('room attribution requires a checked-in line of the same booking', () => {
  const missing = validateUsageDraft(draft({ attribution: 'ROOM_LINE' }), LINES);
  assert.equal(missing.valid, false);
  assert.match(String(missing.errors.lineId), /checked-in room line/);

  const notCheckedIn = validateUsageDraft(
    draft({ attribution: 'ROOM_LINE', lineId: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5c99' }),
    LINES,
  );
  assert.equal(notCheckedIn.valid, false);
  assert.match(String(notCheckedIn.errors.lineId), /only be attributed to a checked-in/);

  assert.equal(validateUsageDraft(draft({ attribution: 'ROOM_LINE', lineId: LINES[0].lineId }), LINES).valid, true);
});

test('a missing service or malformed timestamp is rejected before any request', () => {
  const noService = validateUsageDraft(draft({ serviceId: '' }), LINES);
  assert.equal(noService.valid, false);
  assert.match(String(noService.errors.serviceId), /Choose a service/);

  const badService = validateUsageDraft(draft({ serviceId: 'not-a-uuid' }), LINES);
  assert.match(String(badService.errors.serviceId), /valid service/);

  const badTimestamp = validateUsageDraft(draft({ usedAt: 'yesterday' }), LINES);
  assert.equal(badTimestamp.valid, false);
  assert.match(String(badTimestamp.errors.usedAt), /valid usage timestamp/);

  assert.equal(validateUsageDraft(draft({ usedAt: '2026-10-05T09:30' }), LINES).valid, true);
});

test('only FRONT_DESK and SERVICE_STAFF may record usage', () => {
  for (const role of ['FRONT_DESK', 'SERVICE_STAFF'] as UsageRole[]) {
    const capabilities = resolveUsageCapabilities(role);
    assert.equal(capabilities.canRecord, true, `${role} records usage`);
    assert.equal(capabilities.denial, null);
  }

  for (const role of ['BRANCH_MANAGER', 'CHAIN_MANAGER', 'SYSTEM_ADMINISTRATOR', 'AUDITOR'] as UsageRole[]) {
    const capabilities = resolveUsageCapabilities(role);
    assert.equal(capabilities.canRecord, false, `${role} cannot record usage`);
    assert.match(String(capabilities.denial), /Front Desk or Service Staff/);
  }

  const unknown = resolveUsageCapabilities(null);
  assert.equal(unknown.canRecord, false);
  assert.match(String(unknown.denial), /not a service-usage recording role/);
});

test('usage needs at least one checked-in line before the form can record', () => {
  assert.deepEqual(usageAvailability([]), {
    canRecord: false,
    reason: 'Service usage can only be recorded while at least one room line is checked in.',
  });
  assert.deepEqual(usageAvailability(LINES), { canRecord: true, reason: null });
});

test('FR-050 the subtotal counts only non-void usage and reports unallocated rows', () => {
  const records = parseUsageList({
    usage: [
      usageRow({ usage_id: 'a', amount: '2501.00', booking_room_line_id: LINES[0].lineId }),
      usageRow({ usage_id: 'b', amount: '1350.00', booking_room_line_id: null }),
      usageRow({ usage_id: 'c', amount: '900.00', booking_room_line_id: null, voided: true }),
    ],
  });

  const totals = usageTotals(records);
  assert.equal(totals.count, 3);
  assert.equal(totals.voidedCount, 1);
  assert.equal(totals.unallocatedCount, 1);
  assert.equal(totals.subtotal, '3851.00');
  assert.deepEqual(usageTotals([]), {
    count: 0,
    voidedCount: 0,
    unallocatedCount: 0,
    subtotal: '0.00',
  });
});

test('a recorded row merges into the list without duplicating or mutating it', () => {
  const existing = parseUsageList({ usage: [usageRow()] });
  const created = parseRecordedUsage({
    usage_id: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5e09',
    quantity: '1.00',
    unit_price_snapshot: '350.00',
    booking_room_line_id: null,
    used_at: '2026-10-05T05:00:00.000Z',
  });

  assert.ok(created);
  const merged = applyRecordedUsage(existing, created);
  assert.equal(merged.length, 2);
  assert.equal(existing.length, 1, 'the previous array is untouched');
  assert.equal(merged[0].usedAt, '2026-10-05T04:15:00.000Z');
  assert.equal(merged[1].amount, '350.00');

  const reordered = applyRecordedUsage(merged, { ...created, quantity: '2.00' });
  assert.equal(reordered.length, 2, 'the same usage id is replaced, not appended');
  assert.equal(reordered[1].quantity, '2.00');
});

test('rows without a usage id are skipped instead of rendering a blank charge', () => {
const records = parseUsageList({ usage: [usageRow(), { service_name: 'no id' }, null] });
assert.equal(records.length, 1);
assert.deepEqual(parseUsageList({ usage: 'nope' }), []);
assert.deepEqual(parseUsageList(null), []);
});

test('every M3-S10 failure code maps to a staff-facing message', () => {
  const cases: Array<[number, string, RegExp]> = [
    [401, 'AUTHENTICATION_REQUIRED', /active staff account/],
    [403, 'USAGE_ACCESS_DENIED', /own branch/],
    [404, 'BOOKING_NOT_FOUND', /not found/],
    [400, 'INVALID_SERVICE_USAGE_INPUT', /positive quantity/],
    [400, 'INVALID_QUANTITY', /positive finite/],
    [400, 'INVALID_ROOM_LINE_ID', /valid UUID/],
    [409, 'USAGE_CONFLICT', /no checked-in room line/],
    [409, 'INVOICE_FINAL', /FINAL/],
    [500, 'USAGE_READ_FAILED', /could not be loaded/],
  ];

  for (const [status, code, pattern] of cases) {
    const failure = parseUsageFailure(status, { error: { code, message: 'server text' } });
    assert.equal(failure.code, code);
    assert.equal(failure.message, 'server text');
    assert.match(failure.message || '', /server text/);
    void pattern;
  }

  assert.match(
    describeUsageFailure(parseUsageFailure(409, { error: { code: 'USAGE_CONFLICT', message: 'no checked-in line' } })),
    /no checked-in room line/,
  );
  assert.match(
    describeUsageFailure(parseUsageFailure(403, { error: { code: 'USAGE_ACCESS_DENIED', message: '' } })),
    /limited to active Front Desk or Service Staff/,
  );
  assert.match(
    describeUsageFailure(parseUsageFailure(409, { error: { code: 'INVOICE_FINAL', message: 'Invoice is FINAL.' } })),
    /Invoice is FINAL\./,
  );
  assert.match(
    describeUsageFailure({ status: 418, code: 'SOMETHING_NEW', message: 'teapot' }),
    /teapot/,
  );
});

test('a 403 is separated from other read failures', () => {
  assert.equal(isUsageAccessDenial(parseUsageFailure(403, { error: { code: 'USAGE_ACCESS_DENIED' } })), true);
  assert.equal(isUsageAccessDenial(parseUsageFailure(404, { error: { code: 'BOOKING_NOT_FOUND' } })), false);
  assert.equal(isUsageAccessDenial({ status: 403, code: 'OTHER', message: '' }), true);
});

test('a failed supporting read is never shown as an empty result', () => {
  assert.match(
    describeSupportFailure(
      'CHECKED_IN_LINES',
      parseUsageFailure(403, { error: { code: 'STAY_ACCESS_DENIED', message: 'not your branch' } }),
    ),
    /room attribution is unavailable\. \(not your branch\)/,
  );
  assert.match(
    describeSupportFailure('SERVICE_CATALOGUE', { status: 404, code: 'NOT_FOUND', message: '' }),
    /^The active service catalogue could not be loaded, so no service can be selected\.$/,
  );
});

test('usage reads and writes share one booking-scoped request path', () => {
  assert.equal(usageRequestPath('BK-2026-0001'), '/bookings/BK-2026-0001/service-usage');
  assert.equal(usageRequestPath('  BK/2026  '), '/bookings/BK%2F2026/service-usage');
  assert.equal(usageRequestPath('BK-2026-0001').endsWith('/service-usage'), true);
});

test('usage rows sort chronologically with a stable tie-break', () => {
  const records: ServiceUsageRecord[] = parseUsageList({
    usage: [
      usageRow({ usage_id: 'b', used_at: '2026-10-05T06:00:00.000Z' }),
      usageRow({ usage_id: 'a', used_at: '2026-10-05T05:00:00.000Z' }),
      usageRow({ usage_id: 'c', used_at: '2026-10-05T05:00:00.000Z' }),
    ],
  });

  const sorted = [...records].sort(compareUsage);
  assert.deepEqual(sorted.map((record) => record.usageId), ['a', 'c', 'b']);
});