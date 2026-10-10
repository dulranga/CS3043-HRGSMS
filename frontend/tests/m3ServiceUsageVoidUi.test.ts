import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_VOID_REASON_LENGTH,
  ServiceUsageRecord,
  USAGE_RECORDING_ROLES,
  USAGE_VOID_ROLES,
  UsageRole,
  applyVoidedUsage,
  describeListDenial,
  describeVoidDenial,
  describeVoidFailure,
  emptyVoidDraft,
  isVoidRepeat,
  parseUsageFailure,
  parseUsageList,
  parseVoidResult,
  resolveVoidCapabilities,
  validateVoidDraft,
  voidRequestPath,
  voidRowState,
} from '../src/lib/serviceUsageViewModel.ts';

const LINES = [{ lineId: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5c01', roomNumber: '101' }];
const USAGE_ID = '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5e01';
const OTHER_USAGE_ID = '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5e02';
const MANAGER_ID = '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5a09';

function usageRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    usage_id: USAGE_ID,
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

function records(...rows: Array<Record<string, unknown>>): ServiceUsageRecord[] {
  return parseUsageList({ usage: rows.length > 0 ? rows : [usageRow()] });
}

test('M3-S11 void authority is the exact inverse of the recording authority', () => {
  for (const role of ['BRANCH_MANAGER', 'CHAIN_MANAGER', 'SYSTEM_ADMINISTRATOR'] as UsageRole[]) {
    const capabilities = resolveVoidCapabilities(role);
    assert.equal(capabilities.canVoid, true, `${role} may void`);
    assert.equal(capabilities.denial, null);
    assert.equal(
      (USAGE_RECORDING_ROLES as ReadonlyArray<UsageRole>).includes(role),
      false,
      `${role} must not also be a recording role`,
    );
  }

  for (const role of ['FRONT_DESK', 'SERVICE_STAFF', 'AUDITOR'] as UsageRole[]) {
    const capabilities = resolveVoidCapabilities(role);
    assert.equal(capabilities.canVoid, false, `${role} may not void`);
    assert.match(String(capabilities.denial), /Branch Manager/);
  }

  const unknown = resolveVoidCapabilities(null);
  assert.equal(unknown.canVoid, false);
  assert.match(String(unknown.denial), /not a service-usage void authority/);

  assert.deepEqual([...USAGE_VOID_ROLES], ['BRANCH_MANAGER', 'CHAIN_MANAGER', 'SYSTEM_ADMINISTRATOR']);
});

test('the denial copy names the signed-in role only when there is one', () => {
  assert.match(describeVoidDenial('FRONT_DESK'), /Signed in as FRONT_DESK\./);
  assert.doesNotMatch(describeVoidDenial(null), /Signed in as/);
});

test('a row is voidable only by a void authority while it is still billable', () => {
  const billable = records()[0];
  const manager = resolveVoidCapabilities('BRANCH_MANAGER');
  const recorder = resolveVoidCapabilities('SERVICE_STAFF');

  assert.deepEqual(voidRowState(billable, manager), { canVoid: true, reason: null });
  const forbidden = voidRowState(billable, recorder);
  assert.equal(forbidden.canVoid, false);
  assert.match(String(forbidden.reason), /Branch Manager/);

  const voided = records(usageRow({ voided: true, voided_at: '2026-10-05T07:00:00.000Z', voided_by: MANAGER_ID }))[0];
  const repeat = voidRowState(voided, manager);
  assert.equal(repeat.canVoid, false, 'a manager still cannot repeat a void');
  assert.match(String(repeat.reason), /already voided.*retained/);
});

test('the void request path reuses the booking-scoped usage path', () => {
  assert.equal(
    voidRequestPath('BK-2026-0001', USAGE_ID),
    `/bookings/BK-2026-0001/service-usage/${USAGE_ID}/void`,
  );
  assert.match(voidRequestPath('BK/2026 ', USAGE_ID), /BK%2F2026/);
  assert.equal(voidRequestPath('BK-2026-0001', USAGE_ID).endsWith('/void'), true);
});

test('the reason is optional but must fit the audit column', () => {
  const withoutReason = validateVoidDraft({ usageId: USAGE_ID, reason: '' });
  assert.equal(withoutReason.valid, true);
  assert.deepEqual(withoutReason.payload, {}, 'an empty reason is not sent');

  const withReason = validateVoidDraft({ usageId: USAGE_ID, reason: '  Wrong room charged  ' });
  assert.deepEqual(withReason.payload, { reason: 'Wrong room charged' });

  const tooLong = validateVoidDraft({ usageId: USAGE_ID, reason: 'x'.repeat(MAX_VOID_REASON_LENGTH + 1) });
  assert.equal(tooLong.valid, false);
  assert.match(String(tooLong.errors.reason), new RegExp(`under ${MAX_VOID_REASON_LENGTH} characters`));
  assert.equal(
    tooLong.payload.reason,
    'x'.repeat(MAX_VOID_REASON_LENGTH + 1),
    'the note is never silently truncated; the caller must refuse it',
  );

  const missing = validateVoidDraft(emptyVoidDraft());
  assert.equal(missing.valid, false);
  assert.match(String(missing.errors.usageId), /Choose the recorded charge/);
  assert.equal(validateVoidDraft({ usageId: 'not-a-uuid', reason: '' }).valid, false);
});

test('FR-046 the reversal amount is the server-rounded amount as exact text', () => {
  const result = parseVoidResult({
    usage_id: USAGE_ID,
    booking_id: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5b01',
    service_id: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5d01',
    quantity: '2.00',
    unit_price_snapshot: '1250.50',
    voided: true,
    voided_amount: '2501.00',
    voided_at: '2026-10-05T07:00:00.000Z',
    voided_by: MANAGER_ID,
    invoice_id: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5f01',
    billing: { totalAmount: '0', netPaid: '1000', balance: '-1000', isCredit: true, creditAmount: '1000' },
  });

  assert.ok(result);
  assert.equal(result.usageId, USAGE_ID);
  assert.equal(result.voidedAmount, '2501.00');
  assert.equal(result.voidedAt, '2026-10-05T07:00:00.000Z');
  assert.equal(result.voidedBy, MANAGER_ID);
  assert.deepEqual(result.billing, {
    totalAmount: '0.00',
    netPaid: '1000.00',
    balance: '-1000.00',
    isCredit: true,
    creditAmount: '1000.00',
  });

  assert.equal(parseVoidResult({ voided: true }), null, 'a body without a usage id is not a reversal');
  assert.equal(parseVoidResult(null), null);
  assert.equal(parseVoidResult({ usage_id: USAGE_ID })?.billing, null);
});

test('FR-048 a void retains the original charge, actor, snapshot and timestamps', () => {
  const original = records();
  const before = original[0];
  const result = parseVoidResult({
    usage_id: USAGE_ID,
    voided_amount: '2501.00',
    voided_at: '2026-10-05T07:00:00.000Z',
    voided_by: MANAGER_ID,
    billing: { totalAmount: '0', netPaid: '0', balance: '0', isCredit: false, creditAmount: '0' },
  });
  assert.ok(result);

  const after = applyVoidedUsage(original, result);
  assert.equal(after.length, 1, 'the row is retained, not removed');
  assert.deepEqual(
    {
      serviceId: after[0].serviceId,
      serviceName: after[0].serviceName,
      bookingRoomLineId: after[0].bookingRoomLineId,
      quantity: after[0].quantity,
      unitPriceSnapshot: after[0].unitPriceSnapshot,
      amount: after[0].amount,
      usedAt: after[0].usedAt,
      recordedAt: after[0].recordedAt,
      recordedBy: after[0].recordedBy,
    },
    {
      serviceId: before.serviceId,
      serviceName: before.serviceName,
      bookingRoomLineId: before.bookingRoomLineId,
      quantity: before.quantity,
      unitPriceSnapshot: before.unitPriceSnapshot,
      amount: before.amount,
      usedAt: before.usedAt,
      recordedAt: before.recordedAt,
      recordedBy: before.recordedBy,
    },
    'only the reversal metadata changes',
  );
  assert.equal(after[0].voided, true);
  assert.equal(after[0].voidedAt, '2026-10-05T07:00:00.000Z');
  assert.equal(after[0].voidedBy, MANAGER_ID);
  assert.equal(before.voided, false, 'the input array is not mutated');

  const list = records(usageRow(), usageRow({ usage_id: OTHER_USAGE_ID, amount: '350.00' }));
  const merged = applyVoidedUsage(list, result);
  assert.equal(merged.length, 2);
  assert.equal(merged[1].voided, false, 'other charges are untouched');
  assert.equal(merged[1].amount, '350.00');
});

test('every M3-S11 void failure code maps to staff-facing copy', () => {
  const cases: Array<[number, string, RegExp]> = [
    [401, 'AUTHENTICATION_REQUIRED', /active staff account/],
    [403, 'VOID_ACCESS_DENIED', /Branch Manager of this branch, Chain Manager or System Administrator/],
    [404, 'USAGE_NOT_FOUND', /no longer available to void/],
    [409, 'USAGE_ALREADY_VOIDED', /cannot be voided again/],
    [409, 'INVOICE_FINAL', /Escalate to management/],
    [400, 'INVALID_SERVICE_USAGE_VOID_INPUT', /booking reference and valid charge reference/],
    [400, 'VOID_REJECTED', /rejected by the server/],
  ];

  for (const [status, code, pattern] of cases) {
    const failure = parseUsageFailure(status, { error: { code, message: 'server text' } });
    assert.equal(failure.code, code);
    assert.match(describeVoidFailure(failure), pattern, `${code} copy`);
  }

  assert.match(describeVoidFailure(parseUsageFailure(409, { error: { code: 'SOMETHING_NEW', message: 'teapot' } })), /teapot/);
  assert.match(describeVoidFailure({ status: 500, code: 'UNKNOWN', message: '' }), /rejected by the server/);
});

test('a repeat void is a distinct state from any other refusal', () => {
  assert.equal(isVoidRepeat(parseUsageFailure(409, { error: { code: 'USAGE_ALREADY_VOIDED' } })), true);
  assert.equal(isVoidRepeat(parseUsageFailure(403, { error: { code: 'VOID_ACCESS_DENIED' } })), false);
  assert.equal(isVoidRepeat(parseUsageFailure(409, { error: { code: 'INVOICE_FINAL' } })), false);
});

test('a void authority refused the list read is told why instead of seeing no charges', () => {
  assert.match(
    describeListDenial('BRANCH_MANAGER', true),
    /may void service usage, but the usage list read is still limited to active Front Desk or Service Staff/,
  );
  assert.match(describeListDenial('BRANCH_MANAGER', true), /Signed in as BRANCH_MANAGER\./);
  assert.match(
    describeListDenial('FRONT_DESK', false),
    /^Service usage is restricted to active Front Desk or Service Staff of this branch\.$/,
  );
});